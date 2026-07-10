// Pixel Quest — Adventure Layer v1.
//
// The character never speaks and is never manually driven; the music
// carries him. This layer sits alongside the existing special-event system
// (pixelquest-events.js, untouched in spirit) and adds a silent story loop:
// Travel -> Discover -> React -> Transform -> Continue.
//
// It owns three small things:
//   AdventureMood        — a rolling calm/steady/energetic/peak/breakdown
//                          read on the music, from simple EMAs of driveFx.
//   OrbCompanion         — a persistent little light that follows the hero.
//   DistantDestination   — a far-background silhouette that slowly changes,
//                          giving the sense of traveling somewhere.
// ...and two short, mood-gated "adventure beats": a beat-synced note bridge
// and a calm-section campfire pause (which reuses the EXISTING procedural
// campfires drawn by PixelQuest.drawCampfire — no new art, just a reaction
// to world objects that were already there). The third requested beat, the
// "Locked Door Moment", is the existing `secret_door` cameo in
// pixelquest-events.js — it already appears roadside, glows, opens with
// light, and disappears, so it is reused (with a small bass-glow addition)
// rather than duplicated. See pixelquest-events.js's PixelQuestEventManager
// for the generic reaction hook that makes ANY sky/prop/transition cameo
// (secret_door included) trigger the hero's look-up/lean reactions.

import { EncounterManager } from "./pixelquest-encounters.js";
import { StoryDirector } from "./pixelquest-story.js";

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const ADVENTURE_TUNING = {
  // mood smoothing (simple EMAs over driveFx, per the spec: "does not need
  // to be perfect song-structure detection")
  moodFastTau: 0.75, // seconds — the "right now" energy reading
  moodSlowTau: 7, // seconds — the "recent history" baseline, for breakdown
  moodDwellSeconds: 0.9, // a candidate state must hold this long to commit
  // mood thresholds. NOTE: PixelQuest.analyze() never lets driveFx settle
  // below ~0.2 while any audio is playing (a deliberate "never stops dead"
  // floor on the walk-pace signal) — moodCalmMax sits comfortably above
  // that floor so genuinely quiet passages actually reach "calm" instead of
  // asymptotically approaching a threshold they can never cross.
  moodCalmMax: 0.32,
  moodEnergeticMin: 0.46,
  moodPeakMin: 0.7,
  moodBreakdownBaseline: 0.35, // longEnergy must be at least this high...
  moodBreakdownDrop: 0.16, // ...and energy must have fallen this far below it
  // adventure beats
  noteBridgeMaxTiles: 6,
  noteBridgeCooldownSeconds: 150,
  noteBridgeChance: 0.045, // rolled once per kick while eligible
  campfireCooldownSeconds: 30,
  campfirePauseDuration: [3, 4.5],
  campfirePauseChance: 0.45, // not every campfire passed gets a pause
  destinationCycleSeconds: [100, 160],
  destinationCrossfadeSeconds: 6,
  // reactions: a rest period after any reaction before the next non-reward
  // one may start, so small cues read as deliberate rather than fidgety
  reactionRestSeconds: 2.2,
};

// Quest/Collectible System v1: Sound Fragments + orbCharge. Not a score —
// a visual "music energy" the orb quietly gathers. See SoundFragmentField
// and OrbCompanion.charge below.
const FRAGMENT_TUNING = {
  maxActive: 22, // a calmer ceiling — the ground never fills with dots
  driftSeconds: 0.55, // brief float before the music pulls it toward the orb
  attractRate: 4.2, // per-second ease toward the orb once drifting ends
  collectRadius: 2.5,
  maxLifetime: 6, // safety cleanup if never collected
  flashSeconds: 0.18, // tiny collect-pulse before removal
  chargePerFragment: 0.05,
  chargeDecayPerSecond: 0.004, // "very slowly" per spec — a whole minute+ to fully drain
  arrivalChargeRetain: 0.4, // orbCharge *= this after an arrival resolves — partial, not zero
  bassCooldown: 0.4, // a touch more spacing so kicks don't stream fragments
  midCooldown: 0.55,
  highCooldown: 0.45,
  ambientCooldownRange: [3, 6.5], // trickle when the mic is quiet/off
  moodSpawnMul: { calm: 0.55, steady: 1, energetic: 1.2, peak: 1.5, breakdown: 0.5 },
};

const clampState = (s) => ["calm", "steady", "energetic", "peak", "breakdown"].includes(s);

export class AdventureMood {
  constructor() {
    this.state = "calm";
    this.candidate = "calm";
    this.dwell = 0;
    this.energy = 0; // ~0.75s EMA of driveFx
    this.longEnergy = 0; // ~7s EMA, the recent baseline
  }
  update(pq, dt) {
    const T = ADVENTURE_TUNING;
    const driveFx = pq.driveFx || 0;
    const gate = pq.gate || 0;
    this.energy += (driveFx - this.energy) * Math.min(1, dt / T.moodFastTau);
    this.longEnergy += (driveFx - this.longEnergy) * Math.min(1, dt / T.moodSlowTau);

    let next;
    if (gate < 0.3) {
      next = this.longEnergy > 0.4 ? "breakdown" : "calm";
    } else if (this.energy > T.moodPeakMin) {
      next = "peak";
    } else if (this.energy > T.moodEnergeticMin) {
      next = "energetic";
    } else if (this.longEnergy > T.moodBreakdownBaseline && this.energy < this.longEnergy - T.moodBreakdownDrop) {
      next = "breakdown"; // dropped well below its own recent average
    } else if (this.energy < T.moodCalmMax) {
      next = "calm";
    } else {
      next = "steady";
    }

    if (next === this.candidate) this.dwell += dt;
    else {
      this.candidate = next;
      this.dwell = 0;
    }
    if (this.dwell > T.moodDwellSeconds) this.state = next;
  }
}

// Biome System v1: the orb keeps its shape and behavior everywhere, just a
// slightly different base hue per biome — warm gold on the Meadow Road,
// magical cyan-violet in the Neon Forest, cool moonlight in town, hot
// neon in the ruins, warm amber approaching the castle.
const BIOME_ORB_HUE = {
  "meadow-road": 42,
  "neon-forest": 200,
  "moonlit-town": 210,
  "arcade-ruins": 305,
  "castle-approach": 36,
};

// Music Note Bridge (Biome System v1): tile skins per biome. `shape(o,x,y)`
// draws the small bright "core" of the tile; the soft glow rect underneath
// is shared and colored by `glow`.
const BRIDGE_SKINS = {
  "meadow-road": {
    glow: "255,225,140",
    core: "255,240,190",
    shape(o, x, y) {
      o.fillRect(x, y, 1, 2); // note head
      o.fillRect(x + 1, y - 3, 1, 3); // stem
    },
  },
  "neon-forest": {
    glow: "150,255,220",
    core: "170,255,230",
    shape(o, x, y) {
      o.fillRect(x - 1, y, 3, 1); // a small glowing vine loop
      o.fillRect(x, y - 2, 1, 3);
    },
  },
  "moonlit-town": {
    glow: "200,210,240",
    core: "225,230,250",
    shape(o, x, y) {
      o.fillRect(x - 1, y - 1, 3, 2); // a flat moonlit stepping stone
    },
  },
  "arcade-ruins": {
    glow: "80,220,240",
    core: "255,90,200",
    shape(o, x, y) {
      o.fillRect(x - 1, y - 2, 3, 1); // a neon grid square outline
      o.fillRect(x - 1, y, 3, 1);
      o.fillRect(x - 1, y - 2, 1, 3);
      o.fillRect(x + 1, y - 2, 1, 3);
    },
  },
  "castle-approach": {
    glow: "255,205,140",
    core: "225,215,205",
    shape(o, x, y) {
      o.fillRect(x - 1, y - 1, 3, 3); // a stone block underfoot
    },
  },
};

