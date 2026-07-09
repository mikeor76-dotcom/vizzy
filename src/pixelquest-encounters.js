// Pixel Quest — Encounter Moments v1.
//
// Short, music-powered story beats: a silhouette blocks the path, a gentle
// giant reaches down, an arcade face lights up, an owl glides over, a storm
// gate charges, a tiny rival races by. NOT a combat/score/health system —
// no damage, no bars, no dialogue. Each encounter is a small animated beat:
//   Travel -> Encounter appears -> Character reacts -> Music/orb resolves
//   it -> Small payoff (sound fragments) -> Continue.
//
// This is a LIGHTWEIGHT manager owned by PixelQuestAdventureManager rather
// than an extension of the special-event system in pixelquest-events.js —
// encounters lean entirely on adventure-layer state (mood, the orb, Sound
// Fragments, the arrival phase), and the heavier chapter set-pieces there
// steer the hero through heroCtl in a way encounters deliberately don't.
// The events manager DOES quiet its random cameos while a major encounter
// runs (see EncounterManager.suppressCameos + the check in that file),
// mirroring how arrivals already suppress cameos.

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// per-biome accent palette so each encounter inherits the world's look
const ENCOUNTER_ACCENT = {
  "meadow-road": { glow: "255,225,140", dark: "26,30,20", eye: "255,244,190" },
  "neon-forest": { glow: "170,110,255", dark: "20,14,32", eye: "150,255,230" },
  "moonlit-town": { glow: "210,220,255", dark: "18,20,32", eye: "235,240,255" },
  "arcade-ruins": { glow: "255,90,200", dark: "12,10,20", eye: "80,230,255" },
  "castle-approach": { glow: "255,190,110", dark: "24,20,28", eye: "255,222,164" },
};
const accent = (pal) => ENCOUNTER_ACCENT[pal?.biome] || ENCOUNTER_ACCENT["meadow-road"];

// phase envelope helpers shared by the draws: fade a shape in during
// "entering", hold through "active", and out during "resolving"/"exiting"
function presence(st) {
  if (st.phase === "entering") return st.phaseP;
  if (st.phase === "exiting") return 1 - st.phaseP;
  if (st.phase === "resolving") return 1; // resolving shapes handle their own dissolve
  return 1;
}

