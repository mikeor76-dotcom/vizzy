// ============================================================================
// World Resonance — a DIEGETIC music analyzer for Pixel Quest.
//
// The song is a natural magical force inside the world. Instead of EQ bars or a
// UI overlay, the audio surfaces as things that already belong in a moonlit
// side-scroller:
//   • Songstream   — music-light (motes, tiny notes, sparks, ribbons) flowing
//                    through the air toward the orb.       (mids/highs/energy)
//   • ResonancePath — a glow travelling along the ground/path.   (the bass EQ)
//   • (Orb Meter + Environment Resonance live in the orb + scene draws and read
//      the same section state exposed here.)
//
// Design rules:
//   • Reuse only the audio features PixelQuest already computes — no new FFT.
//   • Pool + cap everything; budgets shrink on pi_safe so a Pi 5 stays smooth.
//   • Pixel-art on the low-res buffer (fillRect), never a pasted-on overlay.
//   • Obvious within 3 seconds, but never chaotic — section state keeps it
//     sparse in intros/breakdowns and only blooms in the chorus.
// ============================================================================

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

// One shared visual language with the orb's Sound Fragments: a cyan-white
// ENERGY core (always "music energy") wrapped in a biome-tinted halo (local
// flavor). Keeps the whole field reading as one system.
const STREAM_ENERGY = "185,242,255";
const STREAM_HALO = {
  "meadow-road": "255,226,150", // firefly gold
  "neon-forest": "182,132,255", // spore violet
  "moonlit-town": "202,216,255", // moonlight silver-blue
  "arcade-ruins": "112,236,255", // neon cyan
  "castle-approach": "255,206,150", // torch warm
};
const haloFor = (pal) => STREAM_HALO[pal?.biome] || STREAM_HALO["meadow-road"];

// Per-detail budgets. The Pi runs "pi_safe", so it gets the smallest pools.
export function resonanceBudget(pq) {
  const d = pq?.cfg?.detail;
  if (d === "pi_safe") return { motes: 26, ribbons: 4, waves: 3, ripples: 3, sparks: 2, pathStep: 2 };
  if (d === "showcase") return { motes: 66, ribbons: 8, waves: 5, ripples: 4, sparks: 4, pathStep: 1 };
  return { motes: 46, ribbons: 6, waves: 4, ripples: 4, sparks: 3, pathStep: 1 };
}

// ---------------------------------------------------------------------------
// Song section inference. Wraps the existing AdventureMood (calm/steady/
// energetic/peak/breakdown) into named song sections and, crucially, the RISING
// vs FALLING trend of energy — so a swelling verse reads as a "build" and a
// falling one as an "outro" even at the same instantaneous level. Everything
// else in the file multiplies by `intensity` and the section `profile`.
// ---------------------------------------------------------------------------
const SECTION_PROFILE = {
  intro: { density: 0.28, speed: 0.72, bright: 0.55 },
  groove: { density: 0.62, speed: 1.0, bright: 0.85 },
  build: { density: 0.85, speed: 1.2, bright: 1.0 },
  chorus: { density: 1.0, speed: 1.38, bright: 1.2 },
  breakdown: { density: 0.32, speed: 0.6, bright: 0.55 },
  outro: { density: 0.16, speed: 0.5, bright: 0.36 },
};

export class SongSection {
  constructor() {
    this.state = "intro";
    this._cand = "intro";
    this._dwell = 0;
    this.since = 0; // seconds held in the current section
    this.intensity = 0; // smooth master strength 0..1 (gate·energy·density)
    this.rising = 0; // smoothed energy trend, -1..1
    this.profile = SECTION_PROFILE.intro;
    this._prevE = 0;
  }
  update(pq, mood, dt) {
    const e = mood?.energy || 0;
    const le = mood?.longEnergy || 0;
    const gate = pq.gate || 0;
    const slope = (e - this._prevE) / Math.max(dt, 1e-3);
    this._prevE = e;
    this.rising += (clamp01(slope * 1.2 + 0.5) * 2 - 1 - this.rising) * Math.min(1, dt * 3);

    let target;
    if (gate < 0.18) target = "outro";
    else if (mood.state === "peak") target = "chorus";
    else if (mood.state === "breakdown") target = "breakdown";
    else if (mood.state === "energetic") target = this.rising > 0.12 ? "build" : "chorus";
    else if (mood.state === "steady") target = this.rising > 0.25 ? "build" : "groove";
    else target = le < 0.14 && this.rising > -0.1 ? "intro" : gate < 0.4 ? "outro" : "groove"; // calm

    if (target === this._cand) this._dwell += dt;
    else { this._cand = target; this._dwell = 0; }
    if (this._dwell > 0.8 && target !== this.state) { this.state = target; this.since = 0; }
    this.since += dt;
    this.profile = SECTION_PROFILE[this.state];

    const it = clamp01(0.15 + e * 0.95) * gate * this.profile.density;
    this.intensity += (it - this.intensity) * Math.min(1, dt * 2.5);
  }
}