// Sound Fragments (Quest/Collectible System v1): tiny drifting motes of
// music energy the orb gathers. VISUAL LANGUAGE: every fragment shares one
// cyan-white ENERGY core so it always reads as "collectible energy" (never
// mistaken for a gold reward or a magenta portal); the biome only tints the
// soft halo around it, carrying local flavor without changing the meaning.
const FRAGMENT_ENERGY = "170,240,255"; // the shared cyan-white energy signal
const FRAGMENT_HALO = {
  "meadow-road": "255,225,140", // warm firefly gold
  "neon-forest": "170,120,255", // spore violet
  "moonlit-town": "200,215,255", // moonlight silver-blue
  "arcade-ruins": "90,230,255", // neon cyan
  "castle-approach": "255,210,150", // torch-warm
};
function drawFragment(o, pal, x, y, a, size) {
  const halo = FRAGMENT_HALO[pal?.biome] || FRAGMENT_HALO["meadow-road"];
  o.fillStyle = `rgba(${halo},${a * 0.4})`; // biome-tinted glow
  o.fillRect(x - 1, y - 1, size + 2, size + 2);
  o.fillStyle = `rgba(${FRAGMENT_ENERGY},${a})`; // consistent energy core
  o.fillRect(x, y, size, size);
  o.fillStyle = `rgba(235,255,255,${a})`; // a bright center pixel
  o.fillRect(x, y, 1, 1);
}

// ------------------------------------------------------------- the orb
// A tiny, ever-present light near the hero: the character's silent
// "mission". Brightens with mids and with mood energy, breathes gently
// with the beat rather than flashing on every kick.
export class OrbCompanion {
  constructor() {
    this.visible = true;
    this.ph = Math.random() * TAU;
    this.bright = 0.16;
    this._lastT = 0;
    // Quest/Collectible System v1: 0..1, rises as Sound Fragments are
    // absorbed, decays very slowly, drops partially (not to zero) after an
    // arrival resolves. Purely visual — never a hard gate on anything.
    this.charge = 0;
    this._orbitPh = Math.random() * TAU;
    // Encounter Moments v1: 0..1, set by EncounterManager each frame — the
    // orb leans forward and brightens for the duration of an encounter.
    this.encounterActive = 0;
    // a quick flare each time it swallows a fragment — the companion visibly
    // "brightens when absorbing", so the collection reads as the orb's doing
    this.absorbFlash = 0;
    // a short light trail behind it (fixed slots — zero per-frame allocation)
    this._trail = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    this._trailT = 0;
    this._trailI = 0;
    // full-resolution overlay: a soft glowing note drawn on the real canvas (not
    // the low-res buffer) so it moves smoothly. `_rs` is the per-frame render
    // snapshot; `_img` is an optional high-res soft-glow PNG (procedural glow if
    // absent). x/y are the live buffer-space position (for aiming, etc.).
    this._rs = null;
    this._img = null;
    this._imgTried = false;
    this.x = 0;
    this.y = 0;
  }
  addCharge(amount) {
    this.charge = clamp01(this.charge + amount);
  }
  onAbsorb() {
    this.absorbFlash = 1;
  }
  // a stable aim point for Sound Fragments to converge on — deliberately
  // ignores the bob/drift/reach jitter below so their approach reads clean
  targetPos(pq) {
    if (pq.heroScreenX == null) return { x: pq.pw / 2, y: pq.ph / 2 };
    return { x: pq.heroScreenX + 26, y: pq.heroScreenY - 9 };
  }
  draw(o, pq, mood, arrival, destX, destY) {
    // UPDATE + STASH only. The orb BODY is drawn later in drawOverlay() on the
    // full-resolution canvas, so it moves with sub-pixel smoothness instead of
    // snapping on the low-res buffer. Here we just advance state + record it.
    if (!this.visible || pq.heroScreenX == null) { this._rs = null; return; }
    const dt = Math.min(0.05, this._lastT ? pq.t - this._lastT : 0.016);
    this._lastT = pq.t;
    this.charge = Math.max(0, this.charge - FRAGMENT_TUNING.chargeDecayPerSecond * dt);
    this.absorbFlash = Math.max(0, this.absorbFlash - dt * 5);
    // Story Engine relationship hooks (orbCircleExcitedly / orbLeadForward / …)
    const cmd = pq.adventure?.story?.orbCmd?.mode;
    const cmdSpeed = cmd === "circle" ? 2.4 : cmd === "rest" ? 0.5 : 1;
    const cmdLead = cmd === "lead" || cmd === "point" || cmd === "nudge" ? 6 : cmd === "hide" ? -14 : 0;
    const cmdBright = cmd === "protect" ? 0.25 : cmd === "rest" ? -0.1 : 0;
    // sc scales offsets tuned at the original 160px height to any resolution
    const sc = pq.S / 1.67;
    // ONE gentle drift — a smooth orbit + one slow vertical breathe. (The old
    // second high-frequency bob is gone; the overlay is sub-pixel now, so the
    // motion no longer has to fight the grid and a single slow orbit reads calm.)
    const orbitSpeed = (0.85 + mood.energy * 1.0) * cmdSpeed;
    const orbitR = (2.8 + mood.energy * 1.5) * (cmd === "circle" ? 1.5 : 1) * sc;
    const orbitX = Math.cos(pq.t * orbitSpeed + this.ph) * orbitR;
    const orbitY = Math.sin(pq.t * orbitSpeed + this.ph) * orbitR * 0.6 + Math.sin(pq.t * 0.8 + this.ph) * 1.1 * sc;
    const enc = this.encounterActive || 0;
    const reach = ((arrival && arrival.phase !== "traveling" ? Math.min(4, arrival.journey * 5) : 0) + enc * 3 + cmdLead) * sc;
    // FLOAT position (no rounding) — the smoothness comes from the overlay pass
    const x = pq.heroScreenX + 26 * sc + orbitX + reach;
    const y = pq.heroScreenY - 9 * sc + orbitY - reach * 0.6;
    this.x = x;
    this.y = y;
    // brightness follower (~200ms): sharp per-kick impulses become a soft pulse
    const boost =
      mood.state === "peak" ? 1 : mood.state === "energetic" ? 0.55 : mood.state === "breakdown" ? 0.08 : 0.22;
    const arrivalBoost = arrival?.phase === "arriving" ? 0.35 : 0;
    const target = clamp01(
      0.14 + mood.energy * boost + pq.kickPulse * 0.14 + (pq.mids.value || 0) * 0.1 + arrivalBoost + this.charge * 0.22 + enc * 0.18 + cmdBright
    );
    this.bright += (target - this.bright) * Math.min(1, dt * 5);
    const baseHue = BIOME_ORB_HUE[pq.currentBiome?.()?.name] ?? 42;
    const hue = baseHue + mood.energy * 30;
    // trail history (float positions; rendered smoothly in the overlay)
    this._trailT += dt;
    if (this._trailT > 0.05) {
      this._trailT = 0;
      this._trailI = (this._trailI + 1) % this._trail.length;
      this._trail[this._trailI].x = x;
      this._trail[this._trailI].y = y;
    }
    this._rs = { x, y, hue, sc, bright: this.bright, charge: this.charge, flare: this.absorbFlash,
                 arriving: arrival?.phase === "arriving", destX, destY };
  }