// ---------------------------------------------------------- the encounters
// Each: metadata + hooks. Hooks receive (pq, mood, st, pal[, dt]). `st`
// holds phase/p/phaseP/data/intensity. Draw hooks split into drawBg (behind
// props/hero) and drawFg (in front of hero/orb). Everything reads audio and
// mood live, so quiet music yields softer versions automatically.
const ENCOUNTERS = [
  // A. Shadow Guardian — a large, non-scary silhouette blocking the path.
  {
    id: "shadow-guardian",
    name: "Shadow Guardian",
    storyTags: ["danger", "obstacle", "mystery"],
    compatibleBiomes: ["neon-forest", "castle-approach"],
    preferredMoods: ["energetic", "peak"],
    rarity: "rare",
    major: true,
    duration: 8,
    layer: "fg",
    onEnter(pq) {
      pq.triggerReaction?.("stepback", 0.7);
    },
    onActive(pq, mood, st, pal, dt) {
      // on the kick it flinches back, then eases forward again
      if (pq.kickHit) st.data.recoil = 1;
      st.data.recoil = Math.max(0, (st.data.recoil || 0) - dt * 3);
      if (Math.random() < 0.01) pq.triggerReaction?.("lookup", 0.6);
    },
    onResolve(pq, mood, st, pal) {
      // it dissolves into a burst of fragments rising off the ground
      const cx = Math.round(pq.pw * 0.62);
      const n = 6 + Math.round((pq.adventure.orb.charge || 0) * 6);
      pq.adventure.fragments.spawnAt(pq, cx, pq.groundBase() - 20, n, 1);
      if (mood.energy > 0.5) pq.triggerReaction?.("celebrate", 0.9);
    },
    drawFg(o, pq, mood, st, pal) {
      const acc = accent(pal);
      const base = pq.groundBase();
      const cx = Math.round(pq.pw * 0.62);
      const a = presence(st) * 0.82;
      if (a <= 0.02) return;
      const H = Math.round(42 * pq.S);
      const W = Math.round(18 * pq.S);
      const sway = Math.sin(pq.t * 1.4) * 2;
      const bx = Math.round(cx + sway + (st.data.recoil || 0) * 5);
      const diss = st.phase === "resolving" ? st.phaseP : 0; // 0..1 dissolve
      const bodyA = a * (1 - diss);
      // rounded silhouette: tapered body + shoulders + head
      o.fillStyle = `rgba(${acc.dark},${bodyA})`;
      o.fillRect(bx - (W >> 1), base - H + Math.round(diss * H * 0.3), W, Math.round(H * (1 - diss * 0.3)));
      o.fillRect(bx - (W >> 1) + 2, base - H - 3, W - 4, 4);
      o.fillRect(bx - 4, base - H - 9, 8, 7);
      // soft glowing eyes, pulsing on the kick — never harsh
      const eyeA = bodyA * (0.55 + pq.kickPulse * 0.45);
      o.fillStyle = `rgba(${acc.eye},${eyeA})`;
      o.fillRect(bx - 3, base - H - 6, 2, 2);
      o.fillRect(bx + 1, base - H - 6, 2, 2);
      // dissolve pixels rising as it fades
      if (diss > 0) {
        for (let i = 0; i < 10; i++) {
          o.fillStyle = `rgba(${acc.glow},${(1 - diss) * 0.5})`;
          o.fillRect(bx + Math.round((Math.random() - 0.5) * W), base - Math.round(diss * H) - Math.round(Math.random() * 12), 1, 1);
        }
      }
    },
  },

  // B. Friendly Giant — a huge gentle creature far back, reaching down.
  {
    id: "friendly-giant",
    name: "Friendly Giant",
    storyTags: ["friendship", "discovery", "heroic_payoff"],
    compatibleBiomes: ["meadow-road", "castle-approach", "neon-forest"],
    preferredMoods: ["calm", "steady"],
    rarity: "uncommon",
    major: true,
    duration: 9,
    layer: "bg",
    onEnter(pq) {
      pq.triggerReaction?.("lookup", 1);
    },
    onResolve(pq, mood, st, pal) {
      // opens its hand: a gentle shower of sparkle fragments drifts down
      const hx = Math.round(pq.pw * 0.6);
      pq.adventure.fragments.spawnAt(pq, hx, Math.round(pq.ph * 0.34), 8, 1);
    },
    drawBg(o, pq, mood, st, pal) {
      const acc = accent(pal);
      const a = presence(st) * 0.72;
      if (a <= 0.02) return;
      const base = pq.groundBase();
      const cx = Math.round(pq.pw * 0.58);
      const bodyTop = Math.round(pq.ph * 0.12);
      // a soft glow halo so the gentle giant reads against dark biomes...
      o.fillStyle = `rgba(${acc.glow},${a * 0.1})`;
      o.fillRect(cx - 26, bodyTop - 2, 52, base - bodyTop + 2);
      // ...over a misty blue-grey body (never near-black — a friendly mist
      // creature, with the biome color carried by its eyes and its gift)
      o.fillStyle = `rgba(128,134,160,${a * 0.6})`;
      o.fillRect(cx - 22, bodyTop + 14, 44, base - bodyTop - 14);
      o.fillRect(cx - 14, bodyTop, 28, 20); // head
      // two gentle glowing eyes, looking down at the hero
      const look = Math.sin(pq.t * 0.6) * 1;
      o.fillStyle = `rgba(${acc.eye},${Math.min(1, a * 1.6)})`;
      o.fillRect(cx - 8 + Math.round(look), bodyTop + 8, 3, 3);
      o.fillRect(cx + 5 + Math.round(look), bodyTop + 8, 3, 3);
      // a lowering hand on the hero's side, dips further as it resolves
      const reachP = st.phase === "resolving" ? st.phaseP : clamp01(st.p * 1.4);
      const handY = bodyTop + 26 + Math.round(reachP * (base - bodyTop - 40));
      o.fillStyle = `rgba(128,134,160,${a * 0.6})`;
      o.fillRect(cx - 30, bodyTop + 24, 8, handY - bodyTop - 24); // arm
      o.fillRect(cx - 34, handY, 12, 6); // hand
      // palm glow, building through the encounter and blooming at resolve
      const palmA = (st.phase === "resolving" ? 0.4 + st.phaseP * 0.6 : 0.15 + st.p * 0.25) * a;
      o.fillStyle = `rgba(${acc.glow},${palmA})`;
      o.fillRect(cx - 33, handY + 1, 10, 4);
    },
  },

  // C. Arcade Boss Screen — a big retro monitor flashing to the beat.
  {
    id: "arcade-boss",
    name: "Arcade Boss Screen",
    storyTags: ["comedy", "obstacle", "music_energy"],
    compatibleBiomes: ["arcade-ruins"],
    preferredMoods: ["energetic", "peak"],
    rarity: "uncommon",
    major: true,
    duration: 8,
    layer: "bg",
    onEnter(pq) {
      pq.triggerReaction?.("lookup", 0.9);
    },
    onResolve(pq, mood, st, pal) {
      // releases a spray of neon token fragments
      const cx = Math.round(pq.pw * 0.6);
      pq.adventure.fragments.spawnAt(pq, cx, Math.round(pq.ph * 0.3), 9, 1);
    },
    drawBg(o, pq, mood, st, pal) {
      const acc = accent(pal);
      const a = presence(st);
      if (a <= 0.02) return;
      const cx = Math.round(pq.pw * 0.6);
      const cy = Math.round(pq.ph * 0.28);
      const w = Math.round(38 * pq.S);
      const h = Math.round(26 * pq.S);
      // a glowing neon bezel frame so the cabinet reads against the dark
      // arcade sky (a plain dark bezel would vanish)
      o.fillStyle = `rgba(${acc.glow},${a * (0.45 + pq.kickPulse * 0.4)})`;
      o.fillRect(cx - (w >> 1) - 3, cy - (h >> 1) - 3, w + 6, h + 6);
      o.fillStyle = `rgba(14,10,22,${a})`;
      o.fillRect(cx - (w >> 1) - 1, cy - (h >> 1) - 1, w + 2, h + 2); // inner bezel gap
      // screen: dark, then abstract pixel blocks light to the beat
      o.fillStyle = `rgba(10,8,18,${a})`;
      o.fillRect(cx - (w >> 1), cy - (h >> 1), w, h);
      const cols = 8;
      const rows = 5;
      const cw = w / cols;
      const ch = h / rows;
      const resolveFlash = st.phase === "resolving" ? 1 : 0;
      for (let r = 0; r < rows; r++) {
        for (let c2 = 0; c2 < cols; c2++) {
          // a wandering beat-driven pattern (no logos): bass fills lower
          // rows, treble the upper, plus a moving diagonal shimmer. A small
          // baseline keeps the screen alive even in quiet passages.
          const band = r / rows;
          const lvl = 0.25 + (band < 0.5 ? pq.bass.value : pq.treble.value);
          const wave = 0.5 + 0.5 * Math.sin(pq.t * 4 + c2 * 0.8 + r * 0.6);
          const on = (lvl * wave > 0.3 || resolveFlash) && Math.random() < 0.9;
          if (!on) continue;
          const col = (r + c2) % 2 ? acc.glow : acc.eye;
          o.fillStyle = `rgba(${col},${a * (0.45 + wave * 0.5) + resolveFlash * 0.3})`;
          o.fillRect(Math.round(cx - (w >> 1) + c2 * cw), Math.round(cy - (h >> 1) + r * ch), Math.ceil(cw) - 1, Math.ceil(ch) - 1);
        }
      }
      // a couple of subtle scanlines
      o.fillStyle = `rgba(0,0,0,${a * 0.25})`;
      for (let y = cy - (h >> 1); y < cy + (h >> 1); y += 3) o.fillRect(cx - (w >> 1), y, w, 1);
      // a stubby stand so it reads as a cabinet, not a floating screen
      o.fillStyle = `rgba(${acc.glow},${a * 0.35})`;
      o.fillRect(cx - 2, cy + (h >> 1) + 3, 4, Math.round(6 * pq.S));
    },
  },

  // D. Moon Owl — a glowing owl gliding across the upper sky.
  {
    id: "moon-owl",
    name: "Moon Owl",
    storyTags: ["mystery", "quiet_emotion", "discovery"],
    compatibleBiomes: ["moonlit-town", "meadow-road", "neon-forest"],
    preferredMoods: ["calm", "breakdown"],
    rarity: "uncommon",
    major: false,
    duration: 7,
    layer: "fg",
    onEnter(pq) {
      pq.triggerReaction?.("lookup", 1);
    },
    onResolve(pq, mood, st, pal) {
      // drops a single moonlight fragment near the hero's path
      const hx = pq.heroScreenX ?? pq.pw * pq.heroAnchor;
      pq.adventure.fragments.spawnAt(pq, Math.round(hx + 20), Math.round(pq.ph * 0.4), 2, 1);
    },
    drawFg(o, pq, mood, st, pal) {
      const acc = accent(pal);
      const a = presence(st) * 0.9;
      if (a <= 0.02) return;
      // glides left→right across the upper third on an eased arc
      const x = Math.round(pq.pw * (0.15 + st.p * 0.7));
      const y = Math.round(pq.ph * 0.2 + Math.sin(st.p * Math.PI) * -10);
      const flap = Math.sin(pq.t * (6 + (pq.mids.value || 0) * 8)); // wings ride the mids
      // a soft moonlit halo so the little owl reads against the sky
      o.fillStyle = `rgba(${acc.glow},${a * 0.16})`;
      pq.pixelDisc(o, x, y + 1, 5);
      o.fillStyle = `rgba(${acc.dark},${a})`;
      o.fillRect(x - 2, y, 5, 4); // body
      o.fillRect(x, y - 2, 1, 2); // ear tufts
      o.fillRect(x + 2, y - 2, 1, 2);
      // wings, alternating up/down with the flap
      const wy = flap > 0 ? -2 : 2;
      o.fillRect(x - 6, y + wy, 4, 1);
      o.fillRect(x + 3, y + wy, 4, 1);
      // glowing eyes
      o.fillStyle = `rgba(${acc.eye},${a * (0.7 + pq.treble.value * 0.3)})`;
      o.fillRect(x - 1, y + 1, 1, 1);
      o.fillRect(x + 1, y + 1, 1, 1);
      // high-frequency shimmer trailing behind
      if (pq.treble.value > 0.3 && Math.random() < 0.4) {
        o.fillStyle = `rgba(${acc.glow},${a * 0.5})`;
        o.fillRect(x - 6 - Math.round(Math.random() * 4), y + Math.round((Math.random() - 0.5) * 4), 1, 1);
      }
    },
  },

  // E. Storm Gate — a glowing gate ahead that the orb charges open.
  {
    id: "storm-gate",
    name: "Storm Gate",
    storyTags: ["danger", "obstacle", "arrival"],
    compatibleBiomes: ["castle-approach", "neon-forest", "arcade-ruins"],
    preferredMoods: ["energetic", "peak"],
    rarity: "rare",
    major: true,
    duration: 8,
    layer: "bg",
    onEnter(pq) {
      pq.triggerReaction?.("lean", 0.8);
    },
    onResolve(pq, mood, st, pal) {
      // gate opens: fragments spill out, and it nudges the journey along
      const cx = Math.round(pq.pw * 0.66);
      pq.adventure.fragments.spawnAt(pq, cx, pq.groundBase() - 18, 8, 1);
      pq.adventure.arrival.journey = clamp01(pq.adventure.arrival.journey + 0.06);
      if (mood.energy > 0.55) pq.triggerReaction?.("celebrate", 0.8);
    },
    drawBg(o, pq, mood, st, pal) {
      const acc = accent(pal);
      const a = presence(st);
      if (a <= 0.02) return;
      const base = pq.groundBase();
      const cx = Math.round(pq.pw * 0.66);
      const H = Math.round(34 * pq.S);
      const halfW = Math.round(13 * pq.S);
      // two pillars + an arch
      o.fillStyle = `rgba(${acc.dark},${a})`;
      o.fillRect(cx - halfW - 2, base - H, 4, H);
      o.fillRect(cx + halfW - 2, base - H, 4, H);
      o.fillRect(cx - halfW - 2, base - H - 3, halfW * 2 + 4, 4);
      // charge fills the gateway: from orbCharge + time, brightening
      const charge = pq.adventure.orb.charge || 0;
      const fill = clamp01((st.phase === "resolving" ? 1 : st.p * 0.7) + charge * 0.4);
      o.fillStyle = `rgba(${acc.glow},${a * fill * 0.5})`;
      o.fillRect(cx - halfW + 1, base - H + 2, halfW * 2 - 2, H - 2);
      // lightning-like pixel arcs on the kick, around the frame
      if (pq.kickHit || pq.kickPulse > 0.4) {
        o.fillStyle = `rgba(${acc.eye},${a * (0.5 + pq.kickPulse * 0.5)})`;
        let ly = base - H + 2;
        let lx = cx - halfW + Math.round(Math.random() * halfW * 2);
        for (let s = 0; s < 5; s++) {
          o.fillRect(lx, ly, 1, 2);
          lx += Math.round((Math.random() - 0.5) * 5);
          ly += Math.round(H / 5);
        }
      }
      // the orb's beam reaching the gate as it charges (from hero side)
      if (charge > 0.2 && st.phase !== "exiting") {
        const ox = (pq.heroScreenX ?? pq.pw * pq.heroAnchor) + 19;
        const oy = (pq.heroScreenY ?? base - 20) - 6;
        for (let i = 1; i < 6; i++) {
          if (Math.random() > 0.4) continue;
          const f = i / 6;
          o.fillStyle = `rgba(${acc.glow},${a * (0.2 + charge * 0.3)})`;
          o.fillRect(Math.round(ox + (cx - ox) * f), Math.round(oy + (base - H / 2 - oy) * f), 1, 1);
        }
      }
    },
  },

  // F. Tiny Rival — a small playful figure that races the hero, then waves.
  {
    id: "tiny-rival",
    name: "Tiny Rival",
    storyTags: ["comedy", "obstacle"],
    compatibleBiomes: ["meadow-road", "arcade-ruins", "moonlit-town"],
    preferredMoods: ["steady", "energetic"],
    rarity: "uncommon",
    major: false,
    duration: 6.5,
    layer: "fg",
    onActive(pq, mood, st, pal, dt) {
      // a little hop on the kick, like the hero
      if (pq.kickHit && (st.data.hopV || 0) === 0) st.data.hopV = -34;
      st.data.hopY = st.data.hopY || 0;
      if (st.data.hopY < 0 || (st.data.hopV || 0) < 0) {
        st.data.hopV = (st.data.hopV || 0) + 260 * dt;
        st.data.hopY = Math.min(0, st.data.hopY + st.data.hopV * dt);
        if (st.data.hopY === 0) st.data.hopV = 0;
      }
    },
    onResolve(pq, mood, st, pal) {
      // waves, then bursts into sparkles
      const rx = Math.round(pq.pw * 0.42);
      pq.adventure.fragments.spawnAt(pq, rx, pq.groundBase() - 8, 5, 1);
      pq.triggerReaction?.("celebrate", 0.7);
    },
    drawFg(o, pq, mood, st, pal) {
      const acc = accent(pal);
      const a = presence(st);
      if (a <= 0.02) return;
      // stays a little ahead of the hero; pulls slightly further with energy
      const rx = Math.round(pq.pw * (0.4 + mood.energy * 0.04));
      const base = pq.groundY(rx);
      const hop = Math.round(st.data.hopY || 0);
      const y = base - 8 + hop;
      const step = Math.floor(pq.t * 8) % 2; // little running legs
      // a small hooded figure in a contrasting cloak, with a faint halo so
      // it doesn't get lost among fireflies/window lights
      o.fillStyle = `rgba(${acc.glow},${a * 0.14})`;
      pq.pixelDisc(o, rx + 2, y + 2, 4);
      o.fillStyle = `rgba(${acc.glow},${a})`;
      o.fillRect(rx, y, 4, 6); // body
      o.fillStyle = `rgba(${acc.dark},${a})`;
      o.fillRect(rx + 1, y - 2, 2, 3); // head/hood
      o.fillStyle = `rgba(${acc.glow},${a})`;
      o.fillRect(rx + (step ? 0 : 2), y + 6, 1, 1); // legs
      o.fillRect(rx + (step ? 2 : 0), y + 6, 1, 1);
      // a little wave at resolve
      if (st.phase === "resolving") {
        o.fillStyle = `rgba(${acc.eye},${a})`;
        o.fillRect(rx + 4, y - 1 + Math.round(Math.sin(pq.t * 12)), 1, 1);
      }
    },
  },
];

