// Pixel Quest — a lost 16-bit fantasy cartridge that visualizes music.
// A tiny cloaked hero walks a looping moonlit landscape; bass thumps the
// ground and torches, treble twinkles stars and fireflies, beats make the
// hero jump or flash his sword. Rendered on a low-res offscreen canvas and
// scaled up with nearest-neighbor so the pixels stay big and crisp.
// Rare cameo moments come from the special-event system in
// pixelquest-events.js (see PIXEL_EVENTS there to add more).

import { PixelQuestEventManager } from "./pixelquest-events.js";
import { PixelQuestAdventureManager, ADVENTURE_TUNING } from "./pixelquest-adventure.js";
import { AssetStore, PropField, GlowQueue, PerfMeter, PARALLAX_MANIFEST } from "./pixelquest-assets.js";
import { PixelQuestOpening } from "./pixelquest-opening.js";

const TAU = Math.PI * 2;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

class Smoother {
  constructor(attack = 0.5, decay = 0.08) {
    this.value = 0;
    this.attack = attack;
    this.decay = decay;
  }
  update(target) {
    const k = target > this.value ? this.attack : this.decay;
    this.value += (target - this.value) * k;
    return this.value;
  }
}

class BeatDetector {
  constructor(floor = 0.12) {
    this.hist = [];
    this.cooldown = 0;
    this.floor = floor;
  }
  update(v, dt) {
    this.hist.push(v);
    if (this.hist.length > 43) this.hist.shift();
    this.cooldown -= dt;
    const avg = this.hist.reduce((a, b) => a + b, 0) / this.hist.length;
    if (this.cooldown <= 0 && v > this.floor && v > avg * 1.25) {
      this.cooldown = 0.16;
      return true;
    }
    return false;
  }
}