  // Full-resolution overlay: the orb, its soft glow and trail, drawn on the real
  // canvas (sx/sy = display÷buffer scale) so everything is smooth + anti-aliased.
  drawOverlay(ctx, pq, sx, sy) {
    const r = this._rs;
    if (!r) return;
    if (!this._imgTried && typeof Image !== "undefined") {
      this._imgTried = true; // optional high-res soft-glow note; procedural core until it exists
      this._img = new Image();
      this._img.src = "/assets/pixelquest/orb_glow.png";
    }
    const scale = (sx + sy) / 2;
    const dx = r.x * sx, dy = r.y * sy, hue = r.hue;
    ctx.save();
    ctx.imageSmoothingEnabled = true;

    // soft fading trail behind the orb
    const trailN = Math.min(this._trail.length, 2 + Math.round(r.charge * 3));
    for (let i = 1; i <= trailN; i++) {
      const s = this._trail[(this._trailI - i + this._trail.length * 2) % this._trail.length];
      if (!s.x) continue;
      const a = (0.26 - i * 0.05) * (0.5 + r.bright * 0.5);
      if (a <= 0.015) continue;
      const tx = s.x * sx, ty = s.y * sy, tr = (1.6 + r.charge * 1.1) * scale;
      const tg = ctx.createRadialGradient(tx, ty, 0, tx, ty, tr);
      tg.addColorStop(0, `hsla(${hue},90%,80%,${a})`);
      tg.addColorStop(1, `hsla(${hue},90%,70%,0)`);
      ctx.fillStyle = tg;
      ctx.beginPath(); ctx.arc(tx, ty, tr, 0, TAU); ctx.fill();
    }

    // soft biome-hued bloom, breathing with `bright`
    const bloom = clamp01(0.06 + r.bright * 0.16 + r.charge * 0.06 + r.flare * 0.28);
    const bloomR = (7 + r.bright * 5 + r.charge * 3 + r.flare * 4) * r.sc * scale;
    const bg = ctx.createRadialGradient(dx, dy, 0, dx, dy, bloomR);
    bg.addColorStop(0, `hsla(${hue},85%,82%,${bloom})`);
    bg.addColorStop(0.45, `hsla(${hue},80%,66%,${bloom * 0.5})`);
    bg.addColorStop(1, `hsla(${hue},80%,60%,0)`);
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(dx, dy, bloomR, 0, TAU); ctx.fill();

    // the note itself: high-res soft art if present, else a smooth glowing core
    const img = this._img;
    if (img && img.complete && img.naturalWidth) {
      const size = (14 + r.charge * 3) * r.sc * scale;
      ctx.globalAlpha = clamp01(0.82 + r.bright * 0.18);
      ctx.drawImage(img, dx - size / 2, dy - size / 2, size, size);
      ctx.globalAlpha = 1;
    } else {
      const coreR = (2.4 + r.charge * 1.3) * r.sc * scale;
      const cg = ctx.createRadialGradient(dx - coreR * 0.3, dy - coreR * 0.3, 0, dx, dy, coreR);
      cg.addColorStop(0, `hsla(${hue},100%,97%,${clamp01(0.85 + r.flare * 0.15)})`);
      cg.addColorStop(0.5, `hsla(${hue},95%,72%,${clamp01(0.55 + r.bright * 0.35)})`);
      cg.addColorStop(1, `hsla(${hue},95%,62%,0.12)`);
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(dx, dy, coreR, 0, TAU); ctx.fill();
      ctx.fillStyle = `hsla(${hue},100%,98%,${clamp01(0.65 + r.flare * 0.3)})`; // specular highlight
      ctx.beginPath(); ctx.arc(dx - coreR * 0.25, dy - coreR * 0.25, coreR * 0.3, 0, TAU); ctx.fill();
    }

    // full-charge "ready" ring — a slow, smooth pulse
    if (r.charge > 0.9) {
      const pulse = 0.5 + 0.5 * Math.sin(pq.t * 4);
      ctx.strokeStyle = `hsla(${hue},95%,74%,${0.1 + pulse * 0.12})`;
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath(); ctx.arc(dx, dy, bloomR * 0.82, 0, TAU); ctx.stroke();
    }

    // arrival: a faint, sparse beam of smooth dots toward the destination
    if (r.arriving && Number.isFinite(r.destX)) {
      const passChance = clamp01(0.5 + r.charge * 0.4);
      for (let i = 1; i < 5; i++) {
        if (Math.random() > passChance) continue;
        const f = i / 5, px = (r.x + (r.destX - r.x) * f) * sx, py = (r.y + (r.destY - r.y) * f) * sy;
        ctx.fillStyle = `hsla(${hue},95%,85%,${0.15 + r.bright * 0.2 + r.charge * 0.15})`;
        ctx.beginPath(); ctx.arc(px, py, 1.3 * scale, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
}

// ------------------------------------------------------- distant destination
// A far horizon silhouette giving the sense of traveling somewhere. Biome
// System v1: the kind it shows is now driven BY THE CURRENT BIOME (each
// biome names one), and it crossfades in lockstep with the world's own
// biome transition (pq.biomeT) rather than on an independent timer — one
// unified transition instead of two unrelated clocks drifting past each other.
const BIOME_DESTINATION = {
  "meadow-road": "hilltop", // a hill light or tiny far castle
  "neon-forest": "portal", // a glowing shrine/portal in the trees
  "moonlit-town": "tower", // a distant tower, window aglow
  "arcade-ruins": "arcade", // a neon gate beyond the ruins
  "castle-approach": "castle", // the destination itself, at last
};

export class DistantDestination {
  constructor() {
    this.kind = "hilltop";
    this.next = "hilltop";
    this.cross = 1; // mirrors pq.biomeT once a biome transition begins
    this._forced = null;
    this._forcedBiomeIdx = null;
    this.lastX = 0; // screen position, refreshed every draw() — the
    this.lastY = 0; // Arrival Sequence's flourish and the orb's "beam" both aim here
  }
  // debug/test: preview a silhouette immediately; clears itself the moment
  // the world actually changes biome (forced or natural)
  forceKind(kind) {
    if (!["castle", "tower", "portal", "hilltop", "arcade"].includes(kind)) return;
    this._forced = kind;
    this._forcedBiomeIdx = null; // set on first update() so we know the baseline
  }
  update(pq, mood, dt) {
    if (this._forced) {
      if (this._forcedBiomeIdx === null) this._forcedBiomeIdx = pq.biomeIdx;
      if (pq.biomeIdx === this._forcedBiomeIdx) {
        this.kind = this._forced;
        this.next = this._forced;
        this.cross = 1;
        return;
      }
      this._forced = null; // the world moved on; resume biome-driven behavior
    }
    const curName = pq.currentBiome?.()?.name;
    const nextName = pq.biomeNameAt?.(pq.biomeNext);
    this.kind = BIOME_DESTINATION[curName] || "hilltop";
    this.next = BIOME_DESTINATION[nextName] || this.kind;
    this.cross = pq.biomeT; // same 0..1 progress driving the sky/mountain crossfade
  }
  draw(o, pq, pal, mood, journey = 1, charge = 0) {
    // AHEAD of the traveler on the road (he journeys rightward — the goal
    // lives in the open space in front of him, like the reference's distant
    // castle), below the moon (~78%) and above the mountain silhouettes so
    // it isn't quietly painted over by the peaks drawn right after this
    const x = Math.round(pq.pw * 0.6);
    const base = Math.round(pq.groundBase() - 62 * pq.S);
    this.lastX = x + 5;
    this.lastY = base + 6;
    const moodGlow = mood.state === "peak" ? 1.35 : mood.state === "breakdown" ? 0.5 : 1;
    // Journey/Arrival: distant but always READABLE (a clear waypoint, not a
    // faint smudge), sharpening as the character approaches. The floor is
    // high enough that it never reads as an ambiguous blob.
    // Quest System v1: a charged-up orb brightens it a little further.
    const clarity = (0.5 + clamp01(journey) * 0.5) * (1 + clamp01(charge) * 0.25);
    const settled = this.cross >= 1;
    this.#drawKind(o, pq, pal, this.kind, x, base, moodGlow * clarity * (settled ? 1 : 1 - this.cross));
    if (!settled) this.#drawKind(o, pq, pal, this.next, x, base, moodGlow * clarity * this.cross);
  }
  #drawKind(o, pq, pal, kind, x, base, alpha) {
    if (alpha <= 0.02) return;
    // a stronger silhouette than the sky behind it (darker, not a low-
    // contrast haze), so the destination reads as a real structure
    const sil = pq.mix(pal.mtFar, [8, 6, 14], 0.55);
    const pulse = 0.75 + 0.25 * Math.sin(pq.t * 1.5); // a living beacon
    // a shared warm point-of-light "beacon" — the VISUAL LANGUAGE for a
    // destination is a warm gold glow (portal/arcade override with their own
    // threshold colors). Drawn as a soft glow disc + a bright core.
    const beacon = (bx, by, rgb) => {
      o.fillStyle = `rgba(${rgb},${alpha * 0.4 * pulse})`;
      pq.pixelDisc(o, bx, by, 3);
      o.fillStyle = `rgba(${rgb},${alpha * pulse})`;
      o.fillRect(bx, by, 2, 2);
    };
    if (kind === "castle") {
      o.fillStyle = pq.col(sil, alpha);
      o.fillRect(x, base, 11, 15);
      o.fillRect(x - 3, base + 4, 3, 11);
      o.fillRect(x + 11, base + 4, 3, 11);
      for (let i = 0; i < 3; i++) o.fillRect(x + 1 + i * 3, base - 2, 2, 2);
      beacon(x + 4, base + 6, "255,210,130"); // warm gold — the goal
    } else if (kind === "tower") {
      o.fillStyle = pq.col(sil, alpha);
      o.fillRect(x + 2, base - 8, 6, 23);
      o.fillRect(x + 1, base - 11, 8, 4); // wider cap
      beacon(x + 4, base - 6, "255,215,140"); // gold beacon at the top
    } else if (kind === "portal") {
      // magenta/cyan threshold — the VISUAL LANGUAGE for a transition
      o.fillStyle = pq.col(sil, alpha);
      o.fillRect(x - 1, base - 2, 3, 16); // stone posts framing it
      o.fillRect(x + 9, base - 2, 3, 16);
      o.fillStyle = `rgba(200,90,255,${alpha * 0.5 * pulse})`;
      pq.pixelDisc(o, x + 5, base + 7, 6);
      o.fillStyle = `rgba(150,230,255,${alpha * 0.7 * pulse})`;
      pq.pixelDisc(o, x + 5, base + 7, 2);
    } else if (kind === "arcade") {
      // a neon gate: two posts and a glowing lintel beyond the ruins
      o.fillStyle = pq.col(sil, alpha);
      o.fillRect(x - 2, base - 2, 3, 16);
      o.fillRect(x + 11, base - 2, 3, 16);
      o.fillStyle = `rgba(255,90,200,${alpha * 0.85 * pulse})`;
      o.fillRect(x - 3, base - 4, 17, 2); // neon lintel
      o.fillStyle = `rgba(80,230,255,${alpha * 0.7 * pulse})`;
      pq.pixelDisc(o, x + 6, base + 6, 4); // glowing machine silhouette within
    } else {
      // hilltop with a warm beacon light — a rounded hill, not a flat smudge
      o.fillStyle = pq.col(sil, alpha);
      o.fillRect(x - 5, base + 13, 19, 3);
      o.fillRect(x - 2, base + 10, 13, 3);
      o.fillRect(x + 1, base + 7, 7, 3);
      beacon(x + 3, base + 4, "255,225,150"); // the warm hilltop light
    }
  }
}

// ---------------------------------------------------- journey + arrival
// Step 3: connects biome, destination, mood, and beats into one loop —
// Travel -> Destination appears -> Music powers the moment -> Arrive ->
// Small payoff -> Transition -> Continue. journeyProgress (0..1) tracks how
// far into the CURRENT biome's visit the character has traveled; it resets
// whenever the biome actually changes (watched here, not driven by it —
// nothing about the existing biome-swap timer changes). Progress is paced
// off the biome's own minDuration/maxDuration budget (so an "energetic"
// biome and a "calm" one each still take a sensible amount of real time to
// arrive), nudged faster or slower by mood.
const ARRIVAL_TUNING = {
  approachAt: 0.6,
  arriveAt: 0.85,
  sequenceDuration: [6, 8], // seconds — the arrival payoff itself
  moodPaceMult: { calm: 0.75, steady: 1, energetic: 1.15, peak: 1.4, breakdown: 0.6 },
};

// One transition "flavor" per biome, per the spec's biome-appropriate list
// (first/most central pick from each biome's suggested set, to keep v1
// simple — see PixelQuestAdventureManager#drawTransitionEffect below).
const TRANSITION_TYPES = {
  "meadow-road": "light-trail",
  "neon-forest": "doorway",
  "moonlit-town": "horizon-fade",
  "arcade-ruins": "pixel-wipe",
  "castle-approach": "bridge",
};
const ALL_TRANSITION_TYPES = ["light-trail", "doorway", "horizon-fade", "pixel-wipe", "bridge"];

// Arrival flourish: a small biome-specific flare drawn AT the distant
// destination's on-screen spot once the character is close (phase
// approaching/arriving) — sparkles gathering, vines pulsing, a brighter
// beacon, a cabinet power-up flash, a torch/gate glow. `s` is 0..1, the
// arrival's own progress (0 while just approaching, ramping through the
// arriving sequence).
const ARRIVAL_FLOURISH = {
  "meadow-road"(o, pq, x, y, s) {
    const n = Math.round(2 + s * 5);
    for (let i = 0; i < n; i++) {
      const a = (0.3 + 0.5 * Math.sin(pq.t * 3 + i * 2)) * s;
      o.fillStyle = `rgba(220,255,160,${a})`;
      o.fillRect(x + Math.round(Math.sin(pq.t * 1.7 + i) * (5 + i)), y - Math.round(Math.cos(pq.t * 1.3 + i) * 4), 1, 1);
    }
  },
  "neon-forest"(o, pq, x, y, s) {
    const glow = 0.3 + s * 0.5 + pq.kickPulse * 0.2;
    o.fillStyle = `rgba(170,110,255,${glow})`;
    for (let i = 0; i < 3; i++) {
      const yy = y - 3 + i * 3;
      o.fillRect(x - 6 + Math.round(Math.sin(pq.t * 2 + i) * 2), yy, 4, 1);
    }
  },
  "moonlit-town"(o, pq, x, y, s) {
    const a = 0.15 + s * 0.3;
    o.fillStyle = `rgba(230,235,255,${a})`;
    o.fillRect(x - 6, y - 12, 12, 12);
    o.fillStyle = `rgba(255,235,190,${0.4 + s * 0.4})`;
    o.fillRect(x - 1, y - 7, 2, 2);
  },
  "arcade-ruins"(o, pq, x, y, s) {
    const flick = Math.random() < 0.3 ? 1 : 0.4;
    o.fillStyle = `rgba(80,230,255,${(0.3 + s * 0.5) * flick})`;
    o.fillRect(x - 6, y - 5, 12, 1);
    o.fillStyle = `rgba(255,90,200,${(0.3 + s * 0.5) * flick})`;
    o.fillRect(x - 6, y - 2, 12, 1);
    if (s > 0.6 && Math.random() < 0.2) {
      o.fillStyle = "rgba(255,220,90,0.85)"; // a token glint
      o.fillRect(x + Math.round((Math.random() - 0.5) * 10), y - 8, 1, 1);
    }
  },
  "castle-approach"(o, pq, x, y, s) {
    const glow = 0.35 + s * 0.45 + pq.kickPulse * 0.3;
    o.fillStyle = `rgba(255,190,110,${glow})`;
    o.fillRect(x - 2, y + 2, 2, 2);
    o.fillRect(x + 8, y + 2, 2, 2);
    if (s > 0.7) {
      // the gate cracks open with light during a peak arrival
      o.fillStyle = `rgba(255,225,170,${(s - 0.7) * 1.5})`;
      o.fillRect(x + 3, y - 8, 1, 12);
    }
  },
};

// Biome transition effects (Step 3): a short, tasteful flourish layered
// over the crossfade already happening in the palette. `t` is pq.biomeT,
// 0..1, so these fade in then out (sin(t*pi)) exactly across the ~4.5s
// crossfade the biome system already runs.
// Quest System v1: `boost` (>=1) scales every effect's envelope a touch —
// a fuller orb charge makes the transition unlock feel a little stronger.
const TRANSITION_DRAW = {
  "light-trail"(o, pq, t, boost = 1) {
    const a = Math.sin(t * Math.PI) * boost;
    const gy = pq.groundY(Math.round(pq.pw * pq.heroAnchor)) + 1;
    for (let i = 0; i < 8; i++) {
      const x = Math.round(pq.pw * pq.heroAnchor) + 16 + i * 11;
      o.fillStyle = `rgba(255,225,150,${a * (0.5 - i * 0.045)})`;
      o.fillRect(x, gy - 2, 3, 1);
    }
  },
  doorway(o, pq, t, boost = 1) {
    const a = Math.sin(t * Math.PI) * boost;
    const cx = Math.round(pq.pw * 0.5);
    const gy = pq.groundY(cx) + 1;
    const w = 4 + Math.round(12 * Math.sin(t * Math.PI));
    o.fillStyle = `rgba(150,255,220,${a * 0.4})`;
    o.fillRect(cx - w / 2, gy - 20, w, 20);
    o.fillStyle = `rgba(230,255,245,${a * 0.65})`;
    o.fillRect(cx - 2, gy - 20, 4, 20);
  },
  "horizon-fade"(o, pq, t, boost = 1) {
    const a = Math.sin(t * Math.PI) * 0.22 * boost;
    o.fillStyle = `rgba(205,215,245,${a})`;
    o.fillRect(0, 0, pq.pw, Math.round(pq.ph * 0.5));
  },
  "pixel-wipe"(o, pq, t, boost = 1) {
    const x = Math.round(t * (pq.pw + 40) - 20);
    for (let i = 0; i < 6; i++) {
      const a = (1 - i / 6) * 0.3 * boost;
      o.fillStyle = i % 2 ? `rgba(80,220,240,${a})` : `rgba(255,90,200,${a})`;
      o.fillRect(x - i * 3, 0, 2, pq.ph);
    }
  },
  bridge(o, pq, t, boost = 1) {
    const a = Math.sin(t * Math.PI) * boost;
    const gy = pq.groundY(Math.round(pq.pw * pq.heroAnchor)) + 1;
    o.fillStyle = `rgba(225,215,205,${a * 0.45})`;
    o.fillRect(0, gy - 1, pq.pw, 2);
    o.fillStyle = `rgba(255,205,140,${a * 0.3})`;
    o.fillRect(0, gy - 3, pq.pw, 1);
  },
};

export class ArrivalSequence {
  constructor() {
    this.journey = 0;
    this.phase = "traveling"; // traveling | approaching | arriving
    this.arrivedThisCycle = false;
    this._lastBiomeIdx = null;
    this.seqT = 0;
    this.seqDur = 0;
    this._celebrated = false;
  }

  update(pq, mood, dt) {
    if (this._lastBiomeIdx === null) this._lastBiomeIdx = pq.biomeIdx;
    if (pq.biomeIdx !== this._lastBiomeIdx) {
      // a new biome has settled in (natural or forced) — start its journey over
      this._lastBiomeIdx = pq.biomeIdx;
      this.journey = 0;
      this.phase = "traveling";
      this.arrivedThisCycle = false;
      this.seqT = 0;
      this._celebrated = false;
    }

    if (this.phase === "arriving") {
      this.#advanceSequence(pq, dt);
      return;
    }

    // Quest System v1: a charged-up orb nudges the pace along a little too
    const chargeNudge = 1 + (pq.adventure?.orb?.charge || 0) * 0.15;
    const mult = (ARRIVAL_TUNING.moodPaceMult[mood.state] ?? 1) * chargeNudge;
    this.journey = clamp01(this.journey + (dt / Math.max(1, pq.biomeDur)) * mult);
    this.phase = this.journey >= ARRIVAL_TUNING.approachAt ? "approaching" : "traveling";

    const mgr = pq.adventure;
    if (
      this.journey >= ARRIVAL_TUNING.arriveAt &&
      !this.arrivedThisCycle &&
      (pq.gate || 0) > 0.3 &&
      !pq.egg &&
      !pq.heroCtl &&
      !pq.adventureCtl &&
      !mgr.noteBridge &&
      !mgr.campfirePause &&
      !mgr.encounters.active // an encounter owns the moment — the arrival
      // simply waits; journey stays >=arriveAt, so it fires the instant the
      // encounter clears (nothing is skipped)
    ) {
      this.#beginArrival(pq);
    }
  }

  #beginArrival(pq) {
    this.phase = "arriving";
    this.arrivedThisCycle = true;
    this._celebrated = false;
    const [lo, hi] = ARRIVAL_TUNING.sequenceDuration;
    this.seqDur = lo + Math.random() * (hi - lo);
    this.seqT = 0;
    pq.adventure.story?.markBeatTriggered("arrival", ["arrival", "heroic_payoff", "transition"]);
    pq.triggerReaction?.("lookup", 0.9);
    pq.spawnSparkles?.();
  }

  #advanceSequence(pq, dt) {
    this.seqT += dt;
    const p = clamp01(this.seqT / this.seqDur);
    // a gentle world slowdown at the heart of the moment, eased in and back
    // out — the same trick the campfire pause uses, never a hard stop
    const k = Math.min(1, this.seqT / 1.2, (this.seqDur - this.seqT) / 1.2);
    pq.adventureCtl = { scrollMul: 1 - 0.4 * k };
    if (p > 0.35 && p < 0.42) pq.triggerReaction?.("lean", 0.8);
    if (this.seqT >= this.seqDur - 1.2 && !this._celebrated) {
      this._celebrated = true;
      pq.triggerReaction?.("celebrate", 1);
      pq.spawnSparkles?.();
    }
    if (this.seqT >= this.seqDur) {
      pq.adventureCtl = null;
      this.phase = "traveling"; // visually resets; journey itself stays ~1
      // Quest System v1: the payoff spends some of the orb's charge —
      // partial, not a hard reset, so it still feels earned next time too
      const orb = pq.adventure?.orb;
      if (orb) orb.charge *= FRAGMENT_TUNING.arrivalChargeRetain;
      // the payoff IS the cue to move on — hands off to the existing,
      // already-tuned biome-swap machinery (mood-weighted pick, ~4.5s
      // crossfade) rather than duplicating any of that logic here
      pq.triggerBiomeTransitionNow?.();
    }
  }

  // ---------------------------------------------------------- debug/test
  forceJourney(v) {
    this.journey = clamp01(v);
    this.phase = this.journey >= ARRIVAL_TUNING.approachAt ? "approaching" : "traveling";
  }
  forceArrivalNow(pq) {
    this.arrivedThisCycle = false;
    this.journey = 1;
    this.#beginArrival(pq);
  }
}

// ------------------------------------------------------- sound fragments
// Quest/Collectible System v1. NOT a score system — a visual reading of
// music energy: fragments appear near the hero (ground/path/sky depending
// on which band triggered them), drift briefly, then ease toward the orb
// and vanish in a tiny flash, nudging OrbCompanion.charge up a little.
export class SoundFragmentField {
  constructor() {
    this.items = [];
    this.spawningEnabled = true;
    this._bassCooldown = 0;
    this._midCooldown = 0;
    this._highCooldown = 0;
    this._ambientCooldown = 2;
  }