// ---------------------------------------------------------------------------
// Songstream — music-light flowing through the air toward the orb.
//   mote  : ambient glowing energy speck  (energy + melody level → density)
//   note  : a tiny eighth-note glyph      (RHYTHM-BORN ONLY: kicks launch 2-4
//           from the ground, snares drop one from the air — never random)
//   spark : a firefly twinkle             (highs/transients → rate)
//   ribbon: a soft golden/blue streamer   (sustained mids → rare, thicker)
// Spawns across the WHOLE screen — left and right — so everything visibly
// converges on the orb from both sides. Capped push+filter (same pattern as
// PixelQuest.particles) keeps it allocation-light.
// ---------------------------------------------------------------------------
export class Songstream {
  constructor() {
    this.parts = [];
    this.ribbons = [];
    this._moteAcc = 0;
    this._prevTre = 0;
    this._ribbonCd = 0;
  }

  // let the world feed the stream — e.g. a flower releasing a mote on a high.
  emitAt(pq, type, x, y) {
    if (this.parts.length >= (this._cap || 46)) return;
    const toOrb = this._target || { x: pq.pw * 0.3, y: pq.ph * 0.5 };
    const ang = Math.atan2(toOrb.y - y, toOrb.x - x);
    this.parts.push({
      type, x, y,
      vx: Math.cos(ang) * 6, vy: Math.sin(ang) * 6 - 4,
      age: 0, life: 2.2 + Math.random() * 1.4, ph: Math.random() * TAU, seed: Math.random(),
    });
  }

  _spawn(pq, section, kind, bandY) {
    const pw = pq.pw, gb = pq.groundBase();
    const x = pw * 0.05 + Math.random() * (pw * 0.92); // full width — both sides of the orb
    // motes/notes rise out of the world (lower); sparks ride the air (upper)
    const y = bandY != null ? bandY : lerp(pq.ph * 0.2, gb - 6, kind === "spark" ? Math.random() * 0.5 : 0.35 + Math.random() * 0.55);
    this.parts.push({
      type: kind, x, y,
      vx: -(4 + Math.random() * 5), vy: (Math.random() - 0.5) * 6,
      age: 0, life: 2.6 + Math.random() * 1.8, ph: Math.random() * TAU, seed: Math.random(),
    });
  }