export const ENCOUNTER_IDS = ENCOUNTERS.map((e) => e.id);

// ------------------------------------------------------------- the manager
export class EncounterManager {
  constructor(pq) {
    this.pq = pq;
    this.defs = ENCOUNTERS;
    this.active = null; // { def, phase, t, phaseT, phaseP, p, data, dur }
    this.spawningEnabled = true;
    this.frequencyMul = 1; // debug: raise to make encounters fire sooner
    this._globalCooldownUntil = 12; // a short grace period after load
    this._cooldownUntil = {}; // per-encounter id -> clock
  }

  // phase layout (seconds), the rest is "active"
  #phaseFor(def) {
    return { enter: 1.2, resolve: 1.6, exit: 0.9 };
  }

  update(pq, mood, dt) {
    if (this.active) {
      this.#advance(pq, mood, dt);
      return;
    }
    // the orb relaxes back to no-encounter glow when nothing is active
    pq.adventure.orb.encounterActive = 0;
    if (!this.spawningEnabled) return;
    // encounters only begin during plain travel — never on top of another
    // beat, an arrival, a transition, a cameo costume, or a chapter set
    // piece (each of those already owns the hero and/or the screen)
    if (pq.adventure.arrival.phase === "arriving") return;
    if ((pq.biomeT ?? 1) < 1) return; // mid biome crossfade
    if (pq.adventureCtl) return; // campfire pause / arrival slowdown
    if (pq.adventure.noteBridge) return; // a bridge is forming
    if (pq.egg || pq.heroCtl) return; // a cameo costume or chapter set-piece
    // essentially silent (mic off / dead air): the hero is standing still,
    // so don't spawn a moving encounter around a frozen character
    if ((pq.gate || 0) < 0.08) return;
    if (pq.clock < this._globalCooldownUntil) return;
    // Story Engine: the director can suppress major beats (e.g. to give an
    // arrival breathing room). Additive — the existing guards still apply.
    const story = pq.adventure.story;
    if (story && (story.majorSuppressed() || !story.allowMajorBeat)) return;

    const biome = pq.currentBiome().name;
    const quiet = (pq.gate || 0) < 0.3;
    let best = null;
    let bestW = 0;
    for (const def of this.defs) {
      if (!def.compatibleBiomes.includes(biome)) continue;
      if ((this._cooldownUntil[def.id] || -999) > pq.clock) continue;
      // when quiet, only the cozy (calm/breakdown-preferred) encounters spawn
      if (quiet && !def.preferredMoods.some((m) => m === "calm" || m === "breakdown")) continue;
      const moodMatch = def.preferredMoods.includes(mood.state);
      // per-frame probability from a rarity interval, weighted by mood match
      const interval = def.rarity === "rare" ? 150 : 95;
      const w = (dt / interval) * (moodMatch ? 1.6 : 0.5) * (quiet ? 0.4 : 1) * this.frequencyMul;
      if (Math.random() < w && w > bestW) {
        best = def;
        bestW = w;
      }
    }
    if (best) this.#begin(best);
  }

  #begin(def) {
    this.active = { def, phase: "entering", t: 0, phaseT: 0, phaseP: 0, p: 0, data: {}, dur: def.duration };
    // Story Engine: let the director observe this beat (tags describe what
    // it's doing emotionally). Purely observational — never blocks the encounter.
    this.pq.adventure.story?.markBeatTriggered(def.id, def.storyTags || ["ambient"]);
    def.onEnter?.(this.pq, this.pq.adventure.mood, this.active, this.pq.palRef);
  }

  #advance(pq, mood, dt) {
    const st = this.active;
    const def = st.def;
    st.t += dt;
    st.phaseT += dt;
    st.p = clamp01(st.t / st.dur);
    st.intensity = 0.4 + mood.energy * 0.6; // quiet -> softer, peak -> fuller

    // the orb leans in and brightens for the whole visible encounter
    pq.adventure.orb.encounterActive = st.phase === "exiting" ? (1 - st.phaseP) * 0.6 : 0.6 + st.intensity * 0.4;

    const ph = this.#phaseFor(def);
    const activeDur = Math.max(1, st.dur - ph.enter - ph.resolve - ph.exit);
    if (st.phase === "entering") {
      st.phaseP = clamp01(st.phaseT / ph.enter);
      if (st.phaseT >= ph.enter) this.#setPhase("active", 0);
    } else if (st.phase === "active") {
      st.phaseP = clamp01(st.phaseT / activeDur);
      def.onActive?.(pq, mood, st, pq.palRef, dt);
      if (st.phaseT >= activeDur) {
        this.#setPhase("resolving", 0);
        def.onResolve?.(pq, mood, st, pq.palRef);
      }
    } else if (st.phase === "resolving") {
      st.phaseP = clamp01(st.phaseT / ph.resolve);
      if (st.phaseT >= ph.resolve) this.#setPhase("exiting", 0);
    } else if (st.phase === "exiting") {
      st.phaseP = clamp01(st.phaseT / ph.exit);
      if (st.phaseT >= ph.exit) this.#end();
    }
  }

  #setPhase(phase, phaseT) {
    this.active.phase = phase;
    this.active.phaseT = phaseT;
    this.active.phaseP = 0;
  }

  #end() {
    const def = this.active.def;
    def.onExit?.(this.pq, this.pq.adventure.mood, this.active, this.pq.palRef);
    const pq = this.pq;
    // per-encounter + global cooldowns so encounters stay memorable and the
    // adventure gets real breathing room between them (major ~2.5min before
    // the same one can recur, and ~50s minimum before ANY next encounter)
    this._cooldownUntil[def.id] = pq.clock + (def.major ? 150 : 95);
    this._globalCooldownUntil = pq.clock + 50;
    pq.adventure.orb.encounterActive = 0;
    this.active = null;
  }

  // called by the render pipeline for each layer ("bg" behind props/hero,
  // "fg" in front of hero/orb)
  draw(o, pal, layer) {
    const st = this.active;
    if (!st) return;
    const def = st.def;
    if (def.layer !== layer) return;
    const fn = layer === "bg" ? def.drawBg : def.drawFg;
    fn?.(o, this.pq, this.pq.adventure.mood, st, pal);
  }

  // events manager checks this to quiet its random cameos during a major
  // encounter (but not while it's just exiting — let the world resume)
  suppressCameos() {
    return !!(this.active && this.active.def.major && this.active.phase !== "exiting");
  }

  // ---------------------------------------------------------- debug/test
  forceEncounter(id) {
    const def = this.defs.find((d) => d.id === id);
    if (!def) return false;
    this.active = null; // drop any current one cleanly
    this.pq.adventure.orb.encounterActive = 0;
    this.#begin(def);
    return true;
  }
  endEncounter() {
    if (this.active) this.#setPhase("exiting", 0);
  }
  toggleSpawning() {
    this.spawningEnabled = !this.spawningEnabled;
    return this.spawningEnabled;
  }
  setFrequency(mul) {
    this.frequencyMul = Math.max(0, mul);
  }
  statusLine() {
    return this.active ? `${this.active.def.id}/${this.active.phase}` : null;
  }
}