  update(pq, mood, dt) {
    const T = FRAGMENT_TUNING;
    this._bassCooldown -= dt;
    this._midCooldown -= dt;
    this._highCooldown -= dt;
    this._ambientCooldown -= dt;

    if (this.spawningEnabled && this.items.length < T.maxActive) {
      const spawnMul = T.moodSpawnMul[mood.state] ?? 1;
      // bass: on the kick, ground-level, warm and a touch larger
      if (pq.kickHit && this._bassCooldown <= 0 && Math.random() < 0.55 * spawnMul) {
        this.#spawn(pq, "bass");
        this._bassCooldown = T.bassCooldown;
      }
      // mids: level-based, near the hero's own path
      if (this._midCooldown <= 0 && (pq.mids.value || 0) > 0.32 && Math.random() < 0.4 * spawnMul) {
        this.#spawn(pq, "mid");
        this._midCooldown = T.midCooldown;
      }
      // highs: level-based, tiny sparkles higher in the air
      if (this._highCooldown <= 0 && (pq.treble.value || 0) > 0.4 && Math.random() < 0.35 * spawnMul) {
        this.#spawn(pq, "high");
        this._highCooldown = T.highCooldown;
      }
      // ambient trickle when the mic is quiet/off — the world still breathes
      if ((pq.gate || 0) < 0.3 && this._ambientCooldown <= 0) {
        this.#spawn(pq, "ambient");
        const [lo, hi] = T.ambientCooldownRange;
        this._ambientCooldown = lo + Math.random() * (hi - lo);
      }
    }

    const orb = pq.adventure.orb;
    const target = orb.targetPos(pq);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      f.age += dt;
      if (f.collected) {
        f.flashT += dt;
        if (f.flashT > T.flashSeconds) this.items.splice(i, 1);
        continue;
      }
      if (f.age < (f.holdUntil ?? 0.35)) {
        // SOURCE PHASE: the fragment holds still at the world object that
        // created it, glowing awake — the viewer sees the world make it
      } else if (f.age < f.driftUntil) {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += -2 * dt; // gentle upward float while drifting
      } else {
        const k = Math.min(1, dt * T.attractRate);
        f.x += (target.x - f.x) * k;
        f.y += (target.y - f.y) * k;
        // the trail anchor lags ~0.15s behind — a visible light-tail
        const tk = Math.min(1, dt * 6);
        f.px += (f.x - f.px) * tk;
        f.py += (f.y - f.py) * tk;
        if (Math.hypot(target.x - f.x, target.y - f.y) < T.collectRadius) {
          orb.addCharge(T.chargePerFragment);
          orb.onAbsorb(); // the orb flares as it swallows the fragment
          f.collected = true;
          f.flashT = 0;
          continue;
        }
      }
      if (f.age > T.maxLifetime) this.items.splice(i, 1);
    }
  }