  update(pq, mood, section, dt, target) {
    const B = resonanceBudget(pq);
    this._cap = B.motes;
    this._target = target;
    const energy = pq.energy || 0;
    const mids = pq.mids?.value || 0;
    const tre = pq.treble?.value || 0;
    const spd = section.profile.speed;
    const dens = section.profile.density;
    const alive = section.intensity; // 0 in silence → no spawns

    // ---- spawn ----
    if (alive > 0.02) {
      // NOTES ARE RHYTHM-BORN, PERIOD: a note glyph only ever appears on a
      // kick (2-4, launching from the ground ACROSS THE WHOLE SCREEN, left and
      // right, all converging on the orb) or a snare (one from the air). No
      // random trickle — if you see a note, the song just did something.
      const bornNote = (x, y, vy) => {
        this.parts.push({
          type: "note", x, y, vx: 0, vy, age: 0,
          life: 2.8 + Math.random() * 1.2, ph: Math.random() * TAU, seed: Math.random(),
          big: section.state === "chorus" && Math.random() < 0.35, // chorus hero-notes
        });
      };
      if (pq.kickHit) {
        const n = Math.min(4, 2 + ((pq.driveFx || 0) > 0.6 ? 1 : 0) + (section.state === "chorus" ? 1 : 0));
        for (let i = 0; i < n && this.parts.length < B.motes; i++) {
          const x = pq.pw * 0.04 + Math.random() * pq.pw * 0.92; // full width, both sides of the orb
          if (Math.abs(x - target.x) < 20) continue; // not right on top of the orb
          const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, Math.round(x)))) - 2;
          bornNote(x, gy, -16);
        }
      }
      if (pq.snareHit && this.parts.length < B.motes) {
        const x = pq.pw * 0.1 + Math.random() * pq.pw * 0.85;
        bornNote(x, lerp(pq.ph * 0.22, pq.ph * 0.5, Math.random()), -6);
      }
      // ambient motes carry the continuous energy + melody level (the old
      // random NOTE trickle lives here now, as plain motes)
      this._moteAcc += (1.4 + energy * 5 + mids * 3.5) * dens * dt;
      while (this._moteAcc >= 1 && this.parts.length < B.motes) { this._moteAcc -= 1; this._spawn(pq, section, "mote"); }
      // sparks: a crisp one-frame scatter on each snare + on rising treble
      const treRise = tre - this._prevTre;
      if ((treRise > 0.1 || pq.snareHit) && this.parts.length < B.motes) {
        const n = Math.min(B.sparks, 1 + Math.round(tre * 3));
        for (let i = 0; i < n && this.parts.length < B.motes; i++) this._spawn(pq, section, "spark");
      }
      // ribbons: sustained mids, rare + thick; never in breakdown/outro
      this._ribbonCd -= dt;
      if (this._ribbonCd <= 0 && mids > 0.3 && dens > 0.5 && this.ribbons.length < B.ribbons) {
        this._ribbonCd = 0.5 + Math.random() * 0.8;
        const pw = pq.pw, y = lerp(pq.ph * 0.28, pq.groundBase() - 10, Math.random());
        this.ribbons.push({
          x: pw + 6, y, age: 0, life: 3 + Math.random() * 2,
          warm: Math.random() < 0.6, ph: Math.random() * TAU, ti: 0,
          trail: Array.from({ length: 6 }, () => ({ x: pw + 6, y })),
        });
      }
    }
    this._prevTre = tre;

    // ---- advance particles toward the orb ----
    // A gentle CURRENT: each mote cruises toward the orb at a modest speed (so a
    // visible stream lingers en route, ~2-3s transit) with a sideways waft.
    // Beat-born notes carry a launch kick (vy) that decays as the flow catches
    // them. Reaching the orb FEEDS it: a small absorb-flash per arrival, so the
    // orb visibly blinks brighter with every note it swallows.
    const orb = pq.adventure?.orb;
    for (const p of this.parts) {
      p.age += dt;
      const dx = target.x - p.x, dy = target.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      const cruise = (14 + energy * 26) * spd; // px/s toward the orb
      p.x += ((dx / dist) * cruise + (p.vx || 0)) * dt + Math.cos(p.age * 3 + p.ph) * 7 * dt;
      p.y += ((dy / dist) * cruise + (p.vy || 0)) * dt + Math.sin(p.age * 2.4 + p.ph) * 7 * dt;
      const k = Math.exp(-dt * 2.2);
      p.vx = (p.vx || 0) * k;
      p.vy = (p.vy || 0) * k;
      if (dist < 7 && !p.fed) {
        p.fed = true;
        p.age = Math.max(p.age, p.life - 0.18); // fade into the orb
        if (orb) orb.absorbFlash = Math.min(1, (orb.absorbFlash || 0) + (p.type === "note" ? 0.5 : 0.25));
      }
    }
    this.parts = this.parts.filter((p) => p.age < p.life && p.x > -6 && p.y < pq.ph + 6);

    // ---- advance ribbons (a flowing head recording a short trail) ----
    for (const rb of this.ribbons) {
      rb.age += dt;
      const dx = target.x - rb.x, dy = target.y - rb.y;
      const dist = Math.hypot(dx, dy) || 1;
      rb.x += (dx / dist) * (30 * spd) * dt;
      rb.y += ((dy / dist) * (22 * spd) + Math.sin(rb.age * 3 + rb.ph) * 10) * dt;
      rb.ti = (rb.ti + 1) % rb.trail.length;
      rb.trail[rb.ti].x = rb.x; rb.trail[rb.ti].y = rb.y;
      if (dist < 6) rb.age = rb.life;
    }
    this.ribbons = this.ribbons.filter((rb) => rb.age < rb.life && rb.x > -8);
  }

  draw(o, pq, pal) {
    const halo = haloFor(pal);
    const bright = (pq.resonance?.section?.profile?.bright) || 1;
    // ribbons first (soft, behind the crisper motes)
    for (const rb of this.ribbons) {
      const fade = clamp01(Math.min(rb.age / 0.3, (rb.life - rb.age) / 0.6));
      if (fade <= 0.02) continue;
      const col = rb.warm ? halo : STREAM_ENERGY;
      for (let i = 0; i < rb.trail.length; i++) {
        const s = rb.trail[(rb.ti - i + rb.trail.length * 2) % rb.trail.length];
        const a = fade * (1 - i / rb.trail.length) * 0.5 * bright;
        if (a <= 0.03) continue;
        o.fillStyle = `rgba(${col},${a})`;
        o.fillRect(Math.round(s.x), Math.round(s.y), 2, 1);
      }
    }
    // motes / notes / sparks — SYNCHRONIZED SHIMMER: everything throbs together
    // on the beat (kickPulse decays over ~250ms) with a whisper of per-particle
    // variation, so the whole field reads as dancing to the song rather than
    // twinkling at random.
    const beat = pq.kickPulse || 0;
    for (const p of this.parts) {
      const fade = clamp01(Math.min(p.age / 0.25, (p.life - p.age) / 0.5));
      if (fade <= 0.03) continue;
      const tw = (0.6 + 0.4 * beat) * (0.9 + 0.18 * Math.sin(p.age * 2 + p.ph));
      const a = clamp01(fade * tw * bright);
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.type === "spark") {
        o.fillStyle = `rgba(255,250,220,${a})`;
        o.fillRect(x, y, 1, 1);
        if (a > 0.55) { o.fillStyle = `rgba(255,250,220,${a * 0.5})`; o.fillRect(x - 1, y, 3, 1); o.fillRect(x, y - 1, 1, 3); }
      } else if (p.type === "note" && p.big) {
        // chorus hero-note: a bigger glyph that reads from across the room.
        // Glow is a soft DISC (never a rectangle — boxes read as tiles).
        o.fillStyle = `rgba(${halo},${a * 0.28})`;
        pq.pixelDisc(o, x + 1, y - 2, 4);
        o.fillStyle = `rgba(${STREAM_ENERGY},${a})`;
        o.fillRect(x, y, 3, 3); // head
        o.fillRect(x + 3, y - 6, 1, 8); // stem
        o.fillRect(x + 3, y - 6, 3, 1); // flag
        o.fillRect(x + 3, y - 5, 2, 1); // flag taper
      } else if (p.type === "note") {
        // bare glyph — bright enough on the night sky without any backing halo
        o.fillStyle = `rgba(${STREAM_ENERGY},${a})`;
        o.fillRect(x, y, 2, 2); // head
        o.fillRect(x + 2, y - 4, 1, 6); // stem (taller — legible at wall distance)
        o.fillRect(x + 2, y - 4, 2, 1); // flag
      } else {
        // mote: a tiny diamond glow instead of a square
        o.fillStyle = `rgba(${halo},${a * 0.35})`;
        pq.pixelDisc(o, x, y, 1);
        o.fillStyle = `rgba(${STREAM_ENERGY},${a})`; o.fillRect(x, y, 1, 1);
        if (a > 0.7) { o.fillStyle = `rgba(235,255,255,${a})`; o.fillRect(x, y, 1, 1); }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ResonancePath — the hidden BASS visualizer. A glow travels along the ground
// surface: brighter where the low end is stronger (per-column, from the same
// groundPts swell the terrain rides on), kicks fire a pulse-wave that races
// outward from the hero, and strong beats drop a ripple ring at his feet.
// Low energy → it nearly vanishes.
// ---------------------------------------------------------------------------
export class ResonancePath {
  constructor() {
    this.waves = []; // {x, age}  travelling outward from the hero both ways
    this.ripples = []; // {age}    expanding ring at the hero's feet
    this._prevKick = 0;
  }
  // sample the terrain's low-band swell at column x (mirrors groundY's interp)
  _swellAt(pq, x) {
    const gp = pq.groundPts;
    if (!gp || !gp.length) return 0;
    const u = (x / pq.pw) * (gp.length - 1);
    const i0 = Math.max(0, Math.min(gp.length - 2, Math.floor(u)));
    const f = u - i0, sm = f * f * (3 - 2 * f);
    return gp[i0] + (gp[i0 + 1] - gp[i0]) * sm;
  }
  update(pq, section, dt) {
    const kick = pq.kickPulse || 0;
    // rising edge of a kick → a new pulse-wave + (on a strong one) a foot ripple
    if (pq.kickHit && (pq.gate || 0) > 0.25 && section.intensity > 0.05) {
      const hx = pq.heroScreenX != null ? pq.heroScreenX : pq.pw * pq.heroAnchor;
      if (this.waves.length < resonanceBudget(pq).waves) this.waves.push({ x: hx, age: 0 });
      if (kick > 0.7 && this.ripples.length < resonanceBudget(pq).ripples) this.ripples.push({ age: 0 });
    }
    this._prevKick = kick;
    for (const w of this.waves) w.age += dt;
    for (const r of this.ripples) r.age += dt;
    this.waves = this.waves.filter((w) => w.age < 1.1);
    this.ripples = this.ripples.filter((r) => r.age < 0.6);
  }
  draw(o, pq, pal, section) {
    const glow = section.intensity;
    if (glow <= 0.02) return;
    const pw = pq.pw, S = pq.S;
    const bass = pq.bass?.value || 0;
    const kick = pq.kickPulse || 0;
    const warm = pal.firefly;
    const step = resonanceBudget(pq).pathStep;
    const hx = pq.heroScreenX != null ? pq.heroScreenX : pw * pq.heroAnchor;

    // 1) ambient warm glow along the surface — brighter where the low end is
    //    stronger (per-column low-band swell); every kick flashes the whole path.
    for (let x = 0; x < pw; x += step) {
      const gy = pq.groundY(x);
      const sw = this._swellAt(pq, x); // 0..~1 low-band energy at this column
      const a = (0.07 + sw * 0.55 + bass * 0.26 + kick * 0.2) * glow * section.profile.bright;
      if (a <= 0.03) continue;
      o.fillStyle = pq.col(warm, Math.min(0.72, a));
      o.fillRect(x, gy, step, 1);
      if (a > 0.28) { o.fillStyle = pq.col(warm, Math.min(0.45, (a - 0.28) * 0.9)); o.fillRect(x, gy - 1, step, 1); }
    }

    // 2) kick PULSE-WAVES — a bright COOL crest racing outward from the hero in
    //    both directions. Cool energy-white stands out against the warm grass,
    //    so a beat visibly travels along the ground.
    for (const w of this.waves) {
      const env = 1 - clamp01(w.age / 1.1);
      if (env <= 0.05) continue;
      const front = w.age * (150 + bass * 90) * S * 0.25;
      const a = env * (0.55 + glow * 0.4);
      for (const cx of [w.x - front, w.x + front]) {
        const xi = Math.round(cx);
        if (xi < -2 || xi > pw + 2) continue;
        const gy = pq.groundY(Math.max(0, Math.min(pw - 1, xi)));
        o.fillStyle = `rgba(210,245,255,${Math.min(0.85, a)})`;
        o.fillRect(xi - 1, gy - 1, 3, 1);
        o.fillRect(xi, gy, 1, 1);
        o.fillStyle = `rgba(210,245,255,${Math.min(0.4, a * 0.5)})`;
        o.fillRect(xi - 2, gy, 5, 1);
      }
    }

    // 3) foot ripples — a small expanding ring where he steps on the beat
    for (const r of this.ripples) {
      const k = r.age / 0.6;
      const rad = Math.round(2 + k * 9 * S * 0.5);
      const a = (1 - k) * 0.5 * glow;
      if (a <= 0.03) continue;
      const gy = pq.groundY(Math.max(0, Math.min(pw - 1, Math.round(hx))));
      o.fillStyle = pq.col(warm, a);
      o.fillRect(Math.round(hx - rad), gy, 1, 1);
      o.fillRect(Math.round(hx + rad), gy, 1, 1);
      o.fillRect(Math.round(hx - rad * 0.6), gy - 1, 1, 1);
      o.fillRect(Math.round(hx + rad * 0.6), gy - 1, 1, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — one object PixelQuest owns. update() once per frame (after the
// mood is fresh); drawGround() on the terrain surface, drawStream() in the air
// in front of the hero. The orb + scene read `.section` directly.
// ---------------------------------------------------------------------------
export class WorldResonance {
  constructor() {
    this.section = new SongSection();
    this.stream = new Songstream();
    this.path = new ResonancePath();
  }
  update(pq, mood, dt) {
    this.pq = pq;
    this.section.update(pq, mood, dt);
    const orb = pq.adventure?.orb;
    const target =
      orb?.visible && pq.heroScreenX != null ? orb.targetPos(pq) : { x: pq.pw * 0.3, y: pq.ph * 0.45 };
    this.stream.update(pq, mood, this.section, dt, target);
    this.path.update(pq, this.section, dt);
  }
  drawGround(o, pal) { if (this.pq) this.path.draw(o, this.pq, pal, this.section); }
  drawStream(o, pal) { if (this.pq) this.stream.draw(o, this.pq, pal); }
}