function makePRNG(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------ biome palettes
// Every color is [r, g, b] so palettes can be numerically crossfaded.
// Biome System v1 — five adventure zones. Each biome is a full palette for
// the EXISTING data-driven rendering pipeline (drawSky/drawMountains/
// drawLandmark/drawProps/drawParticles already read these exact fields —
// nothing about that pipeline changed, only the data feeding it). The extra
// `preferredMoods`/`minDuration`/`maxDuration` fields are new and read only
// by the biome-selection logic in render() below; they're inert metadata
// everywhere else (rgbPal's explicit key list ignores unknown fields).
const BIOMES = [
  {
    name: "meadow-road", // cozy, classic-adventure, calm but alive
    skyTop: [14, 22, 32], skyMid: [26, 42, 48], skyLow: [58, 80, 62],
    mtFar: [40, 56, 48], mtMid: [30, 60, 40], cap: [0, 0, 0],
    capA: 0,
    ground: [24, 46, 30], groundTop: [72, 112, 52], groundDark: [14, 28, 18],
    prop: [26, 50, 30], propDark: [16, 32, 20], trunk: [56, 44, 28],
    torch: [255, 202, 122],
    moon: [235, 226, 192], star: [230, 236, 200], firefly: [210, 255, 150],
    ambient: "leaf", ambientCol: [200, 230, 140],
    landmark: "shrine", mtAmp: 7, mtJag: 2,
    preferredMoods: ["calm", "steady"],
    minDuration: 60, maxDuration: 95,
  },
  {
    name: "neon-forest", // magical, synthy, mysterious but beautiful
    skyTop: [14, 8, 32], skyMid: [28, 14, 54], skyLow: [46, 20, 74],
    mtFar: [38, 20, 62], mtMid: [28, 16, 50], cap: [0, 0, 0],
    capA: 0,
    ground: [24, 16, 42], groundTop: [72, 42, 112], groundDark: [14, 9, 26],
    prop: [200, 60, 160], propDark: [40, 190, 180], trunk: [150, 130, 180],
    torch: [130, 245, 225],
    moon: [190, 130, 230], star: [225, 190, 255], firefly: [130, 255, 235],
    ambient: "spore", ambientCol: [150, 245, 225],
    landmark: "mushroom", mtAmp: 8, mtJag: 2,
    preferredMoods: ["energetic", "steady"],
    minDuration: 50, maxDuration: 80,
  },
  {
    name: "moonlit-town", // quiet village, nostalgic, late-night, charming
    skyTop: [10, 12, 28], skyMid: [20, 24, 46], skyLow: [34, 38, 60],
    mtFar: [36, 38, 56], mtMid: [26, 28, 42], cap: [0, 0, 0],
    capA: 0,
    ground: [28, 30, 40], groundTop: [64, 68, 86], groundDark: [18, 19, 26],
    prop: [26, 28, 38], propDark: [18, 19, 27], trunk: [42, 40, 44],
    torch: [255, 210, 140],
    moon: [225, 225, 240], star: [220, 225, 245], firefly: [200, 210, 255],
    ambient: "leaf", ambientCol: [120, 125, 150],
    landmark: "tower", mtAmp: 9, mtJag: 3,
    preferredMoods: ["calm", "breakdown"],
    minDuration: 55, maxDuration: 90,
  },
  {
    name: "arcade-ruins", // retro, playful, 80s/90s energy, not chaotic
    skyTop: [8, 6, 16], skyMid: [18, 10, 28], skyLow: [30, 14, 40],
    mtFar: [34, 22, 44], mtMid: [26, 16, 36], cap: [0, 0, 0],
    capA: 0,
    ground: [16, 14, 22], groundTop: [46, 40, 60], groundDark: [8, 7, 12],
    prop: [40, 200, 220], propDark: [220, 60, 180], trunk: [50, 48, 60],
    torch: [255, 90, 180],
    moon: [200, 210, 230], star: [180, 220, 255], firefly: [255, 220, 90],
    ambient: "dust", ambientCol: [80, 220, 230],
    landmark: "arcade", mtAmp: 5, mtJag: 5,
    preferredMoods: ["energetic", "peak"],
    minDuration: 45, maxDuration: 70,
  },
  {
    name: "castle-approach", // heroic, destination, epic but soft
    skyTop: [14, 9, 26], skyMid: [28, 18, 46], skyLow: [52, 32, 62],
    mtFar: [36, 26, 50], mtMid: [30, 22, 42], cap: [0, 0, 0],
    capA: 0,
    ground: [32, 28, 38], groundTop: [74, 66, 80], groundDark: [20, 17, 26],
    prop: [32, 26, 36], propDark: [20, 16, 24], trunk: [48, 38, 32],
    torch: [255, 180, 90],
    moon: [235, 222, 200], star: [235, 225, 205], firefly: [255, 205, 120],
    ambient: "leaf", ambientCol: [90, 70, 70],
    landmark: "castle", mtAmp: 10, mtJag: 3,
    preferredMoods: ["energetic", "peak"],
    minDuration: 50, maxDuration: 85,
  },
];

// ------------------------------------------------------------ hero sprite
// 16x24, string bitmaps, 32-bit-era shading. h/H hood + lit edge, f/d face
// + shade, c/C/D cloak + lit + shadow edge, G gold belt, b/B boots + lit,
// s/S staff + lit tip, l lantern frame, L lantern glass
// biome → imported foliage/tree asset (each a 3-variant sheet). When ready,
// drawProps uses these instead of the procedural drawTree per placed tree.
const BIOME_FOLIAGE = {
  "meadow-road": "meadowFoliage",
  "neon-forest": "neonFoliage",
  "moonlit-town": "moonlitFoliage",
  "arcade-ruins": "arcadeFoliage",
  "castle-approach": "castleFoliage",
};

// biome → imported gateway landmark asset (drawn where the procedural landmark
// used to be). arcade-ruins has no entry (its gate art was damaged by the key),
// so it keeps the procedural landmark.
const BIOME_GATE = {
  "meadow-road": "meadowGate",
  "neon-forest": "neonGate",
  "moonlit-town": "moonlitGate",
  "castle-approach": "castleGate",
};

// STORYBOOK PROPORTIONS: a bigger hood/head (7 of 17 torso rows) with a
// VISIBLE FACE and two dark eyes — a tiny warm human traveler, lovable and
// readable from across the room. Same 16-wide dims as always, so every
// costume overlay and event that anchors to his geometry still fits.
const HERO_TORSO = [
  "......hhhh......",
  ".....hHHHHh.....",
  "....hHHHHHHh....",
  "....hhHHHHhh....",
  "....hffffdh.....",
  "....hfefedh.....",
  ".....ffffdd.....",
  "...cCCccccD..S..",
  "PccCCcccccD..s..",
  "pccCCccccccD.s..",
  "pccCCccccccDls..",
  "pccCCccccccLls..",
  ".cGGGGGGGGGD.s..",
  ".ccCCccccccD.s..",
  ".ccCCcccccD..s..",
  "..cCCccccD...S..",
  "...cCcccc.......",
];
// long legs: strides read clearly — especially when they play in reverse
const HERO_LEGS = [
  [
    "...cc.....cc....",
    "...cc.....cc....",
    "...cc.....cc....",
    "...bb.....bb....",
    "...bb.....bb....",
    "...BB.....BB....",
    "................",
  ],
  [
    ".....cccc.......",
    ".....cccc.......",
    ".....cccc.......",
    ".....bbbb.......",
    ".....bbbb.......",
    ".....BBBB.......",
    "................",
  ],
  [
    "..cc.......cc...",
    "..cc.......cc...",
    ".cc.........cc..",
    ".bb.........bb..",
    ".bb.........bb..",
    ".BB.........BB..",
    "................",
  ],
  [
    ".....cccc.......",
    ".....cccc.......",
    ".....cccc.......",
    ".....bbbb.......",
    ".....bbbb.......",
    ".....BBBB.......",
    "................",
  ],
];
const HERO_LEGS_JUMP = [
  "...cc.....cc....",
  "...cc.....cc....",
  "...c.......c....",
  "...b.......b....",
  "...b.......b....",
  "................",
  "................",
];

export class PixelQuest {
  constructor(cfg = {}) {
    // 160 tall = exact 3x integer scale on the 1920x480 wall — 32-bit-era
    // fidelity while every art pixel still maps to a whole screen block
    // detail: "pi_safe" (fewer stars/flora, no near-hills/haze), "standard",
    // or "showcase" (denser stars/flora) — tune per device.
    // renderMode: "procedural_fallback" | "asset_standard" | "asset_showcase"
    // (see pixelquest-assets.js — per-asset fallback keeps everything safe)
    this.cfg = {
      sensitivity: 1.25,
      // Internal render resolution. null = derive from the `detail` preset
      // (pi_safe/standard/showcase → 176/224/320). Set a number here to force a
      // specific height. Assets auto-scale to it (see AssetStore.artScale), so
      // this is the one perf knob: lower it if the Pi can't hold 60fps.
      pixelHeight: null,
      debugLabel: true,
      detail: "standard",
      renderMode: "asset_standard",
      perfDebug: false,
      assetDebug: false,
      debugScreen: false, // full-screen debug app (toggled by the D key in Pixel Quest)
      // Cinematic opening sequence (see pixelquest-opening.js)
      openingSequenceEnabled: true,
      openingSequencePlayMode: "startup", // always | firstRunOnly | startup | disabled
      openingSequenceSkippable: false, // the intro cannot be bypassed by key/click/tap
      ...cfg,
    };
    // Asset-Driven Rendering System v1
    this.assets = new AssetStore();
    this.assets.init();
    this.propField = new PropField(this, this.assets);
    this.glowQueue = new GlowQueue(this.cfg.detail === "showcase" ? 32 : 24);
    this.perf = new PerfMeter();
    this.freq = new Uint8Array(1024);
    this.time = new Uint8Array(2048);
    this.bass = new Smoother(0.5, 0.07);
    this.mids = new Smoother(0.5, 0.09);
    this.treble = new Smoother(0.55, 0.1);
    this.loud = new Smoother(0.4, 0.05);
    this.peak = 0.3;
    this.beat = new BeatDetector();

    this.off = document.createElement("canvas");
    this.octx = this.off.getContext("2d");
    this.pw = 0;
    this.ph = 0;

    this.scrollX = 0;
    this.t = 0;
    this.lastNow = 0;
    // cinematic wide composition: the hero stands ~27% from the left so the
    // road ahead has room for destinations, doors, encounters, and reveals.
    // Every system positions itself relative to this (never a bare literal).
    this.heroAnchor = 0.27;

    // tempo tracking: the hero runs to the music's actual pace
    this.clock = 0;
    this.lastBeatT = -1;
    this.intervals = [];
    this.bps = 0;
    this.tempoConf = 0;
    // the FEEL of the song: onset density + spectral busyness + loudness
    this.onsetTimes = [];
    this.drive = 0;
    this.prevFreq = new Uint8Array(1024);
    // dedicated drum detection: kick = bass-band flux, snare = mid/high flux
    // (flux sees onsets straight through the analyser's smoothing lag)
    this.kickBeat = new BeatDetector(0.09);
    this.snareBeat = new BeatDetector(0.09);
    this.kickPulse = 0; // the world flares on this
    this.snarePulse = 0; // sparkle/slash events ride this
    this.jumpCooldown = 0;
    this.snareCooldown = 0;
    // pace: a slew-limited cruise speed + slow section-energy factor
    this.cruise = 0;
    this.energy = 0;
    // easter eggs: once in a while, mid-groove, he shows off
    this.egg = null; // current hero showpiece (moonwalk/spin/boombox),
    // scheduled by the special-event manager below
    this.heroCtl = null; // chapter set pieces steer the hero through this
    this.biomeCount = BIOMES.length;
    this.events = new PixelQuestEventManager(this);
    // Adventure Layer v1: silent mood/orb/destination + a couple of short,
    // mood-gated story beats. Fully additive — see pixelquest-adventure.js.
    this.adventure = new PixelQuestAdventureManager(this);
    this.opening = new PixelQuestOpening(this); // cinematic intro (runs before gameplay)
    this.reaction = null; // brief non-verbal cue: lookup/lean/celebrate
    this.adventureCtl = null; // adventure beats can gently slow the world
    this.heroOffX = 0;
    // smooth rolling ground swells (grouped low bins, not per-column bars)
    this.groundPts = new Float32Array(16);
    this._rawG = new Float32Array(16); // reused scratch, hoisted out of analyze()

    // biome cycle — Biome System v1 (see BIOMES above)
    this.biomeIdx = 0;
    this.biomeNext = 1;
    this.biomePrev = null;
    this.biomeT = 1; // 1 = settled in current biome
    this.biomeTimer = 0;
    this.biomeDur = BIOMES[0].minDuration + Math.random() * (BIOMES[0].maxDuration - BIOMES[0].minDuration);
    this._fastBiomeCycling = false; // debug: shrinks biomeDur drastically

    // hero
    this.heroFrame = 0;
    this.heroAnimT = 0;
    this.heroJumpV = 0;
    this.heroJumpY = 0;
    this.swordFlash = 0;
    this.lanternFlash = 0;

    // beats / accents
    this.torchFlare = 0;
    this.bump = 0;
    this.bumpCooldown = 0;

    this.particles = [];
    this.bat = null;

    // looping world layout (positions in a fixed-length world loop)
    const rnd = makePRNG(20260707);
    this.worldLen = 1280;
    this.trees = [];
    this.torches = [];
    this.rocks = [];
    for (let x = 20; x < this.worldLen - 20; x += 34 + rnd() * 30) this.trees.push({ x, s: 0.8 + rnd() * 0.5, variant: (rnd() * 3) | 0 });
    for (let x = 70; x < this.worldLen - 40; x += 150 + rnd() * 90) this.torches.push({ x, ph: rnd() * TAU });
    for (let x = 10; x < this.worldLen; x += 55 + rnd() * 70) this.rocks.push({ x, w: 2 + ((rnd() * 3) | 0), variant: (rnd() * 3) | 0 });
    // foreground silhouettes: dark grass tufts sweeping past FASTER than the
    // path (1.25x parallax) at the bottom edge — the classic depth trick that
    // makes the whole scene read as a deep, layered, cinematic world
    this.fgPlants = [];
    for (let x = 8; x < this.worldLen; x += 70 + rnd() * 90)
      this.fgPlants.push({ x, blades: 3 + ((rnd() * 3) | 0), s: 0.7 + rnd() * 0.7, ph: rnd() * TAU });
    // path-edge flora at TRUE ground parallax (1.0): grass tufts swaying in
    // the wind and small flowers whose tips glow — the flowers are living
    // fragment SOURCES (music blooms out of them; see #worldSource)
    this.flora = [];
    {
      const step = this.cfg.detail === "pi_safe" ? 34 : this.cfg.detail === "showcase" ? 14 : 20;
      for (let x = 6; x < this.worldLen; x += step + rnd() * 18) {
        this.flora.push({
          x,
          type: rnd() < 0.3 ? "flower" : "grass",
          ph: rnd() * TAU,
          s: 0.7 + rnd() * 0.6,
          _srcGlow: 0, // set when a fragment blooms from this flower
        });
      }
    }
    this.landmarkX = 400;
    // roadside attractions: cottages, windmills, campfires — and a snail
    // in a tiny fedora, because the road is long
    this.attractions = [];
    {
      const types = ["cottage", "windmill", "campfire", "snail", "cottage", "windmill"];
      let ax = 150 + rnd() * 200;
      let ti = (rnd() * types.length) | 0;
      while (ax < this.worldLen - 80) {
        this.attractions.push({ x: ax, type: types[ti % types.length] });
        ti++;
        ax += 300 + rnd() * 340;
      }
    }
    this.dog = null;
    this.dogTimer = 18 + Math.random() * 30;

    // sky
    this.stars = [];
    const nStars = this.cfg.detail === "pi_safe" ? 56 : this.cfg.detail === "showcase" ? 130 : 100;
    for (let i = 0; i < nStars; i++)
      this.stars.push({ x: rnd() * 512, y: 2 + rnd() * 56, ph: rnd() * TAU, sp: 1.5 + rnd() * 4, bright: rnd() < 0.14 });
    this.clouds = [];
    for (let i = 0; i < 4; i++) this.clouds.push({ x: rnd() * 512, y: 6 + rnd() * 24, w: 14 + (rnd() * 20) | 0 });
    this.shoot = null; // rare shooting star
  }

  // ---------------------------------------------------------------- audio
  analyze(analyser, dt) {
    if (analyser) {
      analyser.getByteFrequencyData(this.freq);
      analyser.getByteTimeDomainData(this.time);
    } else {
      this.freq.fill(0);
      this.time.fill(128);
    }
    const band = (lo, hi) => {
      let s = 0;
      for (let i = lo; i < hi; i++) s += this.freq[i];
      return s / ((hi - lo) * 255);
    };
    const rawLoud = band(1, 372);
    this.peak = Math.max(this.peak * (1 - dt * 0.04), rawLoud, 0.06);
    const gain = Math.min(4, 0.55 / this.peak) * this.cfg.sensitivity;
    this.gain = gain;
    const rawBass = Math.min(1, band(1, 11) * gain);
    this.bass.update(rawBass);
    this.mids.update(Math.min(1, band(11, 92) * gain));
    this.treble.update(Math.min(1, band(92, 372) * 1.6 * gain));
    this.loud.update(Math.min(1, rawLoud * gain));

    // drum detection on per-band spectral flux: the kick lives in the bass
    // bins, the snare in the mids/highs. Flux (frame-to-frame change) fires
    // crisply even though the analyser smooths absolute levels.
    let bfl = 0;
    for (let i = 1; i < 12; i++) bfl += Math.abs(this.freq[i] - this.prevFreq[i]);
    let mfl = 0;
    for (let i = 24; i < 372; i += 2) mfl += Math.abs(this.freq[i] - this.prevFreq[i]);
    const bassFluxN = Math.min(1.5, (bfl / (11 * 255)) * gain * 9);
    const midFluxN = Math.min(1.5, (mfl / (174 * 255)) * gain * 9);
    const kickHit = analyser && this.kickBeat.update(bassFluxN, dt);
    const snareHit = analyser && this.snareBeat.update(midFluxN, dt);
    // when both fire at once, the dominant band wins
    if (kickHit && (!snareHit || bassFluxN >= midFluxN * 0.9)) this.onKick();
    if (snareHit && (!kickHit || midFluxN > bassFluxN * 0.9)) this.onSnare();

    // rolling ground swells: grouped low bins, blurred, glided over time
    const gp = this.groundPts;
    const rawG = this._rawG; // reused scratch buffer (no per-frame alloc)
    for (let i = 0; i < gp.length; i++) rawG[i] = Math.min(1, (this.freq[2 + i * 5] / 255) * gain);
    for (let i = 0; i < gp.length; i++) {
      const v =
        (rawG[Math.max(0, i - 1)] + rawG[i] * 2 + rawG[Math.min(gp.length - 1, i + 1)]) / 4;
      gp[i] = v > gp[i] ? gp[i] + (v - gp[i]) * Math.min(1, dt * 12) : Math.max(0, gp[i] - dt * 1.3);
    }

    // beat onsets from RAW waveform energy — FFT smoothing flattens kick
    // dips, so band-based detection misses steady beats (same fix as
    // Synthwave). Tempo comes from the median inter-beat interval.
    this.clock += dt;
    let sq = 0;
    for (let i = 0; i < this.time.length; i += 4) {
      const d = (this.time[i] - 128) / 128;
      sq += d * d;
    }
    const rms = Math.sqrt(sq / (this.time.length / 4));
    if (analyser && this.beat.update(Math.min(1.5, rms * 2.6), dt)) {
      this.onsetTimes.push(this.clock);
      if (this.lastBeatT >= 0) {
        const iv = this.clock - this.lastBeatT;
        if (iv > 0.24 && iv < 2) {
          // fold each interval into one octave band BEFORE the median:
          // kick/snare alternation otherwise seesaws the estimate wildly
          let fiv = iv;
          while (fiv < 0.34) fiv *= 2;
          while (fiv > 1.0) fiv /= 2;
          this.intervals.push(fiv);
          if (this.intervals.length > 10) this.intervals.shift();
          const sorted = [...this.intervals].sort((a, b) => a - b);
          const med = sorted[sorted.length >> 1];
          // stability: only trust (and display) the tempo when the recent
          // intervals actually agree with each other
          const mad = sorted.reduce((s, v) => s + Math.abs(v - med), 0) / sorted.length;
          this.tempoStable = this.intervals.length >= 6 && mad / med < 0.12;
          this.bps += (1 / med - this.bps) * 0.2;
          this.tempoConf = 1;
        }
      }
      this.lastBeatT = this.clock; // RMS onsets drive TEMPO tracking only
    }
    if (this.lastBeatT >= 0 && this.clock - this.lastBeatT > 2.5) this.tempoConf *= Math.exp(-dt * 1.2);

    // "drive": how fast the song FEELS. Onset density (hits per second over
    // the last 3s) + spectral flux (frame-to-frame busyness) + loudness,
    // with a nudge from the locked tempo. Fast attack, ~2s release.
    while (this.onsetTimes.length && this.onsetTimes[0] < this.clock - 3) this.onsetTimes.shift();
    const rateN = clamp01(this.onsetTimes.length / 3 / 4); // ~4 hits/s = max
    let fl = 0;
    for (let i = 2; i < 372; i += 2) fl += Math.abs(this.freq[i] - this.prevFreq[i]);
    this.prevFreq.set(this.freq);
    const flux = clamp01((fl / (185 * 255)) * gain * 6);
    const tempoNudge = clamp01((this.bps - 0.9) / 2.3) * this.tempoConf;
    // ADAPTIVE silence gate: relative to this mic's own recent loudness, so
    // quiet passages of a playing song never read as silence. Opens fast,
    // closes slowly (~2s of true quiet before he stops).
    this.rmsPeak = Math.max((this.rmsPeak || 0.01) * (1 - dt * 0.03), rms, 0.008);
    // 5% of recent peak: quiet bars and breakdowns stay comfortably above
    // it, mic noise stays under. Closes over ~4s so a lull never stalls him.
    const gateT = rms > Math.max(0.006, this.rmsPeak * 0.05) ? 1 : 0;
    this.gate = (this.gate || 0) + (gateT - (this.gate || 0)) * Math.min(1, dt * (gateT ? 6 : 0.45));
    let driveT = clamp01(rateN * 0.4 + flux * 0.3 + this.loud.value * 0.15 + tempoNudge * 0.15) * this.gate;
    // while music is playing he never stops dead — at worst a steady walk
    driveT = Math.max(driveT, this.gate * 0.16);
    this.drive += (driveT - this.drive) * Math.min(1, dt * (driveT > this.drive ? 5 : 0.7));
    // stretched response: the raw blend compresses real music into a narrow
    // band, so expand it — quiet slow songs stay a slow walk, dense fast
    // songs peg the meter and sprint
    this.driveFx = clamp01((this.drive - 0.05) / 0.55);

    this.jumpCooldown -= dt;
    this.snareCooldown -= dt;
    this.bumpCooldown -= dt;
    this.swordFlash *= Math.exp(-dt * 8);
    this.lanternFlash *= Math.exp(-dt * 6);
    this.torchFlare *= Math.exp(-dt * 5);
    this.kickPulse *= Math.exp(-dt * 7); // ~250ms world flare
    this.snarePulse *= Math.exp(-dt * 6);
    this.bump *= Math.exp(-dt * 10);
  }

  // kick drum: he JUMPS, the world's flames answer. Every grounded kick —
  // no randomness, just a tiny anti-jitter cooldown.
  onKick() {
    this.kickPulse = 1;
    this.kickHit = true; // one-frame flag, consumed by the event manager
    this.torchFlare = 1;
    if (this.bumpCooldown <= 0) {
      this.bump = 1;
      this.bumpCooldown = 0.5;
    }
    if (this.heroJumpY === 0 && this.jumpCooldown <= 0 && (this.gate || 0) > 0.3 && !this.heroCtl) {
      // airtime ~0.3-0.43s: he lands in time for the next kick at 128 BPM.
      // Star power adds real hang time — the legendary's ability boost.
      const starBoost = this.egg && this.egg.type === "starpower" ? 12 : 0;
      this.heroJumpV = -(38 + (this.driveFx || 0) * 16 + starBoost);
      this.jumpCooldown = 0.3;
    } else if ((this.gate || 0) > 0.3) {
      this.lanternFlash = 1; // mid-air kick: the lantern answers instead
    }
  }

  // snare: sword slash + sparkles, fireflies startle, sometimes the bat bolts
  onSnare() {
    this.snarePulse = 1;
    this.snareHit = true; // one-frame flag, consumed by the event manager
    if (this.snareCooldown <= 0 && (this.gate || 0) > 0.3) {
      this.snareCooldown = 0.25;
      this.swordFlash = 1;
      this.spawnSparkles();
      if (!this.bat && Math.random() < 0.22) {
        this.bat = { x: this.pw * 0.6, y: this.ph * 0.55, vx: 14 + Math.random() * 10, vy: -9, flap: 0 };
      }
    }
  }

  spawnSparkles() {
    if (this.particles.length > 90) return;
    const n = 4 + ((Math.random() * 4) | 0);
    const nearHero = Math.random() < 0.5;
    const bx = nearHero ? this.pw * this.heroAnchor : Math.random() * this.pw;
    const by = nearHero ? this.ph - 26 : 6 + Math.random() * this.ph * 0.4;
    for (let i = 0; i < n; i++) {
      this.particles.push({
        kind: "sparkle",
        x: bx + (Math.random() - 0.5) * 12,
        y: by + (Math.random() - 0.5) * 8,
        vx: 0, vy: -3,
        age: 0, life: 0.35 + Math.random() * 0.25,
      });
    }
  }

  // Adventure Layer: a brief non-verbal character reaction. "celebrate" is
  // the reward/arrival cue and may always interrupt. Everything else has to
  // wait out a short rest period after the LAST reaction (not just until it
  // finishes) — without this, back-to-back cameos could each fire their own
  // reaction a moment apart and read as fidgety instead of deliberate.
  triggerReaction(type, dur = 0.6) {
    if (!type) return;
    if (type !== "celebrate" && this.t < (this._reactionRestUntil || 0)) return;
    this.reaction = { type, t: 0, dur };
    this._reactionRestUntil = this.t + dur + ADVENTURE_TUNING.reactionRestSeconds;
  }

  // ------------------------------------------------------------ palette
  palette() {
    const a = BIOMES[this.biomeIdx];
    if (this.biomeT >= 1) return this.rgbPal(a, a, 1);
    return this.rgbPal(a, BIOMES[this.biomeNext], this.biomeT);
  }
  rgbPal(a, b, t) {
    const mix = (k) => {
      const c = [lerp(a[k][0], b[k][0], t) | 0, lerp(a[k][1], b[k][1], t) | 0, lerp(a[k][2], b[k][2], t) | 0];
      return c;
    };
    const pal = {};
    for (const k of ["skyTop", "skyMid", "skyLow", "mtFar", "mtMid", "cap", "ground", "groundTop", "groundDark", "prop", "propDark", "trunk", "torch", "moon", "star", "firefly", "ambientCol"])
      pal[k] = mix(k);
    pal.capA = lerp(a.capA, b.capA, t);
    // discrete traits switch at the midpoint of a transition
    const src = t < 0.5 ? a : b;
    pal.ambient = src.ambient;
    pal.landmark = src.landmark;
    pal.mtAmp = lerp(a.mtAmp, b.mtAmp, t);
    pal.mtJag = lerp(a.mtJag, b.mtJag, t);
    pal.biome = src.name;
    return pal;
  }

  // ------------------------------------------------------- biome manager
  // Lives directly on PixelQuest (like palette()/rgbPal() above) rather
  // than as a separate class — the existing biomeIdx/biomeNext/biomeT
  // crossfade already IS the biome manager in spirit; these just formalize
  // the parts Biome System v1 adds: mood-aware selection, previous-biome
  // tracking, and debug/force hooks.
  findBiomeIndex(id) {
    const i = BIOMES.findIndex((b) => b.name === id);
    return i >= 0 ? i : 0;
  }
  currentBiome() {
    return BIOMES[this.biomeIdx];
  }
  biomeNameAt(idx) {
    return BIOMES[idx]?.name;
  }
  allBiomeIds() {
    return BIOMES.map((b) => b.name);
  }
  // weighted pick, favoring biomes whose preferredMoods include the current
  // mood, excluding an immediate repeat of the current biome and down-
  // weighting the one just before it (so the world doesn't ping-pong A→B→A)
  pickNextBiomeIndex() {
    const mood = this.adventure?.mood?.state || "steady";
    const weights = BIOMES.map((b, i) => {
      if (i === this.biomeIdx) return 0; // never repeat the current biome
      let w = b.preferredMoods?.includes(mood) ? 3.2 : 1;
      if (i === this.biomePrev) w *= 0.35; // discourage bouncing straight back
      return w;
    });
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) return (this.biomeIdx + 1) % BIOMES.length;
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return (this.biomeIdx + 1) % BIOMES.length;
  }
  // debug/test: jump straight to a biome by id, skipping the crossfade
  forceBiome(id) {
    const i = this.findBiomeIndex(id);
    this.biomePrev = this.biomeIdx;
    this.biomeIdx = i;
    this.biomeNext = i;
    this.biomeT = 1;
    this.biomeTimer = 0;
    const b = BIOMES[i];
    this.biomeDur = b.minDuration + Math.random() * (b.maxDuration - b.minDuration);
  }
  // debug/test: crossfade to the next/previous biome in list order right now
  nextBiome() {
    this.biomeNext = (this.biomeIdx + 1) % BIOMES.length;
    this.biomeT = 0;
  }
  previousBiome() {
    this.biomeNext = (this.biomeIdx - 1 + BIOMES.length) % BIOMES.length;
    this.biomeT = 0;
  }
  toggleFastBiomeCycling() {
    this._fastBiomeCycling = !this._fastBiomeCycling;
    return this._fastBiomeCycling;
  }
  // Journey/Arrival (Step 3): an arrival's payoff hands off here instead of
  // duplicating any biome-swap logic — just fast-forwards the existing
  // real-time counter so render()'s own "biomeTimer > biomeDur" check fires
  // on the very next frame, picking biomeNext via the same mood-weighted
  // pickNextBiomeIndex() and starting the same ~4.5s crossfade as always.
  triggerBiomeTransitionNow() {
    this.biomeTimer = this.biomeDur + 1;
  }

  col(c, alpha = 1) {
    return alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  }
  lit(c, amt, alpha = 1) {
    return this.col([Math.min(255, c[0] + amt), Math.min(255, c[1] + amt), Math.min(255, c[2] + amt)], alpha);
  }
  mix(a, b, t) {
    return [lerp(a[0], b[0], t) | 0, lerp(a[1], b[1], t) | 0, lerp(a[2], b[2], t) | 0];
  }

  // ------------------------------------------------------------ terrain
  groundBase() {
    return this.ph - Math.round(15 * this.S);
  }
  groundY(screenX) {
    const wx = screenX + this.scrollX;
    const hills = Math.round((2 * Math.sin(wx * 0.015) + 1.5 * Math.sin(wx * 0.041 + 2.1)) * this.S);
    // smooth audio swells ride on the terrain: 16 control points across the
    // screen, smoothstep-interpolated — rolling ground, not waveform bars
    const gp = this.groundPts;
    const u = (screenX / this.pw) * (gp.length - 1);
    const i0 = Math.max(0, Math.min(gp.length - 2, Math.floor(u)));
    const f = u - i0;
    const sm = f * f * (3 - 2 * f);
    // the magic microphone event boosts the terrain's music response
    const swell =
      (gp[i0] + (gp[i0 + 1] - gp[i0]) * sm) *
      (2 + this.bass.value * 3) *
      (1 + (this.groundBoost || 0) * 0.8) *
      this.S;
    return this.groundBase() - hills - Math.round(swell);
  }

  // ------------------------------------------------------------ drawing
  drawSky(o, pal) {
    const { pw, ph } = this;
    // ASSET PATH: an imported sky plate (meadow_sky.png) covers the whole
    // sky when present; if absent, the procedural stepped-band sky below is
    // the fallback (external-only, so this stays invisible until art lands)
    // During a biome transition, dissolve the NEXT biome's backdrop in over the
    // current one across the whole 4.5s crossfade (biomeT 0→1) so the scene
    // fades smoothly instead of snapping at the midpoint.
    const curBiome = BIOMES[this.biomeIdx].name;
    if (this.useAssets() && this.assets.hasReadyLayer(curBiome, "sky")) {
      o.fillStyle = "rgb(6,6,14)";
      o.fillRect(0, 0, pw, ph);
      this.assets.drawParallaxLayer(o, curBiome, "sky", this.scrollX, pw, this.groundBase());
      const nextBiome = BIOMES[this.biomeNext].name;
      if (this.biomeT < 1 && nextBiome !== curBiome && this.assets.hasReadyLayer(nextBiome, "sky")) {
        o.save();
        o.globalAlpha = this.biomeT;
        this.assets.drawParallaxLayer(o, nextBiome, "sky", this.scrollX, pw, this.groundBase());
        o.restore();
      }
      return;
    }
    // seven stepped bands with dithered seams: a rich night gradient that
    // still reads as hand-placed pixels
    const bands = 7;
    let prevY = 0;
    for (let b = 0; b < bands; b++) {
      const t = b / (bands - 1);
      const c =
        t < 0.55 ? this.mix(pal.skyTop, pal.skyMid, t / 0.55) : this.mix(pal.skyMid, pal.skyLow, (t - 0.55) / 0.45);
      const y1 = b === bands - 1 ? ph : Math.round(ph * Math.pow((b + 1) / bands, 1.12));
      o.fillStyle = this.col(c);
      o.fillRect(0, prevY, pw, y1 - prevY);
      if (b > 0) {
        // checkered seam
        for (let x = (prevY & 1); x < pw; x += 2) o.fillRect(x, prevY - 1, 1, 1);
      }
      prevY = y1;
    }

    // stars twinkle with treble; the bright ones carry a faint cross
    const tw = this.treble.value;
    for (const s of this.stars) {
      const sx = Math.round(((((s.x - this.scrollX * 0.05) % 512) + 512) % 512) * (pw / 512));
      const pulse = Math.sin(s.ph + this.t * s.sp);
      const a = 0.25 + 0.75 * clamp01(0.4 + 0.6 * pulse + tw * 0.6);
      o.fillStyle = this.col(pal.star, a * 0.9);
      o.fillRect(sx, s.y, 1, 1);
      if (s.bright) {
        o.fillStyle = this.col(pal.star, a * 0.35);
        o.fillRect(sx - 1, s.y, 3, 1);
        o.fillRect(sx, s.y - 1, 1, 3);
      }
      if (tw > 0.55 && pulse > 0.93) {
        o.fillStyle = this.col(pal.star, 0.5);
        o.fillRect(sx - 1, s.y, 3, 1);
        o.fillRect(sx, s.y - 1, 1, 3);
      }
    }

    // a rare shooting star streaks the sky (a little more often when the
    // highs are singing)
    if (!this.shoot && Math.random() < (0.008 + tw * 0.02) * 0.016) {
      this.shoot = { x: 10 + Math.random() * pw * 0.6, y: 4 + Math.random() * 18, life: 0.8 };
    }
    if (this.shoot) {
      const sh = this.shoot;
      sh.x += 90 * 0.016;
      sh.y += 26 * 0.016;
      sh.life -= 0.016;
      for (let k = 0; k < 5; k++) {
        o.fillStyle = this.col(pal.star, Math.max(0, sh.life) * (1 - k / 5));
        o.fillRect(Math.round(sh.x - k * 2), Math.round(sh.y - k * 0.6), 1, 1);
      }
      if (sh.life <= 0 || sh.x > pw + 8) this.shoot = null;
    }

    // clouds: two-tone with a moonlit top edge
    for (const c of this.clouds) {
      const cx = Math.round(((((c.x - this.scrollX * 0.08 - this.t * 1.2) % 512) + 512) % 512) * (pw / 512));
      o.fillStyle = this.col(pal.skyLow, 0.75);
      o.fillRect(cx, c.y, c.w, 2);
      o.fillRect(cx + 3, c.y + 2, c.w - 8, 1);
      o.fillStyle = this.lit(pal.skyLow, 26, 0.55);
      o.fillRect(cx + 2, c.y - 1, c.w - 5, 1);
    }

    // moon (or sun): glow swells gently with bass
    const mx = Math.round(pw * 0.78);
    const my = pal.biome === "sunset_plains" ? Math.round(this.ph * 0.42) : Math.round(16 * this.S);
    const r = Math.round((pal.biome === "sunset_plains" ? 7 : 5) * this.S);
    const glowR = r + 3 + Math.round(this.bass.value * 1.2 + this.kickPulse * 2);
    for (let g = glowR; g > r; g--) {
      o.fillStyle = this.col(pal.moon, g === r + 1 ? 0.16 : 0.05);
      this.pixelDisc(o, mx, my, g);
    }
    // lit crescent: a bright rim on the upper-left, then the main face
    o.fillStyle = this.lit(pal.moon, 34);
    this.pixelDisc(o, mx, my, r);
    o.fillStyle = this.col(pal.moon);
    this.pixelDisc(o, mx + 1, my + 1, r - 1);
    // maria and craters
    o.fillStyle = this.col(pal.skyMid, 0.4);
    o.fillRect(mx - 2, my - 1, 3, 2);
    o.fillRect(mx + 2, my + 2, 2, 2);
    o.fillRect(mx, my - r + 3, 2, 1);
    o.fillStyle = this.col(pal.skyTop, 0.3);
    o.fillRect(mx - 3, my + 2, 1, 1);
  }

  pixelDisc(o, cx, cy, r) {
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.floor(Math.sqrt(r * r - dy * dy));
      o.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
    }
  }

  mtHeight(wx, amp, jag, seedPh) {
    return (
      amp * (0.55 + 0.45 * Math.sin(wx * 0.021 + seedPh)) +
      amp * 0.4 * Math.sin(wx * 0.043 + seedPh * 2.7) +
      jag * Math.abs(Math.sin(wx * 0.09 + seedPh))
    );
  }

  drawMountains(o, pal) {
    const { pw } = this;
    const base = this.groundBase();
    // BACKDROP PATH: a full-scene wallpaper already contains sky+mountains, so
    // skip every procedural range (drawSky drew the scene behind everything).
    if (this.useAssets() && this.assets.hasBackdrop(pal.biome)) return;
    // ASSET PATH: parallax plates REPLACE the procedural ridges per-layer
    // when ready (external PNG > baked placeholder). far/mid have baked
    // fallbacks (the Meadow slice); the procedural ridge for a layer is
    // skipped only when that layer's plate is actually drawn.
    const farPlate = this.useAssets() && this.assets.hasReadyLayer(pal.biome, "far");
    const midPlate = this.useAssets() && this.assets.hasReadyLayer(pal.biome, "mid");
    if (farPlate) this.assets.drawParallaxLayer(o, pal.biome, "far", this.scrollX, pw, base);
    if (midPlate) this.assets.drawParallaxLayer(o, pal.biome, "mid", this.scrollX, pw, base);
    if (!farPlate) {
      // distant haze range: barely darker than the sky, pure atmosphere
      const hazeCol = this.mix(pal.mtFar, pal.skyMid, 0.55);
      o.fillStyle = this.col(hazeCol);
      for (let x = 0; x < pw; x++) {
        const h = Math.round((this.mtHeight(x + this.scrollX * 0.07 + 900, pal.mtAmp * 1.2, pal.mtJag * 0.5, 7.7) + 22) * this.S);
        o.fillRect(x, base - h, 1, h);
      }
      // far range with a moonlit ridge line
      const farRim = this.lit(pal.mtFar, 22, 0.85);
      for (let x = 0; x < pw; x++) {
        const h = Math.round((this.mtHeight(x + this.scrollX * 0.15, pal.mtAmp, pal.mtJag, 1.3) + 14) * this.S);
        o.fillStyle = this.col(pal.mtFar);
        o.fillRect(x, base - h, 1, h);
        o.fillStyle = pal.capA > 0.05 ? this.col(pal.cap, pal.capA * 0.9) : farRim;
        o.fillRect(x, base - h, 1, pal.capA > 0.05 ? 2 : 1);
      }
    }
    // mid range, rim-lit, with sleeping village lights in its folds (skipped
    // when the mid-hills plate is carrying this layer)
    const midRim = this.lit(pal.mtMid, 18, 0.75);
    if (!midPlate)
      for (let x = 0; x < pw; x++) {
        const h = Math.round((this.mtHeight(x + this.scrollX * 0.3 + 400, pal.mtAmp * 0.75, pal.mtJag * 0.7, 4.1) + 7) * this.S);
        o.fillStyle = this.col(pal.mtMid);
        o.fillRect(x, base - h, 1, h);
        o.fillStyle = midRim;
        o.fillRect(x, base - h, 1, 1);
      }
    // village lights: warm pixels anchored to the mid range, twinkling
    const off = this.scrollX * 0.3;
    for (let i = 0; !midPlate && i < 6; i++) {
      const wxv = 170 + i * 233;
      const sx = Math.round((((wxv - off) % this.worldLen) + this.worldLen) % this.worldLen);
      if (sx < 2 || sx > pw - 4) continue;
      const h = Math.round((this.mtHeight(sx + off + 400, pal.mtAmp * 0.75, pal.mtJag * 0.7, 4.1) + 7) * this.S);
      const tw2 = 0.5 + 0.5 * Math.sin(this.t * 2.2 + i * 2.4);
      // tiny restored lights: distant homes wake up as the orb gathers music
      const valive = 1 + (this.adventure?.orb?.charge || 0) * 0.6;
      o.fillStyle = this.col(pal.torch, (0.3 + tw2 * 0.4 + this.kickPulse * 0.3) * valive);
      o.fillRect(sx, base - Math.round(h * 0.4), 1, 1);
      o.fillRect(sx + 2, base - Math.round(h * 0.4) + 1, 1, 1);
      if (i % 2 === 0) o.fillRect(sx - 2, base - Math.round(h * 0.4) + 2, 1, 1);
      // at high charge a third window lights in each fold
      if ((this.adventure?.orb?.charge || 0) > 0.6) o.fillRect(sx + 1, base - Math.round(h * 0.4) + 3, 1, 1);
    }
    // NEAR HILLS: a fourth, darker ridge sliding at 0.48x with a ragged
    // treeline on its crest — the depth step between the mid range and the
    // roadside props that makes the world read as truly deep
    if (this.cfg.detail !== "pi_safe") {
      const nearCol = this.col(this.mix(pal.mtMid, [7, 7, 14], 0.45));
      const s48 = this.scrollX * 0.48;
      o.fillStyle = nearCol;
      for (let x = 0; x < pw; x++) {
        const wx = x + s48;
        let h = Math.round((this.mtHeight(wx + 1500, pal.mtAmp * 0.5, pal.mtJag * 0.5, 9.3) + 3) * this.S);
        // ragged treeline bumps along the crest
        h += Math.round(Math.abs(Math.sin(wx * 0.22) * Math.sin(wx * 0.061 + 2)) * 3 * this.S);
        o.fillRect(x, base - h, 1, h);
      }
    }
    // HORIZON HAZE: a soft cached band of atmospheric light resting on the
    // horizon — cheap (one drawImage), it lifts the whole scene's depth
    const hazeKey = pal.biome;
    if (!this._haze || this._hazeKey !== hazeKey || this._haze.width !== pw || this.biomeT < 1) {
      this._haze = this._haze && this._haze.width === pw ? this._haze : document.createElement("canvas");
      this._haze.width = pw;
      this._haze.height = 20;
      this._hazeKey = hazeKey;
      const hc = this._haze.getContext("2d");
      hc.clearRect(0, 0, pw, 20);
      const g = hc.createLinearGradient(0, 0, 0, 20);
      g.addColorStop(0, `rgba(${pal.skyLow[0]},${pal.skyLow[1]},${pal.skyLow[2]},0)`);
      g.addColorStop(1, `rgba(${pal.skyLow[0]},${pal.skyLow[1]},${pal.skyLow[2]},0.28)`);
      hc.fillStyle = g;
      hc.fillRect(0, 0, pw, 20);
    }
    o.drawImage(this._haze, 0, base - 20);
    // (landmark is drawn in the main render sequence so it shows for backdrop
    // biomes too, where drawMountains early-returns above)
  }

  drawLandmark(o, pal) {
    // imported gateway landmark: a prominent gate at the hero's level (parallax
    // 0.7) scrolling past once per world loop — the biome's destination.
    const gate = BIOME_GATE[pal.biome];
    if (this.useAssets() && gate && this.assets.ready(gate)) {
      const goff = this.scrollX * 0.7;
      const gsx = Math.round((((this.landmarkX - goff) % this.worldLen) + this.worldLen) % this.worldLen);
      if (gsx < -90 || gsx > this.pw + 90) return;
      this.assets.drawSprite(o, gate, "idle", 0, gsx, this.groundY(gsx) + 1, { anchor: "bottom-center", scale: 1.3 });
      return;
    }
    const off = this.scrollX * 0.3;
    const sx = Math.round(((this.landmarkX - off) % this.worldLen + this.worldLen) % this.worldLen);
    if (sx < -40 || sx > this.pw + 40) return;
    const base = this.groundBase() - 6;
    const c = this.col(pal.mtMid.map((v) => Math.max(0, v - 14)));
    o.fillStyle = c;
    const lm = pal.landmark;
    if (lm === "castle") {
      o.fillRect(sx, base - 14, 22, 14);
      o.fillRect(sx + 2, base - 20, 4, 6);
      o.fillRect(sx + 16, base - 20, 4, 6);
      o.fillRect(sx + 9, base - 24, 4, 10);
      for (let i = 0; i < 6; i++) o.fillRect(sx + i * 4, base - 16, 2, 2); // crenellation
      o.fillStyle = this.col(pal.torch, 0.8 + this.torchFlare * 0.2);
      o.fillRect(sx + 10, base - 21, 1, 1); // lit window
      o.fillRect(sx + 4, base - 11, 1, 1);
      // a small banner on the keep, stirring gently — Castle Approach only
      // (the only biome using this landmark now, so always drawn)
      const wave = Math.sin(this.t * 2) * 1;
      o.fillStyle = this.col(pal.torch, 0.55);
      o.fillRect(sx + 11 + Math.round(wave), base - 30, 2, 4);
    } else if (lm === "ruins") {
      for (let i = 0; i < 5; i++) o.fillRect(sx + i * 6, base - 8 - (i % 3) * 3, 3, 8 + (i % 3) * 3);
      o.fillRect(sx, base - 12, 27, 2); // broken lintel
    } else if (lm === "tower") {
      o.fillRect(sx + 4, base - 26, 7, 26);
      o.fillRect(sx + 2, base - 26, 11, 3);
      o.fillStyle = this.col(pal.torch, 0.7 + this.torchFlare * 0.3);
      o.fillRect(sx + 7, base - 23, 2, 2); // beacon
    } else if (lm === "mushroom") {
      o.fillRect(sx + 8, base - 16, 6, 16);
      o.fillStyle = this.col(pal.prop, 0.85);
      o.fillRect(sx, base - 22, 22, 7);
      o.fillRect(sx + 3, base - 24, 16, 2);
      o.fillStyle = this.col(pal.firefly, 0.7);
      o.fillRect(sx + 5, base - 20, 2, 2);
      o.fillRect(sx + 15, base - 19, 2, 2);
    } else if (lm === "arcade") {
      // a row of broken cabinet husks, neon outlines instead of a warm glow
      for (let i = 0; i < 4; i++) o.fillRect(sx + i * 6, base - 10 - (i % 2) * 3, 4, 10 + (i % 2) * 3);
      const flick = 0.5 + 0.5 * Math.sin(this.t * 9 + sx) + this.kickPulse * 0.4;
      o.fillStyle = this.col(pal.prop, 0.55 * flick);
      o.fillRect(sx + 1, base - 9, 2, 3);
      o.fillRect(sx + 13, base - 12, 2, 3);
      o.fillStyle = this.col(pal.propDark, 0.5 + this.treble.value * 0.3);
      o.fillRect(sx + 7, base - 11, 2, 3);
    } else {
      // shrine
      o.fillRect(sx + 2, base - 4, 16, 4);
      o.fillRect(sx + 4, base - 12, 2, 8);
      o.fillRect(sx + 14, base - 12, 2, 8);
      o.fillRect(sx, base - 14, 20, 2);
      o.fillRect(sx + 2, base - 17, 16, 2);
    }
  }

  drawProps(o, pal) {
    const off = this.scrollX * 0.7;
    const L = this.worldLen;
    // imported per-biome foliage/rocks replace the procedural drawTree/rock when
    // present; each placed tree/rock carries a `variant` picking one of 3 sprites
    const foliage = BIOME_FOLIAGE[pal.biome];
    const foliageReady = this.useAssets() && foliage && this.assets.ready(foliage);
    const rocksReady = this.useAssets() && this.assets.ready("rocks");
    for (const tr of this.trees) {
      const sx = Math.round((((tr.x - off) % L) + L) % L);
      if (sx < -40 || sx > this.pw + 40) continue;
      const gy = this.groundY(sx) + 1;
      const sway = Math.round(Math.sin(this.t * (1 + this.mids.value * 2) + tr.x) * this.mids.value * 1.2);
      if (foliageReady) this.assets.drawSprite(o, foliage, "v", 0, sx + sway, gy, { anchor: "bottom-center", frame: tr.variant, scale: tr.s });
      else this.drawTree(o, pal, sx + sway, gy, tr.s * this.S);
    }
    for (const rk of this.rocks) {
      const sx = Math.round((((rk.x - off) % L) + L) % L);
      if (sx < -20 || sx > this.pw + 20) continue;
      const gy = this.groundY(sx) + 1;
      if (rocksReady) this.assets.drawSprite(o, "rocks", "v", 0, sx, gy, { anchor: "bottom-center", frame: rk.variant, scale: 0.62 });
      else { o.fillStyle = this.col(pal.groundDark); o.fillRect(sx, gy - 2, rk.w, 2); }
    }
    for (const to of this.torches) {
      const sx = Math.round((((to.x - off) % L) + L) % L);
      if (sx < -8 || sx > this.pw + 8) continue;
      const gy = this.groundY(sx) + 1;
      this.drawTorch(o, pal, sx, gy, to.ph);
    }
    for (const at of this.attractions) {
      const sx = Math.round((((at.x - off) % L) + L) % L);
      if (sx < -34 || sx > this.pw + 34) continue;
      const gy = this.groundY(sx) + 1;
      if (at.type === "cottage") this.drawCottage(o, pal, sx, gy);
      else if (at.type === "windmill") this.drawWindmill(o, pal, sx, gy);
      else if (at.type === "campfire") this.drawCampfire(o, pal, sx, gy);
      else this.drawSnail(o, pal, sx, gy);
    }
  }

  drawCottage(o, pal, x, gy) {
    // ASSET PATH: a real baked cottage (roof, timber, warm window, chimney)
    // with reactive window glow + curling smoke layered live on top
    if (this.useAssets() && this.assets.ready("house")) {
      this.assets.drawSprite(o, "house", "idle", this.t, x, gy + 1, { anchor: "bottom-left" });
      const walive = 1 + (this.adventure?.orb?.charge || 0) * 0.45;
      const wg = (0.2 + this.bass.value * 0.06 + this.kickPulse * 0.22) * walive;
      o.fillStyle = this.col(pal.torch, Math.min(0.5, wg)); // window pulse
      o.fillRect(x + 16, gy - 10, 6, 5);
      o.fillStyle = this.col(pal.torch, wg * 0.4); // light pool
      o.fillRect(x + 4, gy - 1, 18, 2);
      const cx0 = x + 22;
      for (let k = 0; k < 3; k++) {
        const drift = Math.round(Math.sin(this.t * 0.8 + k * 1.7 + x) * (k + 1) * 0.8);
        o.fillStyle = `rgba(190,190,205,${0.2 - k * 0.06})`;
        o.fillRect(cx0 + drift, gy - 22 - k * 3 - Math.round((this.t * 2 + x) % 3), 1, 1);
      }
      return;
    }
    const S = this.S;
    const w = Math.round(12 * S);
    const h = Math.round(6 * S);
    o.fillStyle = this.col(this.mix(pal.trunk, pal.groundDark, 0.35));
    o.fillRect(x, gy - h, w, h);
    // roof
    o.fillStyle = this.col(pal.propDark);
    const rh = Math.round(4 * S);
    for (let i = 0; i < rh; i++) o.fillRect(x - 2 + i, gy - h - 1 - i, w + 4 - i * 2, 1);
    // door
    o.fillStyle = this.col(pal.groundDark);
    o.fillRect(x + 2, gy - Math.round(4 * S), 3, Math.round(4 * S));
    // a warm lit window (someone's home) — brighter as music returns
    const wx = x + w - 6;
    const walive = 1 + (this.adventure?.orb?.charge || 0) * 0.45;
    o.fillStyle = this.col(pal.torch, (0.2 + this.bass.value * 0.06 + this.kickPulse * 0.22) * walive);
    o.fillRect(wx - 1, gy - h + 2, 5, 5);
    o.fillStyle = this.col(pal.torch, 0.9);
    o.fillRect(wx, gy - h + 3, 3, 3);
    o.fillStyle = "rgba(20,14,20,0.9)";
    o.fillRect(wx + 1, gy - h + 3, 1, 3);
    o.fillRect(wx, gy - h + 4, 3, 1);
    // chimney, with a thin curl of smoke drifting up — someone is home,
    // waiting for the music to come back
    o.fillStyle = this.col(pal.propDark);
    o.fillRect(x + w - 4, gy - h - Math.round(3 * S), 2, Math.round(3 * S));
    const cy0 = gy - h - Math.round(3 * S) - 1;
    for (let k = 0; k < 3; k++) {
      const drift = Math.round(Math.sin(this.t * 0.8 + k * 1.7 + x) * (k + 1) * 0.8);
      o.fillStyle = `rgba(190,190,205,${0.22 - k * 0.06})`;
      o.fillRect(x + w - 4 + drift, cy0 - k * 3 - Math.round((this.t * 2 + x) % 3), 1 + (k > 1 ? 1 : 0), 1);
    }
  }

  drawWindmill(o, pal, x, gy) {
    if (this.useAssets() && this.assets.ready("windmill")) {
      this.assets.drawSprite(o, "windmill", "idle", this.t, x, gy + 1, { anchor: "bottom-center" });
      return;
    }
    const S = this.S;
    const h = Math.round(14 * S);
    // tapered tower
    o.fillStyle = this.col(pal.trunk);
    o.fillRect(x, gy - (h >> 1), Math.round(5 * S) >> 0, h >> 1);
    o.fillRect(x + 1, gy - h, Math.round(5 * S) - 2, h);
    // cap
    o.fillStyle = this.col(pal.propDark);
    o.fillRect(x, gy - h - 2, Math.round(5 * S), 2);
    // turning blades
    const cx2 = x + (Math.round(5 * S) >> 1);
    const cy2 = gy - h - 1;
    const len = Math.round(7 * S);
    o.fillStyle = this.lit(pal.trunk, 26, 0.9);
    const ang = this.t * 0.7;
    for (let k = 0; k < 4; k++) {
      const a = ang + (k * Math.PI) / 2;
      for (let j = 2; j <= len; j++) {
        o.fillRect(cx2 + Math.round(Math.cos(a) * j), cy2 + Math.round(Math.sin(a) * j), 1, 1);
      }
    }
    o.fillStyle = this.col(pal.propDark);
    o.fillRect(cx2 - 1, cy2 - 1, 2, 2); // hub
  }

  // The Campfire Pause (Adventure Layer) reacts to this same attraction
  // slot everywhere — the trigger/pause mechanic never changes — but what
  // it looks like adapts to the current biome: a literal campfire on the
  // Meadow Road, a glowing mushroom cluster in the Neon Forest, a
  // streetlamp in Moonlit Town, an old cabinet's glow in Arcade Ruins, and
  // a roadside brazier approaching the castle.
  drawCampfire(o, pal, x, gy) {
    const biome = pal.biome;
    if (biome === "neon-forest") return this.drawCampfireMushrooms(o, pal, x, gy);
    if (biome === "moonlit-town") return this.drawCampfireLamp(o, pal, x, gy);
    if (biome === "arcade-ruins") return this.drawCampfireCabinet(o, pal, x, gy);
    if (biome === "castle-approach") return this.drawCampfireBrazier(o, pal, x, gy);
    if (this.useAssets() && this.assets.ready("campfire")) {
      // warm glow pool + rising embers layered live on the imported campfire
      o.fillStyle = this.col(pal.torch, 0.08 + this.bass.value * 0.05 + this.kickPulse * 0.13);
      o.fillRect(x - 6, gy - 11, 16, 11);
      this.assets.drawSprite(o, "campfire", "idle", this.t, x, gy + 1, { anchor: "bottom-center" });
      if (this.particles.length < 90 && Math.random() < 0.04 + this.bass.value * 0.05)
        this.particles.push({ kind: "ember", x: x + 1, y: gy - 8, vx: (Math.random() - 0.5) * 4, vy: -8 - Math.random() * 6, age: 0, life: 0.9 });
      return;
    }
    const fl = 0.5 + 0.5 * Math.sin(this.t * 11 + x) + this.kickPulse;
    // warm glow pool, pumping on the kick
    o.fillStyle = this.col(pal.torch, 0.09 + this.bass.value * 0.05 + this.kickPulse * 0.14);
    o.fillRect(x - 4, gy - 9, 13, 9);
    // logs
    o.fillStyle = this.col(pal.trunk);
    o.fillRect(x - 2, gy - 2, 9, 1);
    o.fillRect(x - 1, gy - 1, 7, 1);
    // layered flame
    o.fillStyle = this.col(pal.torch, 0.9);
    o.fillRect(x + 1, gy - 5 - Math.round(fl * 2), 3, 3 + Math.round(fl * 2));
    o.fillStyle = "rgba(255,240,200,0.95)";
    o.fillRect(x + 2, gy - 4, 1, 2);
    if (this.particles.length < 90 && Math.random() < 0.04 + this.bass.value * 0.05) {
      this.particles.push({
        kind: "ember",
        x: x + 2,
        y: gy - 6,
        vx: (Math.random() - 0.5) * 4,
        vy: -8 - Math.random() * 6,
        age: 0,
        life: 0.9,
      });
    }
  }

  drawCampfireMushrooms(o, pal, x, gy) {
    const glow = 0.55 + this.bass.value * 0.3 + this.kickPulse * 0.25;
    o.fillStyle = this.col(pal.torch, 0.08 + glow * 0.08);
    o.fillRect(x - 4, gy - 8, 13, 8);
    for (const [dx, h] of [[0, 5], [4, 7], [8, 4]]) {
      o.fillStyle = this.col(pal.trunk, 0.9);
      o.fillRect(x + dx, gy - h, 2, h);
      o.fillStyle = this.col(pal.prop, glow);
      o.fillRect(x + dx - 1, gy - h - 2, 4, 2);
    }
    if (this.particles.length < 90 && Math.random() < 0.03 + this.treble.value * 0.04) {
      this.particles.push({ kind: "sparkle", x: x + 4, y: gy - 8, vx: 0, vy: -3, age: 0, life: 0.6 });
    }
  }

  drawCampfireLamp(o, pal, x, gy) {
    const flick = 0.6 + 0.4 * Math.sin(this.t * 6 + x) * (0.5 + this.treble.value * 0.5);
    o.fillStyle = this.col(pal.propDark);
    o.fillRect(x + 2, gy - 14, 1, 14); // post
    o.fillStyle = this.col(pal.propDark);
    o.fillRect(x, gy - 16, 5, 2); // lamp housing
    o.fillStyle = this.col(pal.torch, 0.5 + flick * 0.5);
    o.fillRect(x + 1, gy - 15, 3, 1); // the light itself
    o.fillStyle = this.col(pal.torch, 0.06 + flick * 0.1 + this.bass.value * 0.05);
    o.fillRect(x - 5, gy - 20, 15, 15); // soft pool of lamplight
  }

  drawCampfireCabinet(o, pal, x, gy) {
    const flick = 0.55 + this.treble.value * 0.35 + (Math.random() < 0.05 ? 0.3 : 0);
    o.fillStyle = this.col(pal.propDark, 0.9);
    o.fillRect(x, gy - 12, 8, 12);
    o.fillRect(x + 1, gy - 13, 6, 1);
    o.fillStyle = this.col(pal.prop, flick);
    o.fillRect(x + 2, gy - 10, 4, 4); // the old screen's glow
    o.fillStyle = this.col(pal.torch, 0.3 + this.kickPulse * 0.4);
    o.fillRect(x + 3, gy - 4, 1, 1);
    o.fillRect(x + 5, gy - 4, 1, 1);
    o.fillStyle = this.col(pal.prop, 0.06 + flick * 0.1);
    o.fillRect(x - 3, gy - 15, 14, 15);
  }

  drawCampfireBrazier(o, pal, x, gy) {
    if (this.useAssets() && this.assets.ready("brazier")) {
      o.fillStyle = this.col(pal.torch, 0.08 + this.bass.value * 0.05 + this.kickPulse * 0.14);
      o.fillRect(x - 5, gy - 16, 14, 16);
      this.assets.drawSprite(o, "brazier", "idle", this.t, x, gy + 1, { anchor: "bottom-center" });
      if (this.particles.length < 90 && Math.random() < 0.04 + this.bass.value * 0.05)
        this.particles.push({ kind: "ember", x: x + 1, y: gy - 12, vx: (Math.random() - 0.5) * 3, vy: -7 - Math.random() * 5, age: 0, life: 0.8 });
      return;
    }
    const fl = 0.5 + 0.5 * Math.sin(this.t * 10 + x) + this.kickPulse;
    o.fillStyle = this.col(pal.propDark);
    o.fillRect(x + 1, gy - 6, 1, 6); // stand
    o.fillRect(x - 1, gy - 7, 5, 2); // bowl
    o.fillStyle = this.col(pal.torch, 0.85);
    o.fillRect(x, gy - 10 - Math.round(fl * 2), 3, 3 + Math.round(fl * 2));
    o.fillStyle = this.col(pal.torch, 0.09 + this.bass.value * 0.05 + this.kickPulse * 0.14);
    o.fillRect(x - 5, gy - 15, 13, 15);
    if (this.particles.length < 90 && Math.random() < 0.04 + this.bass.value * 0.05) {
      this.particles.push({ kind: "ember", x: x + 1, y: gy - 10, vx: (Math.random() - 0.5) * 3, vy: -7 - Math.random() * 5, age: 0, life: 0.8 });
    }
  }

  drawSnail(o, pal, x, gy) {
    if (this.useAssets() && this.assets.ready("snail")) {
      this.assets.drawSprite(o, "snail", "idle", this.t, x, gy + 1, { anchor: "bottom-center" });
      return;
    }
    // a snail. wearing a tiny fedora. no further questions.
    o.fillStyle = "rgb(150,170,110)";
    o.fillRect(x, gy - 2, 6, 2); // body
    o.fillStyle = "rgb(120,140,90)";
    o.fillRect(x + 6, gy - 4, 1, 3); // eye stalk
    o.fillRect(x + 5, gy - 5, 1, 1); // eye
    // shell
    o.fillStyle = "rgb(170,120,80)";
    o.fillRect(x + 1, gy - 5, 4, 3);
    o.fillStyle = "rgb(130,88,58)";
    o.fillRect(x + 2, gy - 4, 2, 1);
    // the fedora
    o.fillStyle = "rgb(16,13,20)";
    o.fillRect(x, gy - 6, 6, 1); // brim
    o.fillRect(x + 1, gy - 8, 4, 2); // crown
    o.fillStyle = "rgb(126,110,138)";
    o.fillRect(x + 1, gy - 6, 4, 1); // band... on the brim line, snail-style
  }

  // a good dog trots past from time to time
  updateDog(o, pal, dt, speed) {
    this.dogTimer -= dt;
    if (!this.dog && this.dogTimer <= 0) {
      this.dog = { x: this.pw + 14, f: 0, ft: 0 };
      this.dogTimer = 30 + Math.random() * 45;
    }
    if (!this.dog) return;
    const d = this.dog;
    d.x -= (26 + speed * 0.45) * dt; // trotting past the hero
    d.ft += dt * 9;
    if (d.ft > 1) {
      d.ft = 0;
      d.f = 1 - d.f;
    }
    const X = Math.round(d.x);
    const Y = this.groundY(Math.max(0, Math.min(this.pw - 1, X)));
    o.fillStyle = "rgb(146,102,58)";
    o.fillRect(X, Y - 5, 8, 3); // body
    o.fillRect(X + 7, Y - 7, 3, 3); // head
    o.fillStyle = "rgb(110,74,40)";
    o.fillRect(X + 9, Y - 8, 1, 1); // ear
    o.fillRect(X - 1, Y - 6 + (d.f ? 1 : 0), 2, 1); // wagging tail
    o.fillStyle = "rgb(120,82,46)";
    if (d.f) {
      o.fillRect(X + 1, Y - 2, 1, 2);
      o.fillRect(X + 6, Y - 2, 1, 2);
    } else {
      o.fillRect(X + 2, Y - 2, 1, 2);
      o.fillRect(X + 5, Y - 2, 1, 2);
    }
    o.fillStyle = "rgb(30,22,26)";
    o.fillRect(X + 10, Y - 6, 1, 1); // nose
    if (d.x < -16) this.dog = null;
  }

  drawTree(o, pal, x, gy, s) {
    const b = this.palRef.biome;
    const S = this.S;
    if (b === "desert_ruins") {
      // cactus
      const ch = Math.round(9 * S);
      o.fillStyle = this.col(pal.prop);
      o.fillRect(x + 2, gy - ch, 2, ch);
      o.fillRect(x, gy - ch + 2, 2, 2);
      o.fillRect(x, gy - ch + 2, 1, 4);
      o.fillRect(x + 4, gy - ch + 3, 2, 2);
      o.fillRect(x + 5, gy - ch + 3, 1, 4);
      return;
    }
    if (b === "mushroom_grove") {
      const mh = Math.round(6 * S);
      o.fillStyle = this.col(pal.trunk);
      o.fillRect(x + 2, gy - mh, 2, mh);
      o.fillStyle = this.col(Math.random() < 0.5 ? pal.prop : pal.propDark, 0.95);
      o.fillRect(x - 1, gy - mh - 3, 8, 3);
      o.fillRect(x, gy - mh - 4, 6, 1);
      o.fillStyle = this.col(pal.firefly, 0.5 + this.treble.value * 0.4);
      o.fillRect(x + 1, gy - mh - 2, 1, 1);
      o.fillRect(x + 4, gy - mh - 2, 1, 1);
      return;
    }
    // pine with a moonlit side (snowy pines get white tips)
    const hgt = Math.round(11 * s);
    o.fillStyle = this.col(pal.trunk);
    o.fillRect(x + 3, gy - 3, 1, 3);
    const litSide = this.lit(pal.prop, 20, 0.8);
    for (let i = 0; i < hgt - 3; i++) {
      const half = Math.max(1, Math.round(((hgt - 3 - i) / (hgt - 3)) * 3.4));
      o.fillStyle = this.col(pal.prop);
      o.fillRect(x + 3 - half, gy - 3 - i, half * 2 + 1, 1);
      o.fillStyle = litSide;
      o.fillRect(x + 3 + half, gy - 3 - i, 1, 1);
    }
    if (b === "snowy_mountains") {
      o.fillStyle = this.col(pal.cap, 0.85);
      for (let i = hgt - 5; i < hgt - 3; i += 2) {
        const half = Math.max(1, Math.round(((hgt - 3 - i) / (hgt - 3)) * 3.4));
        o.fillRect(x + 3 - half, gy - 3 - i, half * 2 + 1, 1);
      }
    }
  }

  useAssets() {
    return this.cfg.renderMode !== "procedural_fallback";
  }

  // a READABLE hanging lantern (the reference's lonely road-lamps): a tall
  // dark post with a crossarm, a glass lantern box swinging gently beneath
  // it, a warm flame inside, and a pool of light on the road below.
  drawTorch(o, pal, x, gy, ph) {
    // ASSET PATH: once a lantern sheet is ready (the baked demo counts),
    // draw it pixel-perfect and keep only the dynamic light procedural
    if (this.useAssets() && this.assets.ready("lantern")) {
      const alive2 = 1 + (this.adventure?.orb?.charge || 0) * 0.5;
      const glow2 = (this.bass.value * 0.35 + this.torchFlare * 1.1) * alive2;
      this.assets.drawSprite(o, "lantern", "lit", this.t + ph, x, gy + 1);
      // halo + road pool + embers stay live-reactive on top of the art
      o.fillStyle = this.col(pal.torch, (0.07 + glow2 * 0.12) * alive2);
      o.fillRect(x + 2 - Math.round(glow2), gy - Math.round(16 * this.S * 0.7) - Math.round(glow2), 11 + Math.round(glow2) * 2, 11 + Math.round(glow2) * 2);
      o.fillStyle = this.col(pal.torch, (0.06 + glow2 * 0.08) * alive2);
      o.fillRect(x + 1, gy - 1, 9, 2);
      if (this.cfg.renderMode === "asset_showcase")
        this.glowQueue.push(x + 8, gy - Math.round(15 * this.S * 0.7), 6 + glow2 * 2, "255,180,90", 0.05 + glow2 * 0.05);
      if (this.particles.length < 90 && Math.random() < 0.02 + this.bass.value * 0.06 + this.torchFlare * 0.2) {
        this.particles.push({ kind: "ember", x: x + 8, y: gy - Math.round(15 * this.S * 0.7), vx: (Math.random() - 0.5) * 3, vy: -6 - Math.random() * 8, age: 0, life: 0.8 + Math.random() * 0.8 });
      }
      return;
    }
    const S = this.S;
    const pole = Math.round(11 * S);
    const armLen = 4;
    // post + crossarm + brace
    o.fillStyle = this.col(this.mix(pal.trunk, [10, 8, 12], 0.35));
    o.fillRect(x, gy - pole, 2, pole);
    o.fillRect(x, gy - pole, armLen + 2, 1); // arm reaching over the path
    o.fillRect(x + 2, gy - pole + 1, 1, 1); // diagonal brace hint
    o.fillStyle = this.lit(pal.trunk, 16);
    o.fillRect(x - 1, gy - 1, 4, 1); // base plinth
    // the lantern box hangs from the arm's end, swaying gently in the wind
    const sway = Math.round(Math.sin(this.t * 1.4 + ph) * (0.6 + this.mids.value));
    const lx = x + armLen + sway;
    const ly = gy - pole + 2;
    // MUSIC RETURNING: lamps burn warmer as the orb gathers charge
    const alive = 1 + (this.adventure?.orb?.charge || 0) * 0.5;
    const flick = 0.6 + 0.4 * Math.sin(this.t * 9 + ph);
    const glow = (this.bass.value * 0.35 + this.torchFlare * 1.1) * alive;
    o.fillStyle = this.col(this.mix(pal.trunk, [10, 8, 12], 0.35));
    o.fillRect(x + armLen, gy - pole + 1, 1, 1); // hanger link
    o.fillRect(lx - 1, ly, 3, 1); // lantern cap
    o.fillRect(lx - 1, ly + 4, 3, 1); // lantern base
    // the glass, lit from within
    o.fillStyle = this.col(pal.torch, Math.min(1, (0.55 + flick * 0.3 + glow * 0.3) * Math.min(1.3, alive)));
    o.fillRect(lx - 1, ly + 1, 3, 3);
    o.fillStyle = "rgba(255,240,200,0.95)";
    o.fillRect(lx, ly + 2, 1, 1 + Math.round(flick * 0.9)); // the flame
    // stepped halo around the lantern
    o.fillStyle = this.col(pal.torch, (0.07 + glow * 0.12) * alive);
    o.fillRect(lx - 5 - Math.round(glow), ly - 3 - Math.round(glow), 11 + Math.round(glow) * 2, 11 + Math.round(glow) * 2);
    // pool of light on the road beneath
    o.fillStyle = this.col(pal.torch, (0.06 + glow * 0.08) * alive);
    o.fillRect(lx - 4, gy - 1, 9, 2);
    // embers rise on bass
    if (this.particles.length < 90 && Math.random() < 0.02 + this.bass.value * 0.06 + this.torchFlare * 0.2) {
      this.particles.push({ kind: "ember", x: lx, y: ly + 1, vx: (Math.random() - 0.5) * 3, vy: -6 - Math.random() * 8, age: 0, life: 0.8 + Math.random() * 0.8 });
    }
  }

  // foreground silhouette layer: near-black grass tufts at 1.25x parallax
  // along the bottom edge. Drawn AFTER the hero/orb so they sweep past in
  // front — pure depth, deliberately darker than every story object.
  drawForeground(o, pal) {
    // ASSET PATH: an imported foreground plate (meadow_path_foreground.png)
    // replaces the procedural grass silhouettes when present (external-only)
    if (this.useAssets() && this.assets.hasReadyLayer(pal.biome, "foreground")) {
      this.assets.drawParallaxLayer(o, pal.biome, "foreground", this.scrollX, this.pw, this.groundBase() + 20);
      return;
    }
    const off = this.scrollX * 1.25;
    const L = this.worldLen;
    const baseY = this.ph - 2;
    o.fillStyle = "rgba(7,6,12,0.88)";
    for (const p of this.fgPlants) {
      const sx = Math.round((((p.x - off) % L) + L) % L);
      if (sx < -8 || sx > this.pw + 8) continue;
      const sway = Math.sin(this.t * 1.2 + p.ph) * this.mids.value * 1.5;
      for (let b = 0; b < p.blades; b++) {
        const h = Math.round((4 + b * 2) * p.s * this.S * 0.55);
        const bx = sx + b * 2 + Math.round(sway * (b % 2 ? 1 : -0.5));
        o.fillRect(bx, baseY - h, 1, h + 2);
      }
    }
  }

  // path-edge flora at true ground parallax: swaying grass + small flowers
  // whose tips glow with the biome's firefly color. A flower a fragment just
  // bloomed from (_srcGlow) burns bright for a moment — the world visibly
  // MAKES the music-light.
  drawFlora(o, pal) {
    const L = this.worldLen;
    const now = this.clock || 0;
    for (const f of this.flora) {
      const sx = Math.round((((f.x - this.scrollX) % L) + L) % L);
      if (sx < -4 || sx > this.pw + 4) continue;
      const gy = this.groundY(Math.max(0, Math.min(this.pw - 1, sx))) + 1;
      const sway = Math.round(Math.sin(this.t * 1.6 + f.ph) * (0.6 + this.mids.value * 1.4));
      const src = now < f._srcGlow; // a fragment just bloomed from here
      // ASSET PATH: baked grass/flower sprites; the source-glow + firefly
      // bloom stay procedural on top so they still pulse with the music
      const asset = f.type === "grass" ? "grass" : "flower";
      if (this.useAssets() && this.assets.ready(asset)) {
        this.assets.drawSprite(o, asset, "sway", this.t + f.ph, sx, gy + 1, { anchor: "bottom-center" });
        if (f.type === "flower") {
          const glow = (src ? 1 : 0.35 + this.treble.value * 0.35) * (0.7 + 0.3 * Math.sin(this.t * 2 + f.ph));
          o.fillStyle = this.col(pal.firefly, Math.min(1, glow));
          o.fillRect(sx + sway, gy - 8, 1, 1);
          if (src) {
            o.fillStyle = this.col(pal.firefly, 0.35);
            o.fillRect(sx + sway - 1, gy - 9, 3, 3);
          }
        }
        continue;
      }
      if (f.type === "grass") {
        o.fillStyle = this.col(this.mix(pal.groundTop, pal.groundDark, 0.35), 0.9);
        const h = Math.round(3 * f.s * this.S * 0.6) + 1;
        o.fillRect(sx, gy - h, 1, h);
        o.fillRect(sx + 1 + (sway > 0 ? 1 : 0), gy - h + 1, 1, h - 1);
      } else {
        // stem + glowing head
        const h = Math.round(4 * f.s * this.S * 0.6) + 1;
        o.fillStyle = this.col(this.mix(pal.groundTop, pal.groundDark, 0.2), 0.9);
        o.fillRect(sx, gy - h, 1, h);
        const glow = (src ? 1 : 0.35 + this.treble.value * 0.35) * (0.7 + 0.3 * Math.sin(this.t * 2 + f.ph));
        o.fillStyle = this.col(pal.firefly, Math.min(1, glow));
        o.fillRect(sx + sway, gy - h - 1, 1, 1); // the glowing bloom
        if (src) {
          o.fillStyle = this.col(pal.firefly, 0.3);
          o.fillRect(sx + sway - 1, gy - h - 2, 3, 3); // waking halo
        }
      }
    }
  }

  // a soft cinematic vignette, cached per canvas size — one drawImage/frame
  drawVignette(o) {
    if (!this._vig || this._vig.width !== this.pw || this._vig.height !== this.ph) {
      this._vig = document.createElement("canvas");
      this._vig.width = this.pw;
      this._vig.height = this.ph;
      const vc = this._vig.getContext("2d");
      const g = vc.createRadialGradient(
        this.pw / 2, this.ph * 0.55, Math.min(this.pw, this.ph) * 0.45,
        this.pw / 2, this.ph * 0.55, Math.max(this.pw, this.ph) * 0.72
      );
      g.addColorStop(0, "rgba(4,4,12,0)");
      g.addColorStop(1, "rgba(4,4,12,0.42)");
      vc.fillStyle = g;
      vc.fillRect(0, 0, this.pw, this.ph);
    }
    o.drawImage(this._vig, 0, 0);
  }

  drawTerrain(o, pal) {
    const { pw, ph } = this;
    const s0 = this.scrollX | 0;
    const rim = this.lit(pal.groundTop, 26 + Math.round((this.groundBoost || 0) * 50));
    const dark = this.col(pal.groundDark);
    for (let x = 0; x < pw; x++) {
      const gy = this.groundY(x);
      const wx = x + s0;
      // moonlit rim, grass band, soil body
      o.fillStyle = rim;
      o.fillRect(x, gy, 1, 1);
      o.fillStyle = this.col(pal.groundTop);
      o.fillRect(x, gy + 1, 1, 2);
      o.fillStyle = this.col(pal.ground);
      o.fillRect(x, gy + 3, 1, ph - gy - 3);
      // buried pebbles and roots (world-anchored hash so they scroll)
      const hsh = (Math.imul(wx, 2654435761) >>> 8) & 1023;
      if (hsh < 90) {
        o.fillStyle = dark;
        const d = 4 + (hsh % Math.max(3, ph - gy - 8));
        o.fillRect(x, gy + d, 1 + (hsh & 1), 1);
      }
      // THE PATH: worn stepping stones catching the moonlight along the
      // surface — the road he walks reads as a road, like the reference's
      // stone trail (brighter as returning music wakes the world)
      if (hsh > 940) {
        const alive = 0.5 + (this.adventure?.orb?.charge || 0) * 0.3;
        o.fillStyle = this.lit(pal.groundTop, 40, alive);
        o.fillRect(x, gy + 1, 2, 1);
        o.fillStyle = this.col(pal.groundDark, 0.6);
        o.fillRect(x, gy + 2, 2, 1); // each stone's little shadow
      }
      // dithered darkening toward the bottom edge
      if ((x + gy) % 2 === 0) {
        o.fillStyle = dark;
        o.fillRect(x, ph - 3 - (wx % 3), 1, 1);
      }
      o.fillStyle = dark;
      if ((wx & 1) === 0) o.fillRect(x, ph - 1, 1, 1);
      // tiny flowers catching the moonlight
      if (wx % 37 === 0 && ((wx * 13) >> 4) % 4 < 2) {
        o.fillStyle = this.col(pal.firefly, 0.85);
        o.fillRect(x, gy - 2, 1, 1);
        o.fillStyle = dark;
        o.fillRect(x, gy - 1, 1, 1);
      }
    }
    // sparse grass tufts anchored in the world — terrain detail, not an EQ
    o.fillStyle = this.col(pal.groundTop, 0.85);
    for (let x = 8 - (s0 % 9); x < pw; x += 9) {
      const wx = x + s0;
      if ((wx * 7) % 27 < 9) continue;
      o.fillRect(x, this.groundY(x) - 1, 1, 1);
    }
  }

  drawHero(o, pal) {
    const ctl = this.heroCtl;
    // chapter attacks lunge him forward for a moment; the adventure layer's
    // "something caught his eye" reaction leans him forward a touch too
    const lunge = ctl && (ctl.attackT || 0) > 0.1 ? 3 : 0;
    // eased in and back out over the reaction's life, rather than an
    // instant snap to a fixed offset — reads as a lean (forward) or a
    // stepback (a surprised recoil, e.g. when an encounter appears)
    const reactionEase =
      this.reaction && (this.reaction.type === "lean" || this.reaction.type === "stepback")
        ? Math.round(Math.sin(clamp01(this.reaction.t / this.reaction.dur) * Math.PI) * 2)
        : 0;
    const reactionLean = this.reaction && this.reaction.type === "stepback" ? -reactionEase : reactionEase;
    const hx = Math.round(this.pw * this.heroAnchor) - 8 + Math.round(this.heroOffX || 0) + lunge + reactionLean;
    const gy = this.groundY(Math.round(this.pw * this.heroAnchor + (this.heroOffX || 0)));
    // bob is heavier when the bass is heavy
    const bob = this.heroFrame % 2 === 0 && this.bass.value > 0.25 ? 1 : 0;
    const hy = Math.round(gy - 24 + this.heroJumpY + bob);
    // spin easter egg: he pirouettes — the sprite mirrors back and forth.
    // The moonwalk keeps him TURNED AROUND the whole time.
    const spinning = this.egg && this.egg.type === "spin";
    const flip =
      (spinning && Math.floor(this.egg.t / 0.15) % 2 === 1) || (this.egg && this.egg.type === "moonwalk");

    const colors = {
      h: "rgb(52,36,60)",
      H: "rgb(76,56,88)",
      f: "rgb(232,190,150)",
      d: "rgb(198,156,120)",
      c: "rgb(140,50,54)",
      C: "rgb(176,72,64)",
      D: "rgb(110,38,44)",
      G: "rgb(206,164,84)",
      b: "rgb(60,44,38)",
      B: "rgb(86,64,50)",
      s: "rgb(96,70,44)",
      S: "rgb(126,96,62)",
      l: "rgb(70,54,40)",
      L: `rgba(255,${200 + Math.round(this.lanternFlash * 55)},110,${0.85 + this.lanternFlash * 0.15})`,
      p: "rgb(78,56,38)", // traveler's little backpack (leather)
      P: "rgb(112,82,54)", // backpack lit edge
      e: "rgb(44,32,40)", // his eyes — the tiny human heart of the sprite
    };
    // event costume: glowing red shoes
    if (this.egg && this.egg.type === "redshoes") {
      const hot2 = 0.75 + this.kickPulse * 0.25;
      colors.b = `rgba(235,54,44,${hot2})`;
      colors.B = `rgba(255,120,70,${hot2})`;
    }
    // event costume: spooky dance — a brighter red jacket for the shuffle
    if (this.egg && this.egg.type === "spookydance") {
      colors.c = "rgb(186,38,44)";
      colors.C = "rgb(226,70,58)";
    }
    // event costume: levitating board — he rides, feet together
    const hovering = this.egg && this.egg.type === "hoverboard";
    let hoverLift = 0;
    if (hovering) {
      hoverLift = 5 + Math.round(Math.sin(this.t * 3) * 1 + this.bass.value * 2);
    }
    // event action: whip swing — one brief arc over the road
    const swinging = this.egg && this.egg.type === "whipswing";
    if (swinging) {
      const sp = Math.min(1, this.egg.t / this.egg.dur);
      hoverLift += Math.round(Math.sin(sp * Math.PI) * 12);
    }
    // grounding shadow, shrinking while he's in the air
    const air = Math.min(16, -this.heroJumpY);
    const shW = Math.max(4, 12 - Math.round(air * 0.5));
    o.fillStyle = "rgba(0,0,0,0.3)";
    o.fillRect(hx + 8 - (shW >> 1), gy, shW, 1);

    const hy2 = hy - hoverLift;
    // the adventure layer's orb companion anchors itself off this
    this.heroScreenX = hx;
    this.heroScreenY = hy2;
    // ASSET PATH: once a hero sheet exists (see ASSET_MANIFEST.hero for the
    // anim contract), plain travel renders from it — costume events and
    // chapter set-pieces keep the procedural path so their overlays fit
    if (this.useAssets() && this.assets.ready("hero") && !this.egg && !ctl) {
      const r = this.reaction?.type;
      const anim =
        r === "lookup" ? "lookUp"
        : r === "lean" ? "lookAtOrb"
        : r === "stepback" ? "stepBack"
        : r === "celebrate" ? "celebrateSmall"
        : this.t < (this._storyRestUntil || 0) ? "rest"
        : (this.cruise || 0) < 4 ? "idle"
        : "walk";
      // WALK: a dedicated fluid 6-frame cycle. Drive the frame from a continuous
      // stride phase (heroFrame + heroAnimT, +1 per step) so it flows with ground
      // speed. Full cycle = 2 steps = 6 frames. Falls back to the traveler sheet's
      // 2-frame walk if the walk sheet is missing.
      if (anim === "walk" && this.assets.ready("heroWalk")) {
        const wp = this.heroFrame + this.heroAnimT;
        const wf = ((Math.floor(wp * 3) % 6) + 6) % 6;
        this.assets.drawSprite(o, "heroWalk", "walk", 0, hx + 8, gy + 1, { anchor: "bottom-center", frame: wf });
        return;
      }
      // idle / poses / reactions (and the walk fallback) use the traveler sheet
      this.assets.drawSprite(o, "hero", anim, this.heroAnimT + this.heroFrame, hx + 8, gy + 1, { anchor: "bottom-center", frame: anim === "walk" ? this.heroFrame : 0 });
      return;
    }
    const rows = HERO_TORSO.concat(
      this.heroJumpY < 0 || hovering || swinging ? HERO_LEGS_JUMP : HERO_LEGS[spinning ? 1 : this.heroFrame]
    );
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let cix = 0; cix < row.length; cix++) {
        const ch = row[cix];
        if (ch === ".") continue;
        o.fillStyle = colors[ch] || "rgb(200,200,200)";
        o.fillRect(hx + (flip ? row.length - 1 - cix : cix), hy2 + r, 1, 1);
      }
    }
    // SIGNATURE SCARF — a little cream scarf at his neck: his single most
    // identifiable silhouette element, a small brave traveler with a scarf.
    // It HANGS gently when he's still (a soft idle sway) and STREAMS out
    // behind him, fluttering with the bass and lifting on peaks, when he
    // runs. Skipped for costume events (they replace his look) and when he's
    // turned around (moonwalk/spin) or riding a board.
    if (!flip && !(this.egg && (this.egg.type === "hoverboard" || this.egg.type === "boombox"))) {
      const speed01 = clamp01((this.cruise || 0) / 55);
      const stream = clamp01(speed01 * 1.3); // 0 = hangs down, 1 = streams back
      const peakLift = this.adventure?.mood?.state === "peak" ? 1.5 : 1;
      const wind = 0.35 + speed01 * 1.4 + this.bass.value * 1.1;
      const knotX = hx + 4;
      const knotY = hy2 + 7; // at his neck, just under the bigger hood
      o.fillStyle = "rgb(232,214,176)"; // the knot at his neck
      o.fillRect(knotX, knotY, 3, 2);
      for (let k = 1; k <= 4; k++) {
        // blends from hanging straight down (idle) to streaming left (running)
        const dx = Math.round(-1 - k * 2 * stream);
        const dyHang = Math.round(k * 1.7 * (1 - stream));
        const flutter = Math.sin(this.t * (4 + speed01 * 8) - k * 0.7) * (0.4 + k * 0.4) * wind * peakLift;
        const sx = knotX + dx;
        const sy = knotY + 1 + dyHang + Math.round(flutter);
        o.fillStyle = k >= 3 ? "rgb(206,186,150)" : "rgb(232,214,176)";
        o.fillRect(sx, sy, 3, k <= 2 ? 2 : 1);
      }
    }
    // adventure reaction: something in the sky caught his eye — a brief
    // upward glance, just a bright glint under the hood
    if (this.reaction && this.reaction.type === "lookup") {
      const k = Math.sin(clamp01(this.reaction.t / this.reaction.dur) * Math.PI);
      o.fillStyle = `rgba(255,240,210,${0.7 * k})`;
      o.fillRect(hx + 6, hy2 - 1, 2, 1);
    }
    // spooky dance: stiff zombie arms, alternating on the beat
    if (this.egg && this.egg.type === "spookydance") {
      const df = this.egg.danceFrame || 0;
      o.fillStyle = colors.C;
      o.fillRect(hx - 4, hy2 + (df ? 8 : 10), 5, 1); // left arm out
      o.fillRect(hx + 11, hy2 + (df ? 10 : 8), 5, 1); // right arm out
      o.fillStyle = colors.f;
      o.fillRect(hx - 4, hy2 + (df ? 7 : 9), 1, 1); // hands
      o.fillRect(hx + 15, hy2 + (df ? 9 : 7), 1, 1);
    }
    // cool pose: dark sunglasses, slow strut, lens glint on the beat
    if (this.egg && this.egg.type === "coolpose") {
      o.fillStyle = "rgb(14,12,20)";
      o.fillRect(hx + 4, hy2 + 4, 3, 2); // lenses (over his eyes, rows 4-5)
      o.fillRect(hx + 8, hy2 + 4, 3, 2);
      o.fillRect(hx + 7, hy2 + 4, 1, 1); // bridge
      if ((this.egg.glint || 0) > 0) {
        o.fillStyle = "rgba(255,255,255,0.95)";
        o.fillRect(hx + 9, hy2 + 4, 1, 1); // the shine
      }
    }
    // chapter set-piece poses: sword ready/strike and the victory arms
    if (ctl && (ctl.pose === "ready" || ctl.pose === "attack" || (ctl.attackT || 0) > 0)) {
      if ((ctl.attackT || 0) > 0.1) {
        o.fillStyle = "rgb(225,235,250)";
        o.fillRect(hx + 16, hy2 + 9, 6, 1); // blade thrust
        o.fillStyle = `rgba(255,235,170,${Math.min(1, ctl.attackT * 4)})`;
        o.fillRect(hx + 17, hy2 + 7, 4, 5); // strike flash
      } else if (ctl.pose === "ready") {
        o.fillStyle = "rgb(225,235,250)";
        o.fillRect(hx + 14, hy2 + 2, 1, 6); // blade raised, waiting for the beat
        o.fillStyle = "rgb(214,178,94)";
        o.fillRect(hx + 13, hy2 + 8, 3, 1); // guard
      }
    }
    // chapter victories AND adventure "arrival" moments share this pose —
    // the same fist-pump, whatever earned it
    if ((ctl && ctl.pose === "celebrate") || (this.reaction && this.reaction.type === "celebrate")) {
      o.fillStyle = colors.C;
      o.fillRect(hx + 1, hy2 + 5, 1, 3); // arms up!
      o.fillRect(hx + 14, hy2 + 5, 1, 3);
      o.fillStyle = colors.f;
      o.fillRect(hx + 1, hy2 + 4, 1, 1); // hands
      o.fillRect(hx + 14, hy2 + 4, 1, 1);
    }
    if (swinging) {
      // the whip: a taut pixel line from an anchor ahead down to his hand
      const sp = Math.min(1, this.egg.t / this.egg.dur);
      if (sp > 0.04 && sp < 0.96) {
        const ax2 = hx + 24;
        const ay2 = gy - 44;
        const hxh = hx + 12;
        const hyh = hy2 + 7;
        o.fillStyle = "rgba(96,74,52,0.95)";
        for (let k = 0; k <= 10; k++) {
          const px = Math.round(ax2 + (hxh - ax2) * (k / 10));
          const py = Math.round(ay2 + (hyh - ay2) * (k / 10) + Math.sin((k / 10) * Math.PI) * 2);
          o.fillRect(px, py, 1, 1);
        }
      }
    }
    if (hovering) {
      // the board: pink deck, cyan underglow, hover shimmer beneath
      const by3 = hy2 + 24;
      o.fillStyle = "rgb(255,110,190)";
      o.fillRect(hx + 2, by3, 12, 1);
      o.fillStyle = "rgb(150,60,120)";
      o.fillRect(hx + 2, by3 + 1, 12, 1);
      o.fillStyle = `rgba(120,230,255,${0.5 + this.kickPulse * 0.4})`;
      o.fillRect(hx + 3, by3 + 2, 10, 1);
      o.fillStyle = `rgba(120,230,255,${0.15 + this.bass.value * 0.15})`;
      o.fillRect(hx + 4, by3 + 3, 8, 2);
    }
    if (this.egg && this.egg.type === "redshoes" && this.heroJumpY === 0) {
      // hot feet: ember glow under the stride
      o.fillStyle = `rgba(255,110,60,${0.25 + this.kickPulse * 0.4})`;
      o.fillRect(hx + 3, gy - 1, 10, 1);
    }
    // moonwalk means the fedora comes out: it drops on, rides the glide,
    // and lifts away at the end like nothing ever happened
    if (this.egg && this.egg.type === "moonwalk") {
      const e = this.egg;
      const tIn = 0.35;
      const tOut = 0.4;
      let off = 0;
      let a = 1;
      if (e.t < tIn) {
        const k = e.t / tIn;
        off = -10 * (1 - k);
        a = k;
      } else if (e.t > e.dur - tOut) {
        const k = (e.t - (e.dur - tOut)) / tOut;
        off = -12 * k;
        a = 1 - k;
      }
      const yH = hy + Math.round(off);
      o.fillStyle = `rgba(16,13,20,${0.96 * a})`; // black felt
      o.fillRect(hx + 3, yH + 2, 11, 1); // brim
      o.fillRect(hx + 5, yH - 1, 7, 3); // crown, leaning slightly forward
      o.fillStyle = `rgba(126,110,138,${0.9 * a})`; // satin band
      o.fillRect(hx + 5, yH + 1, 7, 1);
      // slick slide streaks trailing off his heels (he slides rightward
      // while facing left, so the streaks trail to his left)
      if (e.t > tIn && e.t < e.dur - tOut) {
        o.fillStyle = "rgba(225,232,255,0.3)";
        o.fillRect(hx - 6, gy - 1, 4, 1);
        o.fillRect(hx - 7, gy - 3, 3, 1);
      }
    }

    // boombox showpiece: held overhead, speakers pumping on the kick
    if (this.egg && this.egg.type === "boombox") {
      const e = this.egg;
      const a = Math.min(1, e.t * 3, (e.dur - e.t) * 3);
      const lift = Math.round(Math.max(0, 0.35 - e.t) * 18); // raised into place
      const by2 = hy - 8 + lift;
      o.fillStyle = `rgba(30,26,34,${0.95 * a})`; // the box
      o.fillRect(hx + 3, by2, 10, 6);
      o.fillStyle = `rgba(74,66,82,${a})`; // top edge + handle
      o.fillRect(hx + 3, by2, 10, 1);
      o.fillRect(hx + 6, by2 - 1, 4, 1);
      const hot = this.kickPulse;
      o.fillStyle = `rgba(255,${170 + Math.round(hot * 70)},110,${(0.55 + hot * 0.45) * a})`; // speakers
      o.fillRect(hx + 4, by2 + 2, 2 + Math.round(hot), 2 + Math.round(hot));
      o.fillRect(hx + 10 - Math.round(hot), by2 + 2, 2 + Math.round(hot), 2 + Math.round(hot));
      o.fillStyle = `rgba(120,220,255,${(0.4 + hot * 0.4) * a})`; // tape window
      o.fillRect(hx + 7, by2 + 3, 2, 1);
      o.fillStyle = "rgb(140,50,54)"; // arms up holding it
      o.fillRect(hx + 3, by2 + 6, 1, 2);
      o.fillRect(hx + 12, by2 + 6, 1, 2);
    }

    // event costume: power glove — a glowing gauntlet on the forward hand
    if (this.egg && this.egg.type === "powerglove") {
      const glow = this.egg.glow || 0;
      o.fillStyle = "rgba(210,214,224,0.92)";
      o.fillRect(hx + 12, hy2 + 10, 4, 3); // gauntlet body (hand height)
      o.fillStyle = `rgba(255,${90 + Math.round(glow * 60)},70,${0.5 + glow * 0.5})`;
      o.fillRect(hx + 13, hy2 + 11, 1, 1); // button lights
      o.fillStyle = `rgba(90,200,255,${0.5 + glow * 0.5})`;
      o.fillRect(hx + 14, hy2 + 11, 1, 1);
      o.fillStyle = `rgba(255,230,120,${0.15 + glow * 0.5})`; // spark halo
      o.fillRect(hx + 10, hy2 + 8, 8, 7);
    }
    // event: cape flourish — a billowing cloak trail, no costume recolor
    if (this.egg && this.egg.type === "cape") {
      const billow = Math.sin(this.t * 6) * 2 + this.kickPulse * 2;
      for (let k = 0; k < 3; k++) {
        const bx = hx - 2 - k * 2;
        const by = hy2 + 8 + k + Math.round(billow * (k + 1) * 0.3);
        o.fillStyle = `rgba(176,72,64,${0.5 - k * 0.13})`;
        o.fillRect(bx, by, 2, 3);
      }
      o.fillStyle = "rgba(214,178,94,0.9)"; // clasp glint
      o.fillRect(hx + 1, hy2 + 7, 1, 1);
    }
    // event: star power — a golden radiant aura; the actual ability boost
    // (faster stride, higher jumps) lives in the eggPace and onKick logic
    if (this.egg && this.egg.type === "starpower") {
      const pulse = 0.5 + Math.sin(this.t * 8) * 0.2 + this.kickPulse * 0.3;
      // nested, shrinking rects instead of one flat box — a soft radiant
      // falloff at this pixel scale, matching the lantern glow's trick
      o.fillStyle = `rgba(255,220,120,${0.05 * pulse})`;
      o.fillRect(hx - 4, hy2 - 5, 24, 30);
      o.fillStyle = `rgba(255,225,140,${0.09 * pulse})`;
      o.fillRect(hx - 1, hy2 - 2, 18, 24);
      o.fillStyle = `rgba(255,235,170,${0.14 * pulse})`;
      o.fillRect(hx + 2, hy2 + 1, 12, 18);
      for (let k = 0; k < 4; k++) {
        const ang = this.t * 3 + (k / 4) * TAU;
        const rx = 11 + Math.sin(this.t * 2 + k) * 2;
        o.fillStyle = `rgba(255,245,190,${0.6 * pulse})`;
        o.fillRect(Math.round(hx + 8 + Math.cos(ang) * rx), Math.round(hy2 + 10 + Math.sin(ang) * 6), 1, 1);
      }
    }
    // ambient: at the peak of a song, his cloak catches the energy — a
    // slow, subtle sway (not a fast flutter), never during a costume event.
    // A Castle Approach arrival earns it too, heroic-moment or not.
    const castleArrival =
      this.adventure?.arrival?.phase === "arriving" && this.currentBiome()?.name === "castle-approach";
    if (!this.egg && this.adventure && (this.adventure.mood.state === "peak" || castleArrival)) {
      const sway = Math.sin(this.t * 3.2) * 1.1 + this.kickPulse * 0.9;
      o.fillStyle = `rgba(176,72,64,${0.22 + this.kickPulse * 0.12})`;
      o.fillRect(hx - 2, hy2 + 8 + Math.round(sway * 0.35), 2, 3);
    }

    // lantern glow: stepped blocks, pumping on the kick
    const lg = 0.1 + this.bass.value * 0.06 + this.kickPulse * 0.22 + this.lanternFlash * 0.4;
    o.fillStyle = `rgba(255,200,110,${lg})`;
    o.fillRect(hx + 9, hy2 + 9, 6, 6);
    o.fillStyle = `rgba(255,200,110,${lg * 0.5})`;
    o.fillRect(hx + 7, hy2 + 7, 10, 10);
    // sword flash: a quick golden crescent in front of the hero
    if (this.swordFlash > 0.08) {
      o.fillStyle = `rgba(255,235,170,${this.swordFlash})`;
      o.fillRect(hx + 17, hy2 + 6, 1, 4);
      o.fillRect(hx + 18, hy2 + 10, 1, 5);
      o.fillRect(hx + 17, hy2 + 15, 1, 4);
    }
  }

  drawParticles(o, pal, dt) {
    // ambient biome particles keep a small population
    const wantAmbient = pal.ambient === "snow" ? 14 : 8;
    const ambientCount = this.particles.filter((p) => p.kind === "ambient").length;
    if (ambientCount < wantAmbient && Math.random() < 0.1) {
      const rise = pal.ambient === "spore";
      this.particles.push({
        kind: "ambient",
        x: Math.random() * this.pw,
        y: rise ? this.ph - 14 : -2,
        vx: pal.ambient === "dust" ? -8 - Math.random() * 8 : (Math.random() - 0.5) * 4,
        vy: rise ? -3 - Math.random() * 3 : pal.ambient === "snow" ? 4 + Math.random() * 4 : 6 + Math.random() * 4,
        age: 0, life: 12,
      });
    }
    // fireflies scale with loudness
    const wantFly = Math.round(4 + this.loud.value * 14);
    const flyCount = this.particles.filter((p) => p.kind === "firefly").length;
    if (flyCount < wantFly && Math.random() < 0.15) {
      this.particles.push({
        kind: "firefly",
        x: Math.random() * this.pw,
        y: this.ph - 18 - Math.random() * 26,
        ph: Math.random() * TAU,
        age: 0, life: 6 + Math.random() * 6,
      });
    }

    for (const p of this.particles) {
      p.age += dt;
      if (p.kind === "firefly") {
        p.x += Math.sin(p.ph + this.t * 1.3) * 8 * dt;
        p.y += Math.cos(p.ph * 1.7 + this.t) * 5 * dt;
        // snares startle the fireflies: a bright scattered blink
        const jx = (Math.random() - 0.5) * 3 * this.snarePulse;
        const jy = (Math.random() - 0.5) * 2 * this.snarePulse;
        const blink = 0.3 + 0.7 * clamp01(Math.sin(p.ph + this.t * (2 + this.treble.value * 5)));
        const a = blink * (0.4 + this.treble.value * 0.5 + this.snarePulse * 0.35) * Math.min(1, (p.life - p.age) * 0.8);
        o.fillStyle = this.col(pal.firefly, Math.min(1, a));
        o.fillRect(Math.round(p.x + jx), Math.round(p.y + jy), 1, 1);
        if ((this.treble.value > 0.55 || this.snarePulse > 0.5) && blink > 0.8)
          o.fillRect(Math.round(p.x + jx) - 1, Math.round(p.y + jy), 3, 1);
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind === "ember") p.vy += 6 * dt;
        const fade = clamp01(1 - p.age / p.life);
        if (p.kind === "ember") {
          o.fillStyle = `rgba(255,${140 + Math.round(fade * 80)},60,${fade * 0.9})`;
          o.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
        } else if (p.kind === "dust") {
          o.fillStyle = this.col(pal.groundTop, 0.55 * fade);
          o.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
        } else if (p.kind === "sparkle") {
          o.fillStyle = `rgba(255,245,200,${fade})`;
          o.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
          if (fade > 0.6) {
            o.fillStyle = `rgba(255,245,200,${fade * 0.5})`;
            o.fillRect(Math.round(p.x) - 1, Math.round(p.y), 3, 1);
            o.fillRect(Math.round(p.x), Math.round(p.y) - 1, 1, 3);
          }
        } else {
          o.fillStyle = this.col(pal.ambientCol, 0.7 * fade);
          o.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
        }
        if (p.x < -4 || p.x > this.pw + 4 || p.y > this.ph + 2) p.age = p.life;
      }
    }
    this.particles = this.particles.filter((p) => p.age < p.life);

    // the beat bat: a tiny two-frame silhouette fluttering away
    if (this.bat) {
      const b = this.bat;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.flap += dt * 14;
      // a readable bat at the higher resolution: body, ears, and two-segment
      // flapping wings (11px span) — still a simple dark silhouette
      const up = Math.sin(b.flap) > 0;
      o.fillStyle = "rgba(12,9,18,0.95)";
      const bx = Math.round(b.x), by = Math.round(b.y);
      o.fillRect(bx, by, 2, 2); // body
      o.fillRect(bx, by - 1, 1, 1); // ears
      o.fillRect(bx + 1, by - 1, 1, 1);
      const wy = up ? -1 : 1;
      o.fillRect(bx - 3, by + wy, 3, 1); // inner wings
      o.fillRect(bx + 2, by + wy, 3, 1);
      o.fillRect(bx - 5, by + wy * 2, 2, 1); // outer wing tips
      o.fillRect(bx + 5, by + wy * 2, 2, 1);
      if (b.x > this.pw + 8 || b.y < -8) this.bat = null;
    }
  }

  // ---------------------------------------------------------------- render
  render(ctx, analyser, w, h, now) {
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t = now / 1000;
    this.perf.tick(now);

    // Cinematic opening sequence. While it's playing it draws over the whole
    // viewport and gameplay stays frozen (early return). On its final beat it
    // hands off: gameplay renders underneath and the last plate dissolves out
    // (the overlay call near the end of render). Fails/skips → straight to game.
    const op = this.opening;
    // the intro only kicks off once the mic is actually listening on this
    // visualization — i.e. render is called with a live analyser, not the
    // null-analyser idle path. Not on mode-enter, not at startup.
    if (op && op.state === "idle" && analyser && op.shouldPlay()) op.start();
    let openingHandoff = false;
    if (op && op.active()) {
      op.update(dt, analyser);
      if (op.active()) {
        if (op.wantsGameplayBehind()) openingHandoff = true;
        else { op.render(ctx, w, h, now); return; }
      }
    }

    this.analyze(analyser, dt);

    // low-res canvas matches the display aspect. Height (detail/fidelity) comes
    // from the detail preset unless pixelHeight is forced; assets scale to it.
    const ph = this.cfg.pixelHeight || { pi_safe: 176, standard: 224, showcase: 320 }[this.cfg.detail] || 224;
    const pw = Math.max(200, Math.min(1280, Math.round((ph * w) / h)));
    if (pw !== this.pw || ph !== this.ph) {
      this.pw = pw;
      this.ph = ph;
      this.S = ph / 96; // world scale relative to the original 96px art
      this.assets.artScale = ph / 320; // art is authored at a 320px reference
      this.off.width = pw;
      this.off.height = ph;
    }

    // world motion: a STEADY cruise. With a tempo lock the BPM sets the
    // pace (constant song = constant speed), scaled by a slow section-energy
    // factor with a deadband. No lock falls back to smoothed feel. Kicks add
    // a brief surge. Silence still slews down to a stop.
    const energyT = (this.gate || 0) * (this.driveFx || 0);
    if (Math.abs(energyT - this.energy) > 0.08 || energyT < 0.02)
      this.energy += (energyT - this.energy) * Math.min(1, dt * 0.5);
    let target;
    if (this.tempoStable && this.tempoConf > 0.5 && this.bps > 0) {
      // 60 BPM ambles ~20, 120 jogs ~60, 175+ sprints ~100 (lowres px/s)
      target = Math.pow(this.bps, 1.15) * 30 * (0.65 + this.energy * 0.7) * (this.gate || 0);
    } else {
      target = Math.pow(this.energy, 1.3) * 100 * (this.gate || 0);
    }
    const slew = 30 * dt; // the cruise never lurches
    this.cruise += Math.max(-slew, Math.min(slew, target - this.cruise));
    // glowing red shoes carry him a touch faster; the cool pose is a slow
    // strut; star power is the fastest of all — a real ability boost
    const eggPace =
      this.egg && this.egg.type === "redshoes"
        ? 1.12
        : this.egg && this.egg.type === "coolpose"
          ? 0.45
          : this.egg && this.egg.type === "starpower"
            ? 1.22
            : 1;
    // chapter set pieces AND adventure beats (e.g. the campfire pause) can
    // gently slow or pause the whole world; the adventure mood adds a small
    // steady nudge (energetic/peak a touch faster, breakdown a touch slower)
    const ctlMul =
      (this.heroCtl ? (this.heroCtl.scrollMul ?? 1) : 1) * (this.adventureCtl ? (this.adventureCtl.scrollMul ?? 1) : 1);
    const speed = this.cruise * (1 + this.kickPulse * 0.12) * eggPace * ctlMul * (this.moodPaceMul || 1) * this.S;
    this.lastSpeed = speed;
    this.scrollX += speed * dt;
    // Adventure Layer runs first so its mood/beat state is fresh for this
    // frame's speed calc above and so the one-frame kickHit/snareHit flags
    // are still set when it reads them (the event manager clears them next)
    this.adventure.update(dt);
    if (this.reaction) {
      this.reaction.t += dt;
      if (this.reaction.t >= this.reaction.dur) this.reaction = null;
    }
    // hero showpieces are scheduled by the event manager; here we only
    // advance whichever one is running
    this.events.update(dt);
    if (this.egg) {
      this.egg.t += dt;
      // he faces BACKWARD and glides forward — sliding against his facing,
      // which is the whole trick
      if (this.egg.type === "moonwalk") this.heroOffX = 14 * Math.min(1, this.egg.t / this.egg.dur);
      if (this.egg.t >= this.egg.dur) {
        if (this.egg.type === "spin") {
          this.lanternFlash = 1; // stuck the landing
          this.spawnSparkles();
        }
        this.egg = null;
      }
    }
    // after a moonwalk he eases back to his spot
    if (!this.egg && Math.abs(this.heroOffX) > 0.1) this.heroOffX += (0 - this.heroOffX) * Math.min(1, dt * 3);

    if (speed > 2.5) {
      // stride rate follows the ground speed so his feet never moonwalk
      // (the actual moonwalk steps at half-time — smooth, deliberate)
      // stride cadence rises with speed but is CAPPED so the two walk frames
      // stay readable as distinct steps (uncapped it hit ~17 steps/s at high
      // energy — a blur; the cap keeps it to a legible brisk walk/jog).
      this.heroAnimT +=
        dt *
        Math.min(5.5, 3 + speed * 0.2) *
        (this.egg && this.egg.type === "moonwalk" ? 0.55 : this.egg && this.egg.type === "redshoes" ? 1.6 : 1);
      if (this.heroAnimT > 1) {
        this.heroAnimT = 0;
        // the moonwalk alternates only the two extreme stride poses, in
        // reverse — maximum leg readability
        this.heroFrame =
          this.egg && this.egg.type === "moonwalk" ? (this.heroFrame === 0 ? 2 : 0) : (this.heroFrame + 1) % 4;
        // sprinting kicks dust off his heels on every contact frame
        if (
          this.heroFrame % 2 === 0 &&
          this.cruise > 55 &&
          this.heroJumpY === 0 &&
          this.particles.length < 90
        ) {
          const fx = Math.round(this.pw * this.heroAnchor);
          this.particles.push({
            kind: "dust",
            x: fx - 2 + Math.random() * 3,
            y: this.groundY(fx) - 1,
            vx: -(10 + speed * 0.25),
            vy: -(3 + Math.random() * 5),
            age: 0,
            life: 0.4 + Math.random() * 0.25,
          });
        }
      }
    } else {
      // no music, no march: he stands with his lantern, feet together
      this.heroFrame = 1;
      this.heroAnimT = 0;
    }
    // hero hop physics (low-res pixels)
    if (this.heroJumpY < 0 || this.heroJumpV < 0) {
      this.heroJumpV += 250 * dt;
      this.heroJumpY = Math.min(0, this.heroJumpY + this.heroJumpV * dt);
      if (this.heroJumpY === 0) this.heroJumpV = 0;
    }

    // biome clock — a ~4.5s crossfade (sky/mountains/terrain all blend via
    // rgbPal above), then a mood-weighted pick of where to go next
    this.biomeTimer += dt;
    if (this.biomeT < 1) {
      this.biomeT = Math.min(1, this.biomeT + dt / 4.5);
      if (this.biomeT >= 1) {
        this.biomePrev = this.biomeIdx;
        this.biomeIdx = this.biomeNext;
        this.biomeTimer = 0;
        const b = BIOMES[this.biomeIdx];
        this.biomeDur = this._fastBiomeCycling ? 8 + Math.random() * 6 : b.minDuration + Math.random() * (b.maxDuration - b.minDuration);
        // asset props are laid out per biome (no-op until recipes + art exist)
        this.propField.rebuild(b.name, this.worldLen);
      }
    } else if (this.biomeTimer > this.biomeDur) {
      this.biomeNext = this.pickNextBiomeIndex();
      this.biomeT = 0;
    }

    const pal = this.palette();
    this.palRef = pal;
    const o = this.octx;

    o.save();
    // screen bump: a 1-pixel thump, like an old cartridge impact
    o.translate(0, Math.round(this.bump));
    o.fillStyle = "rgb(4,4,8)";
    o.fillRect(0, -2, pw, ph + 4);
    this.drawSky(o, pal);
    this.adventure.draw(o, pal, "destination"); // far-background silhouette
    this.events.draw(o, pal, "sky");
    this.drawMountains(o, pal);
    this.drawLandmark(o, pal); // biome gateway/landmark (background parallax, behind props+hero)
    this.events.draw(o, pal, "background");
    this.adventure.draw(o, pal, "midground"); // e.g. the note bridge tiles
    this.adventure.draw(o, pal, "encounter-bg"); // encounters behind props/hero (giant, gate, arcade face)
    this.drawProps(o, pal);
    if (this.useAssets()) this.propField.draw(o, "ground"); // asset props (dormant until recipes+art)
    this.drawTerrain(o, pal);
    this.drawFlora(o, pal); // path-edge grass + glowing flowers (fragment sources)
    this.events.draw(o, pal, "ground");
    this.updateDog(o, pal, dt, speed);
    this.drawHero(o, pal);
    this.adventure.draw(o, pal, "encounter-fg"); // encounters in front of hero (guardian, owl, rival)
    this.adventure.drawFragments(o, pal); // Sound Fragments, drifting toward the orb
    this.adventure.drawOrb(o, pal); // orb: updates motion/charge/trail here; BODY draws on the overlay below
    this.drawParticles(o, pal, dt);
    this.events.draw(o, pal, "front");
    // batched additive light pass — richer in showcase, skipped in pi_safe
    if (this.cfg.renderMode === "asset_showcase" && this.cfg.detail !== "pi_safe")
      this.glowQueue.flush(o, this.pixelDisc.bind(this));
    else this.glowQueue.count = 0; // discard requests cleanly in other modes
    this.drawForeground(o, pal); // foreground silhouettes sweep past in front
    this.adventure.drawTransitionEffect(o, pal); // screen effects: biome-swap flourish
    this.drawVignette(o); // soft cinematic frame, cached
    o.restore();

    // nearest-neighbor upscale keeps the pixels crisp
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, 0, pw, ph, 0, 0, w, h);
    ctx.restore();

    // The orb companion draws on the REAL (unscaled) canvas — so it moves with
    // sub-pixel smoothness and a soft anti-aliased glow instead of snapping on
    // the low-res grid. Position is scaled from buffer space to display space.
    this.adventure.drawOrbOverlay(ctx, w / pw, h / ph);

    // opening-sequence handoff: dissolve the final intro plate out over the now-
    // live gameplay (drawn above) for a seamless transition into the adventure
    if (openingHandoff) op.renderHandoff(ctx, w, h);

    // Story Engine: cinematic text cards + optional debug readout, drawn on
    // the real (unscaled) canvas so the film-title text stays crisp
    this.adventure.story.drawCard(ctx, w, h);
    this.adventure.story.drawDebug(ctx, w, h);

    if (this.cfg.debugLabel) {
      const c = this.cruise;
      const gait = c < 4 ? "standing" : c < 14 ? "amble" : c < 28 ? "walk" : c < 45 ? "jog" : c < 62 ? "run" : "sprint";
      const bpmInfo =
        this.tempoStable && this.tempoConf > 0.5 && this.bps > 0 ? ` · ${Math.round(this.bps * 60)} BPM` : "";
      const ch = this.events.chapter;
      const chInfo = ch ? ` · ⚔${ch.def.id}/${ch.data.phase}` : "";
      const evIds = this.events.activeIds();
      const eggInfo = evIds.length ? ` · ✨${evIds.join("+")}` : this.egg ? ` · ${this.egg.type}!` : "";
      const hits = `${this.kickPulse > 0.45 ? " ·KICK" : ""}${this.snarePulse > 0.45 ? " ·snare" : ""}`;
      const beatInfo = this.adventure.noteBridge
        ? " ·bridge"
        : this.adventure.campfirePause
          ? " ·campfire"
          : "";
      const label = `PixelQuest: ${gait} · ${Math.round(this.lastSpeed)} px/s${bpmInfo} · mood:${this.adventure.mood.state}${chInfo}${eggInfo}${beatInfo}${hits}`;
      ctx.save();
      ctx.font = "11px monospace";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.fillText(label, 8, h - 6);
      ctx.restore();
    }

    // performance/debug metrics (dev only — pq.cfg.perfDebug), top-right
    if (this.cfg.perfDebug) {
      const frags = this.adventure.fragments.items.length;
      const lines = [
        `${Math.round(this.perf.fps)} fps · ${this.perf.frameMs.toFixed(1)} ms`,
        `particles ${this.particles.length} · frags ${frags} · props ${this.propField.props.length}`,
        `glows ${this.glowQueue.count} · detail ${this.cfg.detail} · ${this.cfg.renderMode}`,
        `parallax ${(PARALLAX_MANIFEST[this.palRef?.biome] || []).length} layers`,
      ];
      ctx.save();
      ctx.font = "11px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(w - 262, 6, 256, lines.length * 14 + 8);
      ctx.fillStyle = "rgba(180,255,220,0.9)";
      lines.forEach((l, i) => ctx.fillText(l, w - 12, 12 + i * 14));
      ctx.restore();
    }

    // GRAPHICS STATUS panel (dev only — pq.cfg.assetDebug). Colour-coded table
    // of every subject: GREEN = drawn from an imported IMAGE · AMBER = baked
    // placeholder · RED = still rendered the OLD (procedural) way. Toggle with
    // pqAdventure.toggleAssetDebug().
    if (this.cfg.assetDebug) {
      const sum = this.assets.summary();
      const biome = this.palRef?.biome;
      // only show the ACTIVE biome's plates (plus every sprite) so the table
      // reflects what's actually on screen right now
      const plates = sum.plates.filter((p) => !biome || p.id.startsWith(biome + "/"));
      const rows = [{ hdr: "SPRITES" }, ...sum.sprites, { hdr: `SCENERY · ${biome || "?"}` }, ...plates];
      const G = "rgba(90,230,120,1)", A = "rgba(255,200,90,1)", R = "rgba(255,90,90,1)";
      const colOf = (s) => (s === "external" ? G : s === "baked" ? A : R);
      const wordOf = (s) => (s === "external" ? "IMAGE" : s === "baked" ? "baked" : "OLD");
      ctx.save();
      ctx.font = "11px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const lh = 13, x = 8, top = 8, W = 224;
      const bh = (rows.length + 3) * lh + 14;
      ctx.fillStyle = "rgba(6,8,14,0.82)";
      ctx.fillRect(x, top, W, bh);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.strokeRect(x + 0.5, top + 0.5, W, bh);
      let y = top + 6;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText("PIXELQUEST GRAPHICS", x + 8, y); y += lh;
      // legend
      ctx.fillStyle = G; ctx.fillText("■", x + 8, y); ctx.fillStyle = "rgba(220,220,220,0.9)"; ctx.fillText("image", x + 20, y);
      ctx.fillStyle = A; ctx.fillText("■", x + 74, y); ctx.fillStyle = "rgba(220,220,220,0.9)"; ctx.fillText("baked", x + 86, y);
      ctx.fillStyle = R; ctx.fillText("■", x + 140, y); ctx.fillStyle = "rgba(220,220,220,0.9)"; ctx.fillText("old", x + 152, y);
      y += lh + 2;
      for (const r of rows) {
        if (r.hdr) { ctx.fillStyle = "rgba(150,190,255,0.9)"; ctx.fillText(`— ${r.hdr} —`, x + 8, y); y += lh; continue; }
        const pdef = (r.id || "").includes("/") ? this.assets.parallax[r.id]?.def : null;
        const name = pdef ? (pdef.backdrop ? "backdrop" : pdef.layer) : (r.id || "");
        ctx.fillStyle = "rgba(210,210,210,0.92)"; ctx.fillText(name, x + 16, y);
        ctx.fillStyle = colOf(r.source);
        ctx.fillText("●", x + 8, y);
        ctx.textAlign = "right"; ctx.fillText(wordOf(r.source), x + W - 8, y); ctx.textAlign = "left";
        y += lh;
      }
      ctx.restore();
    }

    // full-screen DEBUG APP (toggled by the D key) — a readable dashboard of
    // what's real art vs placeholder, performance, and live world state.
    if (this.cfg.debugScreen) this.drawDebugScreen(ctx, w, h);
  }

  toggleDebugScreen() {
    this.cfg.debugScreen = !this.cfg.debugScreen;
    if (this.cfg.debugScreen) this.debugPage = 0; // always open on the main page
    // the DOM idle-hint / controls panels sit above the canvas — hide them
    // while the debug screen is up so it reads cleanly
    if (typeof document !== "undefined") {
      if (!this._dbgStyle) {
        this._dbgStyle = document.createElement("style");
        this._dbgStyle.textContent = "body.pq-debug #hint, body.pq-debug #controls { display: none !important; }";
        document.head.appendChild(this._dbgStyle);
      }
      document.body.classList.toggle("pq-debug", this.cfg.debugScreen);
    }
    return this.cfg.debugScreen;
  }

  // debug-screen paging (← / → while the D screen is up): 0 = overview, 1 = cameo/easter-egg asset status
  debugScreenOpen() { return !!this.cfg.debugScreen; }
  cycleDebugPage(dir) {
    const N = 2;
    this.debugPage = ((((this.debugPage || 0) + dir) % N) + N) % N;
    return this.debugPage;
  }

  drawDebugScreen(ctx, w, h) {
    if ((this.debugPage || 0) === 1) { this.drawDebugEggs(ctx, w, h); return; }
    const sum = this.assets.summary();
    const a = this.adventure, orb = a?.orb, mood = a?.mood;
    const G = "rgba(90,230,120,1)", A = "rgba(255,200,90,1)", R = "rgba(255,90,90,1)";
    const col = (s) => (s === "external" ? G : s === "baked" ? A : R);
    const word = (s) => (s === "external" ? "image" : s === "baked" ? "baked" : "OLD");
    ctx.save();
    ctx.fillStyle = "rgba(6,9,16,0.95)";
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.font = "bold 16px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fillText("PIXEL QUEST — DEBUG", 20, 16);
    ctx.font = "12px monospace";
    ctx.fillStyle = G; ctx.fillText("● textured", 230, 20);
    ctx.fillStyle = A; ctx.fillText("● baked", 330, 20);
    ctx.fillStyle = R; ctx.fillText("● procedural (needs art)", 415, 20);
    ctx.fillStyle = "rgba(150,160,185,0.9)"; ctx.textAlign = "right"; ctx.fillText("page 1/2  ← →  ·  D close", w - 18, 20); ctx.textAlign = "left";
    ctx.font = "12.5px monospace";
    const lh = 16, top = 48;

    const rowAt = (x, y, sc, name, statusWord, nameColor) => {
      ctx.fillStyle = sc; ctx.fillText("●", x, y);
      ctx.fillStyle = nameColor || "rgba(214,214,222,0.92)"; ctx.fillText(name, x + 15, y);
      ctx.textAlign = "right"; ctx.fillStyle = sc; ctx.fillText(statusWord, x + 218, y); ctx.textAlign = "left";
    };
    const secHdr = (x, y, t) => { ctx.fillStyle = "rgba(200,210,225,0.9)"; ctx.fillText(t, x, y); };
    const colHdr = (x, y, t) => { ctx.font = "bold 13px monospace"; ctx.fillStyle = "rgba(150,190,255,0.95)"; ctx.fillText(t, x, y); ctx.font = "12.5px monospace"; };

    // ---- COL A: textured assets ----
    const xA = 20; let yA = top;
    colHdr(xA, yA, "TEXTURED ASSETS"); yA += lh + 4;
    secHdr(xA, yA, "SPRITES & PROPS"); yA += lh;
    for (const s of sum.sprites) { rowAt(xA, yA, col(s.source), s.id, word(s.source)); yA += lh; }
    yA += 6; secHdr(xA, yA, "SCENERY (per biome)"); yA += lh;
    for (const b of this.allBiomeIds()) {
      const img = this.assets.hasBackdrop(b) || this.assets.hasReadyLayer(b, "sky") || this.assets.hasReadyLayer(b, "far");
      const active = b === this.palRef?.biome;
      rowAt(xA, yA, img ? G : R, b + (active ? " ◄" : ""), img ? "image" : "OLD", active ? "rgba(255,255,170,0.95)" : null); yA += lh;
    }

    // ---- COL B: procedural (not yet textured) ----
    const PROC = [
      { h: "BIOME SCENERY" }, "path grass & flowers", "foreground silhouettes",
      { h: "LANDMARKS" }, "shrine (meadow)", "mushroom (neon)", "clock tower (moonlit)", "arcade gate (arcade)", "castle (castle)",
      { h: "ATTRACTIONS" }, "windmill", "campfire + brazier", "arcade cabinet", "snail",
      { h: "SKY & FX" }, "stars · moon · clouds", "fireflies", "dust & sparkles", "torch flames",
    ];
    const xB = Math.round(w * 0.34); let yB = top;
    colHdr(xB, yB, "PROCEDURAL  (no art yet)"); yB += lh + 4;
    for (const p of PROC) {
      if (p.h) { secHdr(xB, yB, p.h); yB += lh; continue; }
      rowAt(xB, yB, R, p, "OLD"); yB += lh;
    }
    yB += 6; secHdr(xB, yB, "CAMEOS / EASTER EGGS"); yB += lh;
    const nEv = this.events?.defs?.length || 63;
    rowAt(xB, yB, R, `${nEv} events`, "OLD"); yB += lh;
    ctx.fillStyle = "rgba(150,190,255,0.95)"; ctx.fillText("→ press → for per-event status", xB + 15, yB); yB += lh;
    ctx.fillStyle = "rgba(150,160,182,0.8)"; ctx.fillText("moon flybys, dragon, giant,", xB + 15, yB); yB += lh - 3;
    ctx.fillText("jukebox, boulder chase, …", xB + 15, yB);

    // ---- COL C: performance / state / keys ----
    const xC = Math.round(w * 0.67); let yC = top;
    const hdr = (t) => { colHdr(xC, yC, t); yC += lh + 4; };
    const kv = (k, v, c) => { ctx.fillStyle = "rgba(150,160,182,0.9)"; ctx.fillText(k, xC, yC); ctx.fillStyle = c || "rgba(232,232,238,0.95)"; ctx.fillText(v, xC + 118, yC); yC += lh; };
    hdr("PERFORMANCE");
    const fps = Math.round(this.perf.fps);
    kv("fps", `${fps}`, fps >= 55 ? G : fps >= 30 ? A : R);
    kv("frame ms", `${this.perf.frameMs.toFixed(1)}`);
    kv("resolution", `${this.pw}×${this.ph} (${(this.assets.artScale || 1).toFixed(2)}×)`);
    kv("detail", `${this.cfg.detail}`);
    yC += 6; hdr("WORLD STATE");
    kv("biome", `${this.palRef?.biome || "?"}`);
    kv("mood", `${mood?.state || "?"} ${(mood?.energy || 0).toFixed(2)}`);
    const chg = orb?.charge ?? 0;
    kv("orb", `${chg < 0.15 ? "dim" : chg < 0.55 ? "awake" : chg < 0.9 ? "charged" : "radiant"} ${chg.toFixed(2)}`);
    kv("hero", `f${this.heroFrame} ${Math.round(this.lastSpeed || 0)}px/s`);
    kv("counts", `p${this.particles.length} f${a?.fragments?.items.length || 0} pr${this.propField.props.length}`);
    kv("assets", `${sum.external} img · ${sum.procedural} old`);
    yC += 6; hdr("KEYS");
    ctx.fillStyle = "rgba(195,200,215,0.9)";
    for (const l of ["D  close", "← →  page", "B / ⇧B  biome", "1–5  jump biome", "J  arrival", "H  controls"]) { ctx.fillText(l, xC, yC); yC += lh; }

    ctx.restore();
  }

  // Debug page 2 — per-event asset status for every cameo / easter egg.
  // An event is "image" once its def names an `asset` sprite that is loaded,
  // "missing" if it names one that failed to load, else "procedural".
  drawDebugEggs(ctx, w, h) {
    const G = "rgba(90,230,120,1)", A = "rgba(255,200,90,1)", R = "rgba(255,90,90,1)";
    const defs = (this.events && this.events.defs) || [];
    const stateOf = (d) => (d.asset && this.assets.ready(d.asset)) ? "img" : (d.asset ? "miss" : "proc");
    const colOf = (s) => (s === "img" ? G : s === "miss" ? A : R);
    const wordOf = (s) => (s === "img" ? "image" : s === "miss" ? "missing" : "proc");

    ctx.save();
    ctx.fillStyle = "rgba(6,9,16,0.96)"; ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.font = "bold 16px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fillText("EASTER EGGS — ASSET STATUS", 20, 16);
    const nImg = defs.filter((d) => stateOf(d) === "img").length;
    const nMiss = defs.filter((d) => stateOf(d) === "miss").length;
    const nProc = defs.length - nImg - nMiss;
    ctx.font = "12px monospace";
    ctx.fillStyle = G; ctx.fillText(`● ${nImg} image`, 300, 20);
    ctx.fillStyle = A; ctx.fillText(`● ${nMiss} missing`, 392, 20);
    ctx.fillStyle = R; ctx.fillText(`● ${nProc} procedural`, 500, 20);
    ctx.fillStyle = "rgba(150,160,185,0.9)"; ctx.textAlign = "right";
    ctx.fillText("page 2/2  ← →  ·  D close", w - 18, 20); ctx.textAlign = "left";

    // group events by category, then flow the grouped list into columns
    const order = ["hero", "sky", "background", "ground", "prop", "weather", "obstacle", "battle", "landmark", "transition"];
    const byCat = new Map();
    for (const d of defs) { if (!byCat.has(d.category)) byCat.set(d.category, []); byCat.get(d.category).push(d); }
    const cats = [...order.filter((c) => byCat.has(c)), ...[...byCat.keys()].filter((c) => !order.includes(c))];
    const items = [];
    for (const c of cats) { items.push({ hdr: `${c.toUpperCase()} (${byCat.get(c).length})` }); for (const d of byCat.get(c)) items.push({ def: d }); }

    const top = 48, lh = 15, botM = 18;
    const rowsPerCol = Math.max(6, Math.floor((h - top - botM) / lh));
    const numCols = Math.max(1, Math.ceil(items.length / rowsPerCol));
    const colW = Math.min(250, (w - 36) / numCols);
    const nameChars = Math.max(8, Math.floor((colW - 66) / 7.1));

    ctx.font = "12px monospace";
    for (let i = 0; i < items.length; i++) {
      const col = Math.floor(i / rowsPerCol), row = i % rowsPerCol;
      const x = 20 + col * colW, y = top + row * lh;
      const it = items[i];
      if (it.hdr) {
        ctx.font = "bold 11px monospace"; ctx.fillStyle = "rgba(150,190,255,0.95)";
        ctx.fillText(it.hdr, x, y); ctx.font = "12px monospace";
        continue;
      }
      const d = it.def, s = stateOf(d), c = colOf(s);
      ctx.fillStyle = c; ctx.fillText("●", x, y);
      let nm = d.name || d.id;
      if (nm.length > nameChars) nm = nm.slice(0, nameChars - 1) + "…";
      ctx.fillStyle = s === "proc" ? "rgba(190,190,200,0.8)" : "rgba(222,222,230,0.96)";
      ctx.fillText(nm, x + 13, y);
      ctx.textAlign = "right"; ctx.fillStyle = c;
      ctx.fillText(wordOf(s), x + colW - 10, y); ctx.textAlign = "left";
    }
    ctx.restore();
  }
}