  // pick a VISIBLE world feature for a fragment to bloom from, so the light
  // reads as music energy rising out of the world the hero travels through —
  // never appearing in the empty space AHEAD of him (that's reserved for
  // destinations, encounters, and the road revealing itself). Bass energy
  // rises from ground props/terrain behind & around him, mids from the path,
  // highs from the sky (moonbeams/stars overhead).
  #worldSource(pq, band) {
    const heroX = pq.heroScreenX ?? Math.round(pq.pw * pq.heroAnchor);
    const off = pq.scrollX * 0.7;
    const L = pq.worldLen;
    const clampX = (x) => Math.max(0, Math.min(pq.pw - 1, x));
    if (band === "high") {
      // a shimmer from the sky, slightly behind/above the hero
      return { x: heroX - 24 + Math.random() * 66, y: Math.round(pq.ph * (0.16 + Math.random() * 0.16)) };
    }
    // gather on-screen ground features near/behind the hero — energy blooms
    // from the FLOWERS along the path (their tips wake and glow first), the
    // hanging lanterns, and roadside props. When a source is an object we
    // draw, we mark it (_srcGlow) so the world visibly makes the light.
    const feats = [];
    for (const fl of pq.flora) {
      if (fl.type !== "flower") continue;
      const sx = (((fl.x - pq.scrollX) % L) + L) % L; // flora rides true ground parallax
      if (sx > heroX - 60 && sx < heroX + 30)
        feats.push({ x: sx, y: pq.groundY(clampX(sx)) - 3, obj: fl });
    }
    for (const to of pq.torches) {
      const sx = (((to.x - off) % L) + L) % L;
      if (sx > heroX - 70 && sx < heroX + 24) feats.push({ x: sx + 4, y: pq.groundY(clampX(sx)) - Math.round(9 * pq.S) });
    }
    for (const at of pq.attractions) {
      if (at.type === "snail") continue;
      const sx = (((at.x - off) % L) + L) % L;
      if (sx > heroX - 80 && sx < heroX + 24) feats.push({ x: sx + 2, y: pq.groundY(clampX(sx)) - 9 });
    }
    // asset-driven props that can release fragments join the candidate pool
    // (their _srcGlow marking lights the prop art the same way)
    if (pq.useAssets?.() && pq.propField?.props.length) {
      for (const s of pq.propField.sourcesNear(heroX, 70)) feats.push(s);
    }
    if (feats.length && Math.random() < 0.75) {
      const pick = feats[(Math.random() * feats.length) | 0];
      if (pick.obj) pick.obj._srcGlow = (pq.clock || 0) + 0.9; // the flower burns bright
      return pick;
    }
    // fallback: the terrain/path just behind & around the hero (grass, stones,
    // the ground itself) — bass hugs the ground, mids float a little higher
    const gx = clampX(heroX + (band === "bass" ? -34 + Math.random() * 42 : -22 + Math.random() * 46));
    return { x: gx, y: pq.groundY(Math.round(gx)) - (band === "bass" ? 3 : 8) - Math.random() * 3 };
  }

  #spawn(pq, origin) {
    const src = this.#worldSource(pq, origin);
    this.items.push({
      x: src.x,
      y: src.y,
      vx: (Math.random() - 0.5) * 5,
      vy: -3 - Math.random() * 5, // a gentle bloom upward off the source
      age: 0,
      // 0.35s held at the source (world creates it), then a real drift
      driftUntil: 0.35 + FRAGMENT_TUNING.driftSeconds * (0.7 + Math.random() * 0.6),
      size: origin === "bass" ? 2 : 1,
      origin,
      collected: false,
      flashT: 0,
      px: src.x,
      py: src.y,
    });
  }

  draw(o, pq, pal) {
    for (const f of this.items) {
      const fx = Math.round(f.x);
      const fy = Math.round(f.y);
      if (f.collected) {
        // absorbed into the orb: a tiny bright pulse, then it's gone
        const k = clamp01(f.flashT / FRAGMENT_TUNING.flashSeconds);
        const a = 1 - k;
        if (a <= 0.02) continue;
        o.fillStyle = `rgba(${FRAGMENT_ENERGY},${a * 0.9})`;
        o.fillRect(fx, fy, 1, 1);
        o.fillStyle = `rgba(${FRAGMENT_ENERGY},${a * 0.22})`;
        pq.pixelDisc(o, fx, fy, 1 + Math.round(k * 3));
        continue;
      }
      const fadeIn = clamp01(f.age / 0.2);
      const fadeOut =
        f.age > FRAGMENT_TUNING.maxLifetime - 0.6 ? Math.max(0, (FRAGMENT_TUNING.maxLifetime - f.age) / 0.6) : 1;
      const a = fadeIn * fadeOut;
      if (a <= 0.03) continue;
      const hold = f.holdUntil ?? 0.35;
      if (f.age < hold) {
        // SOURCE GLOW: the world object wakes — a growing halo blooms at the
        // spot before the fragment lifts off, so the chain reads clearly:
        // music happens → world responds → music-light appears
        const g = f.age / hold;
        o.fillStyle = `rgba(${FRAGMENT_ENERGY},${g * 0.35})`;
        pq.pixelDisc(o, fx, fy, 1 + Math.round(g * 2));
      } else if (f.age >= f.driftUntil && f.px != null) {
        // ATTRACTION TRAIL: a short curved light-tail as the orb pulls it in
        const mx = Math.round((f.px + f.x) / 2);
        const my = Math.round((f.py + f.y) / 2);
        o.fillStyle = `rgba(${FRAGMENT_ENERGY},${a * 0.4})`;
        o.fillRect(mx, my, 1, 1);
        o.fillStyle = `rgba(${FRAGMENT_ENERGY},${a * 0.18})`;
        o.fillRect(Math.round(f.px), Math.round(f.py), 1, 1);
      }
      drawFragment(o, pal, fx, fy, a, f.size);
    }
  }

  // release fragments at an arbitrary screen point (used by encounter
  // resolutions) — they then drift and get pulled into the orb like any
  // other fragment, so a payoff quietly feeds orbCharge too
  spawnAt(pq, x, y, n = 6, size = 1) {
    const T = FRAGMENT_TUNING;
    for (let i = 0; i < n; i++) {
      if (this.items.length >= T.maxActive) break;
      const fx = x + (Math.random() - 0.5) * 10;
      const fy = y + (Math.random() - 0.5) * 10;
      this.items.push({
        x: fx,
        y: fy,
        vx: (Math.random() - 0.5) * 16,
        vy: -6 - Math.random() * 9,
        age: 0,
        // encounter payoffs burst rather than bloom — a shorter source hold
        holdUntil: 0.15,
        driftUntil: 0.15 + T.driftSeconds * (0.8 + Math.random() * 0.9),
        size,
        origin: "encounter",
        collected: false,
        flashT: 0,
        px: fx,
        py: fy,
      });
    }
  }

  // ---------------------------------------------------------- debug/test
  forceSpawn(pq, n = 8) {
    const kinds = ["bass", "mid", "high"];
    for (let i = 0; i < n; i++) this.#spawn(pq, kinds[i % kinds.length]);
  }
  forceCollectAll(pq) {
    const orb = pq.adventure.orb;
    for (const f of this.items) if (!f.collected) orb.addCharge(FRAGMENT_TUNING.chargePerFragment);
    this.items.length = 0;
  }
}

export class PixelQuestAdventureManager {
  constructor(pq) {
    this.pq = pq;
    this.mood = new AdventureMood();
    this.orb = new OrbCompanion();
    this.destination = new DistantDestination();
    this.arrival = new ArrivalSequence();
    this.fragments = new SoundFragmentField();
    this.encounters = new EncounterManager(pq);
    // Story Engine Scaffolding v1 — the director layer that observes every
    // moment and holds the story state / cinematic cards / cooldowns.
    this.story = new StoryDirector(pq);
    this.noteBridge = null;
    this.noteBridgeCooldownUntil = -999;
    this.campfirePause = null;
    this.campfireCooldownUntil = -999;
    this._forcedTransitionType = null;
  }

  // called once per frame, BEFORE PixelQuestEventManager.update(dt) so the
  // one-frame kickHit/snareHit edge flags are still fresh (that manager
  // consumes and clears them)
  update(dt) {
    const pq = this.pq;
    this.mood.update(pq, dt);
    this.arrival.update(pq, this.mood, dt);
    this.destination.update(pq, this.mood, dt);
    this.fragments.update(pq, this.mood, dt);
    this.encounters.update(pq, this.mood, dt);
    this.story.update(dt); // observes state set by the systems above
    this.#updateNoteBridge(pq, dt);
    this.#updateCampfire(pq, dt);
    // a gentle nudge on top of the tempo/energy-driven cruise speed —
    // read by render()'s speed calc; never the primary driver. Approaching
    // a destination adds its own small extra step (arrival itself instead
    // slows the world via pq.adventureCtl, so it's excluded here).
    const approachNudge = this.arrival.phase === "approaching" ? 1.06 : 1;
    pq.moodPaceMul =
      (this.mood.state === "peak"
        ? 1.15
        : this.mood.state === "energetic"
          ? 1.08
          : this.mood.state === "breakdown"
            ? 0.85
            : this.mood.state === "calm"
              ? 0.96
              : 1) * approachNudge;
  }

  #updateNoteBridge(pq, dt) {
    const T = ADVENTURE_TUNING;
    if (this.noteBridge) {
      const st = this.noteBridge;
      // a chapter set piece (or a cameo needing the hero's egg slot) taking
      // over mid-bridge ends it quietly rather than let two "moments" fight
      // for the same few seconds of screen
      if (pq.heroCtl) {
        this.noteBridge = null;
        this.noteBridgeCooldownUntil = pq.clock + T.noteBridgeCooldownSeconds;
        return;
      }
      st.t += dt;
      if (pq.kickHit && st.tiles.length < T.noteBridgeMaxTiles) {
        // laid down just ahead of the hero's fixed screen position, one
        // beat-tile farther out each time — a little glowing path forming
        // in front of him without touching world-scroll or terrain at all
        st.tiles.push({ born: st.t, x: Math.round(pq.pw * pq.heroAnchor) + 18 + st.tiles.length * 13 });
      }
      if (st.t >= st.dur) {
        pq.triggerReaction?.("celebrate", 0.8); // a small bridge, safely crossed
        this.noteBridge = null;
        this.noteBridgeCooldownUntil = pq.clock + T.noteBridgeCooldownSeconds;
      }
      return;
    }
    if ((this.noteBridgeCooldownUntil || -999) > pq.clock) return;
    if (pq.egg || pq.heroCtl || pq.adventureCtl) return; // don't step on a cameo, chapter, or campfire
    if (this.arrival.phase === "arriving") return; // the arrival owns the moment
    if (this.mood.state !== "energetic" && this.mood.state !== "peak") return;
    if (!pq.kickHit) return;
    if (Math.random() < T.noteBridgeChance) {
      this.noteBridge = { t: 0, dur: 5 + Math.random() * 2, tiles: [] };
      this.story?.markBeatTriggered("note-bridge", ["discovery", "transition", "heroic_payoff"]);
    }
  }

  #updateCampfire(pq, dt) {
    const T = ADVENTURE_TUNING;
    if (this.campfirePause) {
      const st = this.campfirePause;
      if (pq.heroCtl) {
        // a chapter took over — release the slowdown immediately, don't
        // let it linger and interact with the chapter's own scrollMul
        pq.adventureCtl = null;
        this.campfirePause = null;
        this.campfireCooldownUntil = pq.clock + T.campfireCooldownSeconds;
        return;
      }
      st.t += dt;
      const k = Math.min(1, st.t / 0.6, (st.dur - st.t) / 0.6);
      pq.adventureCtl = { scrollMul: 1 - 0.65 * k };
      if (st.t >= st.dur) {
        pq.adventureCtl = null;
        this.campfirePause = null;
        this.campfireCooldownUntil = pq.clock + T.campfireCooldownSeconds;
      }
      return;
    }
    if (this.mood.state !== "calm") return;
    if (pq.egg || pq.heroCtl || pq.adventureCtl || this.noteBridge) return;
    if (this.arrival.phase === "arriving") return; // the arrival owns the moment
    if ((this.campfireCooldownUntil || -999) > pq.clock) return;
    const off = pq.scrollX * 0.7; // same parallax factor drawProps uses for attractions
    const L = pq.worldLen;
    const heroX = pq.pw * pq.heroAnchor;
    for (const at of pq.attractions) {
      if (at.type !== "campfire") continue;
      const sx = (((at.x - off) % L) + L) % L;
      if (sx < heroX - 30 || sx > heroX + 60) {
        at._cfChecked = false; // reset once it's scrolled well clear
        continue;
      }
      if (sx > heroX - 4 && sx < heroX + 10 && !at._cfChecked) {
        at._cfChecked = true;
        if (Math.random() < T.campfirePauseChance) {
          const [lo, hi] = T.campfirePauseDuration;
          this.campfirePause = { t: 0, dur: lo + Math.random() * (hi - lo) };
          this.story?.markBeatTriggered("campfire", ["quiet_emotion", "friendship", "ambient"]);
        }
        this.campfireCooldownUntil = pq.clock + T.campfireCooldownSeconds;
        break;
      }
    }
  }

  draw(o, pal, layer) {
    const pq = this.pq;
    if (layer === "destination") {
      this.destination.draw(o, pq, pal, this.mood, this.arrival.journey, this.orb.charge);
      this.#drawArrivalFlourish(o, pq, pal);
    }
    if (layer === "midground") this.#drawNoteBridge(o, pq, pal);
    // Encounter Moments v1: "bg" elements sit behind props/terrain/hero,
    // "fg" elements in front of the hero + orb (see the render pipeline)
    if (layer === "encounter-bg") this.encounters.draw(o, pal, "bg");
    if (layer === "encounter-fg") this.encounters.draw(o, pal, "fg");
  }

  // the arrival flourish lives right at the destination's own on-screen
  // spot — sparkles gathering, vines pulsing, a torch flaring — so the
  // payoff visually reads as "he made it there", not a separate effect
  #drawArrivalFlourish(o, pq, pal) {
    const a = this.arrival;
    if (a.phase === "traveling") return;
    const s = a.phase === "arriving" ? clamp01(0.4 + (a.seqT / Math.max(0.1, a.seqDur)) * 0.6) : (a.journey - ARRIVAL_TUNING.approachAt) / (1 - ARRIVAL_TUNING.approachAt);
    const fn = ARRIVAL_FLOURISH[pal?.biome];
    if (fn) fn(o, pq, this.destination.lastX, this.destination.lastY, clamp01(s));
  }

  // Biome System v1 -> Step 3: a short flourish over the crossfade already
  // in progress (pq.biomeT), flavored by whichever biome is being LEFT
  // (currentBiome() still names the outgoing biome for the whole crossfade
  // — see pixelquest.js's biome-clock comment). Called once per frame from
  // the very end of the render pipeline (the "screen effects" layer).
  drawTransitionEffect(o, pal) {
    const pq = this.pq;
    if (pq.biomeT >= 1) return;
    const type = this._forcedTransitionType || TRANSITION_TYPES[pq.currentBiome().name] || "horizon-fade";
    const fn = TRANSITION_DRAW[type];
    const chargeBoost = 1 + this.orb.charge * 0.3; // full/high charge enhances the unlock
    if (fn) fn(o, pq, pq.biomeT, chargeBoost);
    if (pq.biomeT > 0.97) this._forcedTransitionType = null; // one-shot debug override
  }

  // Music Note Bridge (Biome System v1): same appear-on-beat mechanic
  // everywhere, restyled per biome — note tiles, glowing vine, moonlit
  // stepping stone, neon grid tile, or a stone block underfoot.
  #drawNoteBridge(o, pq, pal) {
    const st = this.noteBridge;
    if (!st) return;
    const skin = BRIDGE_SKINS[pal?.biome] || BRIDGE_SKINS["meadow-road"];
    const gy0 = pq.groundY(Math.round(pq.pw * pq.heroAnchor)) + 1;
    const fadeOut = st.t > st.dur - 0.6 ? Math.max(0, (st.dur - st.t) / 0.6) : 1;
    // Quest System v1: a charged-up orb makes the bridge feel stronger —
    // brighter glow, a touch wider — without changing the tile mechanic
    const chargeBoost = 1 + this.orb.charge * 0.5;
    for (const tile of st.tiles) {
      const age = st.t - tile.born;
      const a = Math.min(1, age / 0.3) * fadeOut;
      if (a <= 0.02) continue;
      const x = tile.x;
      const y = gy0 - 3 - Math.round(Math.sin(pq.t * 3 + tile.x) * 1);
      o.fillStyle = `rgba(${skin.glow},${0.16 * a * chargeBoost})`;
      o.fillRect(x - 2, y - 3, 5, 6);
      o.fillStyle = `rgba(${skin.core},${Math.min(1, 0.9 * a * chargeBoost)})`;
      skin.shape(o, x, y);
    }
  }

  drawOrb(o, pal) {
    this.orb.draw(o, this.pq, this.mood, this.arrival, this.destination.lastX, this.destination.lastY);
  }
  drawOrbOverlay(ctx, sx, sy) {
    this.orb.drawOverlay(ctx, this.pq, sx, sy);
  }

  drawFragments(o, pal) {
    this.fragments.draw(o, this.pq, pal);
  }

  // ---------------------------------------------------------- debug/test API
  forceMood(state) {
    if (!clampState(state)) return;
    this.mood.state = state;
    this.mood.candidate = state;
    const e = { calm: 0.08, steady: 0.38, energetic: 0.55, peak: 0.85, breakdown: 0.2 }[state];
    this.mood.energy = e;
    this.mood.longEnergy = state === "breakdown" ? 0.5 : e;
  }
  forceOrbVisible(on) {
    this.orb.visible = on;
  }
  forceDoor() {
    // the "Locked Door Moment" beat IS the existing secret_door cameo
    this.pq.events.forceStart("secret_door");
  }
  forceBridge() {
    // clear anything that would otherwise block or fight it, so the forced
    // trigger is guaranteed to actually show up
    this.pq.adventureCtl = null;
    this.campfirePause = null;
    this.noteBridge = { t: 0, dur: 6, tiles: [] };
    this.noteBridgeCooldownUntil = -999;
  }
  forceCampfire() {
    this.noteBridge = null;
    const [lo, hi] = ADVENTURE_TUNING.campfirePauseDuration;
    this.campfirePause = { t: 0, dur: lo + Math.random() * (hi - lo) };
    this.campfireCooldownUntil = -999;
  }
  forceDestination(kind) {
    this.destination.forceKind(kind);
  }
  // cancels any in-progress adventure beat and clears world-speed overrides
  // — handy between QA passes so the next forced trigger starts clean
  clearBeats() {
    this.noteBridge = null;
    this.campfirePause = null;
    this.pq.adventureCtl = null;
    this.pq.reaction = null;
  }

  // ------------------------------------------------- biome debug/test API
  // (delegates to PixelQuest, which owns biome state — see pixelquest.js's
  // "biome manager" section, right below palette()/rgbPal())
  forceBiome(id) {
    this.pq.forceBiome(id);
  }
  nextBiome() {
    this.pq.nextBiome();
  }
  previousBiome() {
    this.pq.previousBiome();
  }
  toggleFastBiomeCycling() {
    return this.pq.toggleFastBiomeCycling();
  }
  listBiomes() {
    return this.pq.allBiomeIds();
  }

  // ---------------------------------------------- journey/arrival debug API
  forceJourney(v) {
    this.arrival.forceJourney(v);
  }
  forceArrivalNow() {
    this.arrival.forceArrivalNow(this.pq);
  }
  // skips straight to the payoff → hands off to the biome-swap machinery,
  // same as if an arrival sequence had just finished naturally
  forceTransitionNow() {
    this.pq.triggerBiomeTransitionNow?.();
  }
  forceTransitionType(type) {
    if (!ALL_TRANSITION_TYPES.includes(type)) return;
    this._forcedTransitionType = type;
  }
  // jump straight to a biome AND force its arrival, for one-shot testing
  // of each biome's specific payoff
  forceBiomeArrival(id) {
    this.pq.forceBiome(id);
    this.arrival._lastBiomeIdx = this.pq.biomeIdx; // don't let the biome-change reset undo this
    this.arrival.forceArrivalNow(this.pq);
  }

  // ------------------------------------------- quest/collectible debug API
  forceSpawnFragments(n = 8) {
    this.fragments.forceSpawn(this.pq, n);
  }
  setOrbCharge(v) {
    this.orb.charge = clamp01(v);
  }
  toggleFragmentSpawning() {
    this.fragments.spawningEnabled = !this.fragments.spawningEnabled;
    return this.fragments.spawningEnabled;
  }
  forceCollectAllFragments() {
    this.fragments.forceCollectAll(this.pq);
  }

  // ------------------------------------------- asset system debug/test API
  setRenderMode(mode) {
    if (["procedural_fallback", "asset_standard", "asset_showcase"].includes(mode)) this.pq.cfg.renderMode = mode;
    return this.pq.cfg.renderMode;
  }
  assetStatus() {
    const s = this.pq.assets.summary();
    return { mode: this.pq.cfg.renderMode, detail: this.pq.cfg.detail, external: s.external, baked: s.baked, procedural: s.procedural, sprites: this.pq.assets.status(), plates: s.plates };
  }
  // re-attempt external PNG loads live — drop art in public/assets/pixelquest/
  // then call this (no page reload needed) to see it immediately
  reloadAssets() {
    this.pq.assets.reload();
    return "re-attempting external asset loads…";
  }
  togglePerfDebug() {
    this.pq.cfg.perfDebug = !this.pq.cfg.perfDebug;
    return this.pq.cfg.perfDebug;
  }
  toggleAssetDebug() {
    this.pq.cfg.assetDebug = !this.pq.cfg.assetDebug;
    return this.pq.cfg.assetDebug;
  }

  // detail preset: pi_safe | standard | showcase (stars/flora rebuilt live)
  setDetail(level) {
    if (!["pi_safe", "standard", "showcase"].includes(level)) return this.pq.cfg.detail;
    this.pq.cfg.detail = level;
    // stars/flora density are built in the constructor — rebuild them here
    // with a fresh deterministic layout so the preset applies immediately
    const pq = this.pq;
    const n = level === "pi_safe" ? 56 : level === "showcase" ? 130 : 100;
    while (pq.stars.length > n) pq.stars.pop();
    while (pq.stars.length < n)
      pq.stars.push({ x: Math.random() * 512, y: 2 + Math.random() * 56, ph: Math.random() * TAU, sp: 1.5 + Math.random() * 4, bright: Math.random() < 0.14 });
    return level;
  }

  // ------------------------------------------------ encounter debug/test API
  forceEncounter(id) {
    return this.encounters.forceEncounter(id);
  }
  endEncounter() {
    this.encounters.endEncounter();
  }
  toggleEncounterSpawning() {
    return this.encounters.toggleSpawning();
  }
  setEncounterFrequency(mul) {
    this.encounters.setFrequency(mul);
  }

  // ---------------------------------------------- story engine debug/test API
  setStoryTextMode(mode) {
    if (["off", "minimal", "cinematic"].includes(mode)) this.story.storyTextMode = mode;
    return this.story.storyTextMode;
  }
  showStoryCard(text, kind = "moment") {
    this.story.timeSinceLastTextCard = 999; // bypass cooldown for a forced preview
    this.story.card = null;
    this.story.card = { text, kind, t: 0 };
  }
  toggleStoryDebug() {
    this.pq.cfg.storyDebug = !this.pq.cfg.storyDebug;
    return this.pq.cfg.storyDebug;
  }
  storyStatus() {
    return this.story.status();
  }

  // one-call snapshot for console inspection
  status() {
    return {
      mood: this.mood.state,
      energy: Math.round(this.mood.energy * 100) / 100,
      orbVisible: this.orb.visible,
      destination: this.destination.kind,
      noteBridge: !!this.noteBridge,
      campfirePause: !!this.campfirePause,
      reaction: this.pq.reaction ? this.pq.reaction.type : null,
      biome: this.pq.currentBiome().name,
      biomeTimeLeft: Math.max(0, Math.round(this.pq.biomeDur - this.pq.biomeTimer)),
      biomeTransitioning: this.pq.biomeT < 1,
      journey: Math.round(this.arrival.journey * 100) / 100,
      journeyPhase: this.arrival.phase,
      transitionType: this._forcedTransitionType || TRANSITION_TYPES[this.pq.currentBiome().name],
      orbCharge: Math.round(this.orb.charge * 100) / 100,
      fragmentCount: this.fragments.items.length,
      fragmentSpawning: this.fragments.spawningEnabled,
      encounter: this.encounters.statusLine(),
      encounterSpawning: this.encounters.spawningEnabled,
      story: this.story.status(),
    };
  }
}
