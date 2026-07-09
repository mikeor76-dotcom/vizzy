// Event Horizon — a cinematic lensed black hole (think Gargantua), live and
// audio-reactive.
//
// Composition: the hole is HUGE and sits off-center; the accretion disk is
// seen nearly edge-on, a thick luminous plasma band sweeping diagonally
// across the whole frame and crossing in front of the hole's lower half.
// Gravitational lensing wraps the far side of the disk into a bright arc
// over the top of the horizon, with a dimmer return arc below. The horizon
// itself stays perfectly black with only a thin photon rim.
//
// Construction:
//   - the disk is a baked procedural PLASMA STRIP (white-hot inner edge ->
//     amber -> rust, angular-smeared streaks) mapped in radial slices with a
//     near-flat tilt, Keplerian scroll, Doppler beaming, and a detail layer
//     the mids reveal
//   - the lensed arcs reuse the same texture wrapped on the horizon circle,
//     thickness and brightness biased to the top (main arc) and bottom
//     (return arc)
//   - background: near-black space, sparse lensing-deflected stars, faint
//     warm haze along the disk plane — no busy image wallpaper
//   - an image-space warp bends everything behind the hole
//
// Palette: deep black, amber, gold, orange-white, white-hot; blue-white only
// in rare high-energy accents. Decorative rings/spokes/HUD arcs are gated
// behind flags and OFF by default.

const TAU = Math.PI * 2;

export const BLACKHOLE_DEFAULTS = {
  gravityStrength: 1,
  diskBrightness: 1,
  diskTurbulence: 1,
  lensingIntensity: 1,
  particleDensity: 1,
  jetFrequency: 1,
  bassReactivity: 1,
  trebleSparkle: 1,
  signalHorizonIntensity: 1,
  sensitivity: 1.25, // master music-response gain (post auto-gain)
  // composition: the hole dominates the frame, disk sweeps diagonally
  holeX: 0.58,
  holeY: 0.46,
  diskRoll: -0.09, // radians: slight diagonal sweep of the disk plane
  // decorative/graphic elements are OFF: this is an astrophysical object,
  // not an icon (kept as flags so they can be re-enabled deliberately)
  showDecorativeArcs: false, // star smear arc strokes
  showHudRings: false, // bass ripple rings
  showRadialBursts: false,
  showGraphicSpokes: false,
  assetBase: "/assets/galaxy/",
  usePlates: false, // false = the procedural plasma-disk renderer (preferred);
  // true = curated black-hole image plates as the base visual
  debugLabel: true, // dev: show current renderer / plate state
  quality: "auto",
  lowRes: "auto",
};

const AMBER = "255, 190, 96";
const GOLDWHITE = "255, 224, 180";
const HOTWHITE = "255, 244, 228";
const BLUE = "150, 205, 255";
const RUST = "205, 110, 45";
const VIOLET = "120, 90, 170";

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

class Smoother {
  constructor(attack, decay) {
    this.attack = attack;
    this.decay = decay;
    this.value = 0;
  }
  update(target) {
    const k = target > this.value ? this.attack : this.decay;
    this.value += (target - this.value) * k;
    return this.value;
  }
}

class BeatDetector {
  constructor(sensitivity, floor = 0.12) {
    this.history = new Float32Array(45);
    this.idx = 0;
    this.filled = 0;
    this.cooldown = 0;
    this.floor = floor;
    this.ratio = 1.45 - 0.25 * sensitivity;
  }
  update(value, dt) {
    this.cooldown -= dt;
    let sum = 0;
    for (let i = 0; i < this.filled; i++) sum += this.history[i];
    const avg = this.filled ? sum / this.filled : 0;
    this.history[this.idx] = value;
    this.idx = (this.idx + 1) % this.history.length;
    if (this.filled < this.history.length) this.filled++;
    if (this.cooldown <= 0 && this.filled > 10 && value > this.floor && value > avg * this.ratio) {
      this.cooldown = 0.16;
      return true;
    }
    return false;
  }
}

function makePRNG(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function fbm(w, h, rnd, octaves) {
  const out = new Float32Array(w * h);
  let total = 0;
  for (const [, weight] of octaves) total += weight;
  for (const [cells, weight] of octaves) {
    const gw = cells;
    const gh = Math.max(2, Math.round((cells * h) / w) + 1);
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    for (let y = 0; y < h; y++) {
      const gy = (y / h) * (gh - 1);
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      for (let x = 0; x < w; x++) {
        const gx = (x / w) * gw;
        const x0 = Math.floor(gx) % gw;
        const x1 = (x0 + 1) % gw;
        const fx = gx - Math.floor(gx);
        const a = grid[y0 * gw + x0];
        const b = grid[y0 * gw + x1];
        const c = grid[(y0 + 1) * gw + x0];
        const d = grid[(y0 + 1) * gw + x1];
        out[y * w + x] += (a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy) * (weight / total);
      }
    }
  }
  return out;
}

// generate the glowing plasma strip: x = angular (tileable), y = radial
// (0 = inner white-hot edge), then transpose so slices can be drawn radially
function makePlasmaStrip(seed, angular, radial, detailLayer) {
  const rnd = makePRNG(seed);
  const src = document.createElement("canvas");
  src.width = angular;
  src.height = radial;
  const ctx = src.getContext("2d");
  const img = ctx.createImageData(angular, radial);
  const d = img.data;
  let n = detailLayer
    ? fbm(angular, radial, rnd, [[60, 0.5], [140, 0.5]])
    : fbm(angular, radial, rnd, [[5, 0.3], [16, 0.4], [48, 0.3]]);
  {
    // smear the noise along the angular axis so structure flows WITH the
    // rotation — long coherent streams, never chips or radial spokes. The
    // detail layer gets a shorter smear: fine streamlets, still directional.
    const sm = new Float32Array(n.length);
    const taps = detailLayer ? 10 : 18;
    for (let y = 0; y < radial; y++) {
      for (let x = 0; x < angular; x++) {
        let s = 0;
        for (let k = -taps; k <= taps; k++) s += n[y * angular + ((x + k + angular) % angular)];
        sm[y * angular + x] = s / (taps * 2 + 1);
      }
    }
    n = sm;
  }
  const q = fbm(angular, radial, makePRNG(seed + 9), [[9, 0.6], [30, 0.4]]);
  for (let y = 0; y < radial; y++) {
    const rad = y / radial;
    // sharp luminous inner edge, long soft outer falloff
    const env = Math.pow(1 - rad, 1.15) * clamp01(rad * 16);
    for (let x = 0; x < angular; x++) {
      const i = (y * angular + x) * 4;
      const v = n[y * angular + x];
      let alpha, r, g, b;
      if (detailLayer) {
        // contrast-stretch the smeared noise back into bright streamlets
        alpha = Math.pow(clamp01((v - 0.34) * 2.6), 1.8) * env * 0.9;
        r = 255;
        g = 236;
        b = 205;
      } else {
        const streak = 0.35 + 0.65 * clamp01((v - 0.32) * 2.4); // contrasty flow streams
        // ring banding fades outward: stretched outer rows otherwise develop
        // wavy wood-grain contours on ultrawide displays
        const bandLayers = 0.66 + 0.34 * Math.sin(rad * 21 + v * 9) * (1 - rad * 0.65);
        alpha = clamp01(env * streak * bandLayers * 1.7);
        // thin white-hot inner rim, a broad amber-gold body, rust outskirts
        const heat = clamp01(1.05 - rad * 2.4);
        r = lerp(215, 255, heat);
        g = lerp(118, 238, heat);
        b = lerp(46, 214, heat);
        const qq = q[y * angular + x];
        if (qq > 0.8 && rad > 0.22) {
          const k = ((qq - 0.8) / 0.2) * 0.45; // restrained blue-violet plasma
          r = lerp(r, 150, k);
          g = lerp(g, 170, k);
          b = lerp(b, 255, k);
        }
      }
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = alpha * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // transpose: radial becomes x, angular becomes y (tileable vertically)
  const t = document.createElement("canvas");
  t.width = radial;
  t.height = angular;
  const tc = t.getContext("2d");
  tc.translate(0, angular);
  tc.rotate(-Math.PI / 2);
  tc.drawImage(src, 0, 0);
  return t;
}

export class BlackHole {
  constructor(opts = {}) {
    this.cfg = { ...BLACKHOLE_DEFAULTS, ...opts };
    this.freq = new Uint8Array(1024);
    this.time = new Uint8Array(2048);
    this.bass = new Smoother(0.55, 0.08);
    this.mid = new Smoother(0.4, 0.06);
    this.treble = new Smoother(0.5, 0.1);
    this.loud = new Smoother(0.35, 0.05);
    this.loudSlow = new Smoother(0.03, 0.03);
    this.beat = new BeatDetector(1);
    this.flash = 0;
    this.dyn = 0;
    this.rot = 0; // disk texture rotation phase
    this.rot2 = 0; // detail layer, different speed = differential swirl
    this.lastNow = 0;
    this.frameAvg = 16.7;
    this.autoQuality = 1;
    this.w = 0;
    this.h = 0;
    this.jetEnv = 0;
    this.jetCooldown = 6;
    this.jetTilt = 0;
    this.flareAng = 0;
    this.flareEnv = 0;
    this.shake = 0;
    this.ripples = Array.from({ length: 4 }, () => ({ active: false, r: 0 }));
    this.glints = Array.from({ length: 6 }, () => ({ active: false }));
    // curated black-hole plates are the PRIMARY visual; the procedural
    // renderer is only a logged fallback
    this.plates = [];
    this.platesChecked = false;
    this.plateIdx = 0;
    this.plateT = 0;
    this.plateFade = 0;
    this.plateNext = null;
    this.loadBackdrop();
  }

  quality() {
    return this.cfg.quality === "auto" ? this.autoQuality : this.cfg.quality;
  }

  async loadBackdrop() {
    const base = this.cfg.assetBase;
    // manifest-driven plates, with loud per-asset diagnostics
    let manifest = null;
    try {
      const res = await fetch(base + "manifest.json");
      if (res.ok) manifest = await res.json();
    } catch {
      /* none */
    }
    if (!this.cfg.usePlates) {
      this.platesChecked = true;
      console.log("[eventhorizon] procedural plasma renderer active (usePlates: false)");
      // skip fetching plates entirely; flip usePlates to true to use artwork
      const entriesSkipped = (manifest && manifest.eventHorizon) || [];
      if (entriesSkipped.length) console.log(`[eventhorizon] ${entriesSkipped.length} plates available in manifest (unused)`);
      return;
    }
    const entries = (manifest && manifest.eventHorizon) || [];
    let pending = entries.length;
    const done = () => {
      if (--pending <= 0) {
        this.platesChecked = true;
        console.log(`[eventhorizon-assets] total plates loaded: ${this.plates.length}`);
        if (!this.plates.length)
          console.warn("[eventhorizon-assets] no plates loaded — FALLBACK MODE: procedural renderer");
      }
    };
    if (!entries.length) {
      this.platesChecked = true;
      console.warn("[eventhorizon-assets] manifest has no eventHorizon entries — FALLBACK MODE: procedural renderer");
    }
    for (const entry of entries) {
      const img = new Image();
      img.onload = () => {
        this.plates.push({ img, meta: entry });
        console.log(`[eventhorizon-assets] loaded: ${entry.path}`);
        done();
      };
      img.onerror = () => {
        console.warn(`[eventhorizon-assets] MISSING: ${entry.path} — check manifest paths`);
        done();
      };
      img.src = entry.path;
    }
  }

  rebuild(ctx, w, h) {
    this.w = w;
    this.h = h;
    const dim = Math.min(w, h);
    this.dim = dim;
    this.lowRes = this.cfg.lowRes === "auto" ? dim < 240 : !!this.cfg.lowRes;
    this.lineScale = this.lowRes ? 2 : 1;
    // a HUGE hole: it should dominate the frame, cropped is fine
    this.Rh = Math.min(h * 0.4, w * 0.2);
    // near edge-on disk: thick where it crosses the hole, thin at the edges
    this.tilt = 0.085;
    // the band must sweep past the frame edges even when rolled
    this.bandOut = Math.max(w * 0.85, this.Rh * 3.2);
    this.beamAng = Math.PI; // left side approaches: white-hot Doppler boost
    this.segs = this.lowRes ? 44 : 96;

    const seed = (Math.random() * 1e9) | 0;
    const ang = this.lowRes ? 512 : 1024;
    const rad = this.lowRes ? 80 : 150;
    this.strip = makePlasmaStrip(seed, ang, rad, false);
    this.stripDetail = makePlasmaStrip(seed + 3, ang, rad, true);
    // horizontal-orientation copies for the edge-on band: x = angular flow,
    // y = radial with the white-hot inner edge at the top
    const mkH = (src) => {
      const c = document.createElement("canvas");
      c.width = src.height;
      c.height = src.width;
      const g = c.getContext("2d");
      g.translate(src.height, 0);
      g.rotate(Math.PI / 2);
      g.drawImage(src, 0, 0);
      return c;
    };
    this.stripH = mkH(this.strip);
    this.stripDetailH = mkH(this.stripDetail);

    // plasma sparks riding the disk (texture carries the body; these accent)
    const detail = this.lowRes ? 0.4 : 1;
    const count = Math.round(240 * detail * this.cfg.particleDensity);
    this.sparks = [];
    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const r = 1.3 + Math.pow(u, 1.6) * 2.2; // stay inside the disk body
      this.sparks.push({
        r,
        a: Math.random() * TAU,
        w0: (0.55 / Math.pow(r, 1.5)) * (0.85 + Math.random() * 0.3),
        phase: Math.random() * TAU,
        tSpeed: 0.5 + Math.random() * 1.6,
        blue: Math.random() < 0.05,
        size: 0.8 + Math.random() * 1.2,
        z: (Math.random() - 0.5) * (Math.random() - 0.5) * 4,
      });
    }
    this.infall = Array.from({ length: Math.round(70 * detail) }, () => ({
      r: 1.4 + Math.random() * 3.6,
      a: Math.random() * TAU,
    }));
    // sparks that orbit the plate's disk in plate mode (treble-driven)
    this.orbitSparks = Array.from({ length: 40 }, () => ({
      a: Math.random() * TAU,
      rMul: 1.15 + Math.random() * 1.6,
      sp: 0.2 + Math.random() * 0.5,
      al: 0.3 + Math.random() * 0.7,
    }));
    // sparse stars: the background supports the hole, it doesn't compete
    const starCount = Math.round(130 * detail * Math.max(1, (w / h) * 0.5));
    this.stars = [];
    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        drift: 1.2 + Math.random() * 3,
        size: 0.5 + Math.random() * 1.1,
        tw: Math.random() * TAU,
        twSp: 0.4 + Math.random() * 1.6,
        warm: Math.random() < 0.2,
      });
    }

    const unit = (stops) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      for (const [p, c] of stops) g.addColorStop(p, c);
      return g;
    };
    this.gradGlow = unit([[0, `rgba(${GOLDWHITE}, 0.9)`], [0.35, `rgba(${AMBER}, 0.35)`], [1, `rgba(${AMBER}, 0)`]]);
    this.gradGlint = unit([[0, `rgba(${HOTWHITE}, 1)`], [0.3, `rgba(${GOLDWHITE}, 0.8)`], [1, `rgba(${AMBER}, 0)`]]);
    this.vignette = unit([[0.55, "rgba(0, 0, 0, 0)"], [1, "rgba(1, 1, 3, 0.42)"]]);

    const tile = document.createElement("canvas");
    tile.width = tile.height = 160;
    const tc = tile.getContext("2d");
    const img = tc.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 100 + Math.random() * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 14;
    }
    tc.putImageData(img, 0, 0);
    this.grain = ctx.createPattern(tile, "repeat");
  }

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
    // adaptive gain: normalize against a slow-decaying loudness peak so a
    // quiet mic drives the same visual range as loud audio
    const rawLoud0 = band(1, 372);
    this.peak = Math.max((this.peak || 0.3) * (1 - dt * 0.04), rawLoud0, 0.06);
    const gain = Math.min(4, 0.55 / this.peak) * this.cfg.sensitivity;
    const rawBass = Math.min(1, band(1, 11) * gain);
    this.bass.update(rawBass);
    this.mid.update(Math.min(1, band(11, 92) * gain));
    this.treble.update(Math.min(1, band(92, 372) * 1.6 * gain));
    this.loud.update(Math.min(1, rawLoud0 * gain));
    this.loudSlow.update(this.loud.value);
    this.dyn = lerp(this.dyn, Math.abs(this.loud.value - this.loudSlow.value) * 4, Math.min(1, dt * 3));

    if (analyser && this.beat.update(rawBass, dt)) {
      this.flash = 1;
      // the pulse is born near the hot Doppler side and travels along the disk
      this.flareAng = this.beamAng + (Math.random() - 0.5) * 1.2;
      this.flareEnv = 1;
      this.spawnGlint();
      if (rawBass > 0.55) {
        this.shake = 1.5; // a pressure nudge, not camera shake
        if (this.cfg.showHudRings) this.spawnRipple();
      }
      if (rawBass > 0.7 && this.jetCooldown <= 4 && Math.random() < 0.35) this.fireJet();
    }
    this.jetCooldown -= dt * this.cfg.jetFrequency;
    if (analyser && this.jetCooldown <= 0 && this.treble.value > 0.55 && this.loud.value > 0.35) this.fireJet();
    this.flash *= Math.exp(-dt * 5);
    this.flareEnv *= Math.exp(-dt * 2.2);
    this.jetEnv *= Math.exp(-dt * 0.8);
    this.shake *= Math.exp(-dt * 5);
  }

  fireJet() {
    this.jetEnv = 1;
    this.jetTilt = (Math.random() - 0.5) * 0.16;
    this.jetCooldown = 9 + Math.random() * 14;
  }

  spawnRipple() {
    for (const rp of this.ripples) {
      if (!rp.active) {
        rp.active = true;
        rp.r = 1.3;
        return;
      }
    }
  }

  spawnGlint() {
    for (const g of this.glints) {
      if (!g.active) {
        g.active = true;
        g.x = Math.random() * this.w;
        g.v = (Math.random() < 0.5 ? -1 : 1) * this.w * (0.25 + Math.random() * 0.3);
        g.life = 1;
        return;
      }
    }
  }

  render(ctx, analyser, w, h, now) {
    if (w !== this.w || h !== this.h) this.rebuild(ctx, w, h);
    const rawMs = this.lastNow ? now - this.lastNow : 16.7;
    const dt = Math.min(Math.max(rawMs, 0) / 1000, 0.05);
    this.lastNow = now;
    const t = now / 1000;

    if (rawMs > 0 && rawMs < 500 && this.cfg.quality === "auto") {
      this.frameAvg += (rawMs - this.frameAvg) * 0.04;
      if (this.frameAvg > 26 && this.autoQuality > 0.35) this.autoQuality -= 0.02;
      else if (this.frameAvg < 19 && this.autoQuality < 1) this.autoQuality = Math.min(1, this.autoQuality + 0.004);
    }

    this.analyze(analyser, dt);
    // plate mode is opt-in (cfg.usePlates); the procedural plasma renderer
    // is the signature look
    if (this.cfg.usePlates && this.plates.length) {
      this.renderPlateMode(ctx, w, h, t, dt);
      return;
    }
    const cfg = this.cfg;
    const bass = this.bass.value * cfg.bassReactivity;
    const loud = this.loud.value;
    const bright = Math.min(1.45, 0.45 + loud * 0.95 + this.flash * 0.28);
    // the disk turns: hypnotic base speed, music spins it harder
    this.rot = (this.rot + dt * (0.028 + loud * 0.09 + bass * 0.06)) % 1;
    this.rot2 = (this.rot2 + dt * (0.048 + loud * 0.13)) % 1;

    // the hole dominates the frame, drifting very slightly — floating, not spinning
    const cx = w * (cfg.holeX + 0.02 * Math.sin(t * 0.021));
    const cy = h * (cfg.holeY + 0.018 * Math.cos(t * 0.016));
    // bass is gravitational pressure: a subtle swell, not a throb
    const Rh = this.Rh * cfg.gravityStrength * (1 + bass * 0.1 + this.flash * 0.04);

    // beat pulses travel along the disk after they strike
    if (this.flareEnv > 0.03) this.flareAng += dt * (1.2 + loud * 1.5);

    this.drawSpaceBackground(ctx, w, h, t, dt, cx, cy, Rh, bright);
    if (this.quality() > 0.55) this.warpSpace(ctx, cx, cy, Rh, bass);
    if (cfg.showHudRings) this.drawRipples(ctx, dt, cx, cy, Rh, bright);

    // camera: breathing and bass pressure, no spin
    const camScale = 1 + 0.012 * Math.sin(t * 0.09) + this.flash * 0.02 + bass * 0.014;
    const shx = (Math.random() * 2 - 1) * this.shake;
    const shy = (Math.random() * 2 - 1) * this.shake;
    ctx.save();
    ctx.translate(w / 2 + shx, h / 2 + shy);
    ctx.scale(camScale, camScale);
    ctx.translate(-w / 2, -h / 2);
    // the whole system rolls slightly: the disk sweeps diagonally across frame
    ctx.translate(cx, cy);
    ctx.rotate(cfg.diskRoll);
    ctx.translate(-cx, -cy);

    this.drawMainAccretionDisk(ctx, cx, cy, Rh, t, false, bright); // far side, behind the hole
    this.drawLensedBackArc(ctx, cx, cy, Rh, bass, bright);
    this.drawLowerReturnArc(ctx, cx, cy, Rh, bass, bright);
    this.drawJets(ctx, t, cx, cy, Rh, bright);
    this.drawEventHorizonMask(ctx, cx, cy, Rh, bass, bright);
    this.drawMainAccretionDisk(ctx, cx, cy, Rh, t, true, bright); // near side, in front
    this.drawPlasmaHighlights(ctx, t, dt, cx, cy, Rh, bass, loud, bright);

    ctx.restore();

    this.drawSignalHorizon(ctx, w, h, t, dt, bright);
    this.applyFinalBloomAndPolish(ctx, w, h, cx, cy, bright);
    this.drawDebugLabel(ctx, w, h);
  }

  // -------------------------------------------------------------- plate mode

  // curated black-hole artwork as the base visual: slow cinematic push,
  // plate rotation with crossfades, and audio-reactive light anchored on the
  // plate's own hole via metadata (lensingCenterX/Y, eventHorizonRadius)
  renderPlateMode(ctx, w, h, t, dt) {
    const cur = this.plates[this.plateIdx % this.plates.length];
    this.plateT += dt;
    if (this.plateNext === null && this.plates.length > 1 && this.plateT > (cur.meta.recommendedDuration || 45)) {
      this.plateNext = (this.plateIdx + 1) % this.plates.length;
      this.plateFade = 0;
    }
    if (this.plateNext !== null) {
      this.plateFade += dt / 3;
      if (this.plateFade >= 1) {
        this.plateIdx = this.plateNext;
        this.plateNext = null;
        this.plateT = 0;
      }
    }
    const fade = this.plateNext !== null ? clamp01(this.plateFade) : 0;
    const meta = cur.meta;
    const bass = this.bass.value * this.cfg.bassReactivity;
    const loud = this.loud.value;
    const bright = 0.55 + loud * 0.6 + this.flash * 0.15;

    ctx.save();
    ctx.translate((Math.random() * 2 - 1) * this.shake, (Math.random() * 2 - 1) * this.shake);
    const rect = this.drawPlateCover(ctx, cur, w, h, 1, t);
    if (this.plateNext !== null) this.drawPlateCover(ctx, this.plates[this.plateNext], w, h, fade, t + 40);
    // exposure: loudness lifts the artwork, beats pulse it
    const dim = Math.max(0.08, 0.42 - (meta.brightness ?? 0.8) * 0.22 - loud * 0.16 - this.flash * 0.09);
    ctx.fillStyle = `rgba(1, 1, 3, ${dim})`;
    ctx.fillRect(-4, -4, w + 8, h + 8);

    // anchor the reactive light on the plate's own black hole
    const cx = rect.ox + (meta.lensingCenterX ?? 0.5) * rect.dw;
    const cy = rect.oy + (meta.lensingCenterY ?? 0.45) * rect.dh;
    const Rh = (meta.eventHorizonRadius ?? 0.18) * rect.dh;

    if (this.quality() > 0.55) this.warpSpace(ctx, cx, cy, Rh * 0.9, bass);
    this.drawRipples(ctx, dt, cx, cy, Rh, bright);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(cx, cy);
    // bass breathes light through the plate's accretion disk
    ctx.save();
    ctx.scale(Rh * 3.1, Rh * 1.9);
    ctx.globalAlpha = (0.04 + bass * 0.3 * (meta.bassGlow ?? 1) * (meta.diskIntensity ?? 1)) * bright;
    ctx.fillStyle = this.gradGlow;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    // beat flare: a localized hotspot riding the disk
    if (this.flareEnv > 0.04) {
      ctx.save();
      ctx.translate(Math.cos(this.flareAng) * Rh * 1.5, Math.sin(this.flareAng) * Rh * 0.55);
      ctx.scale(Rh * 0.9, Rh * 0.55);
      ctx.globalAlpha = this.flareEnv * 0.45 * (meta.beatFlare ?? 1) * bright;
      ctx.fillStyle = this.gradGlint;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // treble sparks orbit the disk plane
    const sparkA = this.treble.value * (meta.trebleSparkle ?? 1) * this.cfg.trebleSparkle;
    if (sparkA > 0.08) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(${HOTWHITE}, 0.9)`;
      for (const s of this.orbitSparks) {
        s.a += dt * s.sp * (1 + loud * 0.6);
        const x = cx + Math.cos(s.a) * Rh * s.rMul;
        const y = cy + Math.sin(s.a) * Rh * s.rMul * 0.42;
        ctx.globalAlpha = Math.min(0.8, sparkA * s.al);
        ctx.fillRect(x, y, 1.4, 1.4);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // jets only where the plate invites them
    if ((meta.jetChance ?? 0) > 0 && this.jetEnv > 0.03) this.drawJets(ctx, t, cx, cy, Rh, bright);
    ctx.restore();

    this.drawSignalHorizon(ctx, w, h, t, dt, bright);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.dim * 1.05, this.dim * 1.05);
    ctx.fillStyle = this.vignette;
    ctx.fillRect(-w / 2 / (this.dim * 1.05), -h / 2 / (this.dim * 1.05), w / (this.dim * 1.05), h / (this.dim * 1.05));
    ctx.restore();
    this.drawGrain(ctx, w, h);
    this.drawDebugLabel(ctx, w, h);
  }

  drawPlateCover(ctx, plate, w, h, alpha, t) {
    const img = plate.img;
    const meta = plate.meta;
    // slow cinematic push in and out between zoomMin and zoomMax
    const zoom = lerp(meta.zoomMin ?? 1, meta.zoomMax ?? 1.08, 0.5 + 0.5 * Math.sin(t * 0.022));
    const scale = Math.max(w / img.width, h / img.height) * zoom;
    const dw = img.width * scale;
    const dh = img.height * scale;
    const ox = (w - dw) / 2 + Math.sin(t * 0.015) * w * 0.008;
    const oy = (h - dh) / 2 + Math.cos(t * 0.012) * h * 0.008;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, ox, oy, dw, dh);
    ctx.globalAlpha = 1;
    return { ox, oy, dw, dh };
  }

  drawDebugLabel(ctx, w, h) {
    if (!this.cfg.debugLabel) return;
    ctx.save();
    ctx.font = "11px monospace";
    ctx.textBaseline = "bottom";
    let label;
    if (this.cfg.usePlates && this.plates.length) {
      const meta = this.plates[this.plateIdx % this.plates.length].meta;
      label = `EventHorizon: ${meta.sourceType || "generated"} / ${meta.title} / ${(meta.path || "").split("/").pop()}`;
    } else {
      label = "EventHorizon: procedural plasma renderer";
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.fillText(label, 8, h - 6);
    // the red warning only applies when plates were requested but none loaded
    if (this.cfg.usePlates && this.platesChecked && !this.plates.length) {
      ctx.font = "bold 13px monospace";
      ctx.fillStyle = "rgba(255, 120, 120, 0.95)";
      ctx.fillText("Event Horizon plates not loaded — using procedural fallback.", 8, 22);
    }
    ctx.restore();
  }

  // deep dark space: sparse deflected stars and a faint warm haze along the
  // disk plane — no busy image wallpaper competing with the hole
  drawSpaceBackground(ctx, w, h, t, dt, cx, cy, Rh, bright) {
    ctx.fillStyle = "rgb(2, 2, 4)";
    ctx.fillRect(0, 0, w, h);

    // faint heat haze hugging the disk plane
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.cfg.diskRoll);
    ctx.scale(1, 0.3);
    const haze = ctx.createRadialGradient(0, 0, Rh, 0, 0, w * 0.62);
    haze.addColorStop(0, `rgba(${AMBER}, ${0.05 + this.loud.value * 0.03})`);
    haze.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(-w, -w, w * 2, w * 2);
    ctx.restore();

    // sparse stars, gravitationally deflected near the hole
    const lensR = Rh * 1.5 * this.cfg.lensingIntensity;
    const count = Math.floor(this.stars.length * Math.max(0.4, this.quality()));
    for (let i = 0; i < count; i++) {
      const s = this.stars[i];
      s.x -= s.drift * dt;
      if (s.x < -10) {
        s.x = this.w + 10;
        s.y = Math.random() * this.h;
      }
      const dx = s.x - cx;
      const dy = s.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < Rh * 1.1) {
        s.x = Math.random() * this.w;
        s.y = Math.random() < 0.5 ? -5 : this.h + 5;
        continue;
      }
      const defl = Math.min(Rh * 0.5, (lensR * lensR * 0.3) / dist);
      const ax = s.x + (dx / dist) * defl;
      const ay = s.y + (dy / dist) * defl;
      const tw = 0.7 + 0.3 * Math.sin(s.tw + t * s.twSp);
      const a = Math.min(0.7, (0.22 + this.treble.value * 0.3 * this.cfg.trebleSparkle) * tw * bright);
      ctx.fillStyle = `rgba(${s.warm ? GOLDWHITE : HOTWHITE}, ${a})`;
      ctx.fillRect(ax, ay, s.size, s.size);
      // tiny cross glints when the highs sing
      if (s.size > 1.3 && this.treble.value > 0.5) {
        ctx.globalAlpha = a * this.treble.value * 0.5;
        ctx.fillRect(ax - 2, ay, 5, 0.7);
        ctx.fillRect(ax, ay - 2, 0.7, 5);
        ctx.globalAlpha = 1;
      }
    }
  }

  // real image-space lensing: re-draw the annulus around the hole scaled
  // outward, visibly bending everything behind the disk
  warpSpace(ctx, cx, cy, Rh, bass) {
    const rOut = Rh * 2.3;
    const dpr = ctx.canvas.width / this.w;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rOut, 0, TAU);
    ctx.arc(cx, cy, Rh * 0.98, 0, TAU, true);
    ctx.clip();
    const warp = 1 + (0.055 + bass * 0.05) * this.cfg.lensingIntensity;
    ctx.translate(cx, cy);
    ctx.scale(warp, warp);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = 0.65;
    ctx.drawImage(
      ctx.canvas,
      (cx - rOut) * dpr,
      (cy - rOut) * dpr,
      rOut * 2 * dpr,
      rOut * 2 * dpr,
      cx - rOut,
      cy - rOut,
      rOut * 2,
      rOut * 2
    );
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawRipples(ctx, dt, cx, cy, Rh, bright) {
    for (const rp of this.ripples) {
      if (!rp.active) continue;
      rp.r += dt * (2.6 + this.bass.value * 1.6);
      const fade = clamp01(1 - (rp.r - 1.3) / 5.5);
      if (fade <= 0) {
        rp.active = false;
        continue;
      }
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(${AMBER}, ${fade * 0.09 * bright})`;
      ctx.lineWidth = Rh * 0.3;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rp.r * Rh, rp.r * Rh * (this.tilt + 0.35), 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  // drawImage with horizontal source wrap-around (texture tiles along x)
  drawWrappedTex(ctx, tex, sx, sy, sw, sh, dx, dy, dw, dh) {
    const texW = tex.width;
    if (sx + sw <= texW) {
      ctx.drawImage(tex, sx, sy, sw, sh, dx, dy, dw, dh);
    } else {
      const w1 = texW - sx;
      const frac = w1 / sw;
      ctx.drawImage(tex, sx, sy, w1, sh, dx, dy, dw * frac, dh);
      ctx.drawImage(tex, 0, sy, sw - w1, sh, dx + dw * frac, dy, dw * (1 - frac), dh);
    }
  }

  // the main accretion disk: a near-edge-on plasma band sweeping across the
  // frame, crossing in front of the hole. Built from horizontal texture
  // layers that follow the ellipse envelopes of the annulus — streaming
  // plasma with no radial slicing, so nothing can comb or fan.
  drawMainAccretionDisk(ctx, cx, cy, Rh, t, nearHalf, bright) {
    const cfg = this.cfg;
    const bass = this.bass.value * cfg.bassReactivity;
    const loud = this.loud.value;
    // bass presses the inner edge toward the horizon and thickens the band
    const rIn = Rh * (1.06 - bass * 0.03);
    const rOut = this.bandOut;
    const tilt = this.tilt * (1 + bass * 0.25);
    const base =
      cfg.diskBrightness * (0.5 + loud * 0.75 + bass * 0.45) * bright * (nearHalf ? 1.15 : 0.8);
    const q = Math.max(0.4, this.quality());
    const tex = this.stripH;
    const texW = tex.width;
    const texH = tex.height;
    const worldToTex = texW / (this.w * 2.6); // long stretched streaks
    const xFlare = Math.cos(this.flareAng) * Rh * 2.2; // travelling beat pulse
    const scroll = ((this.rot * 1.6) % 1 + 1) % 1;
    // per-column rendering: each screen column is one vertical stretch of
    // the texture between the exact inner/outer disk envelopes — columns
    // tile perfectly and the envelopes are continuous, so no seams, no
    // bricks, no spikes are geometrically possible
    const colW = (this.lowRes ? 6 : 3) / Math.max(0.5, q);
    const xMax = Math.min(rOut, this.w * 1.35);
    const logSpan = Math.log(rOut / rIn);
    const detailOn = this.mid.value > 0.1;
    ctx.save();
    ctx.translate(cx, cy);
    if (!nearHalf) ctx.scale(1, -1); // far side mirrors above the plane
    for (let x = -xMax; x < xMax; x += colW) {
      const xm = x + colW / 2;
      const ax = Math.abs(xm);
      if (ax >= rOut) continue;
      const y0 = ax <= rIn ? tilt * Math.sqrt(rIn * rIn - xm * xm) : 0;
      const y1 = tilt * Math.sqrt(rOut * rOut - xm * xm);
      if (y1 - y0 < 0.6) continue;
      // radial rows visible in this column (geometric mapping, like the tex)
      const srcRow0 = ax <= rIn ? 0 : (Math.log(ax / rIn) / logSpan) * texH;
      // Doppler beaming: the left side approaches, white-hot
      const doppler = 1 + 0.85 * (-xm / (ax + Rh * 0.8));
      let alpha = base * (0.3 + doppler * 0.5);
      if (this.flareEnv > 0.05 && Math.abs(xm - xFlare) < Rh)
        alpha += this.flareEnv * (1 - Math.abs(xm - xFlare) / Rh) * 0.55;
      if (alpha < 0.015) continue;
      const sx = (((x * worldToTex + scroll * texW) % texW) + texW) % texW;
      const swTex = Math.max(0.5, colW * worldToTex);
      ctx.globalAlpha = Math.min(1, alpha);
      this.drawWrappedTex(ctx, tex, sx, srcRow0, swTex, texH - srcRow0, x, y0 - 0.5, colW + 0.4, y1 - y0 + 0.5);
      // turbulence detail the mids reveal, strongest near the hole
      if (detailOn && ax < Rh * 2.6) {
        const sx2 = (((x * worldToTex * 1.7 + this.rot2 * texW) % texW) + texW) % texW;
        ctx.globalAlpha = Math.min(1, alpha * this.mid.value * cfg.diskTurbulence * 0.8);
        this.drawWrappedTex(ctx, this.stripDetailH, sx2, srcRow0, swTex, texH - srcRow0, x, y0 - 0.5, colW + 0.4, y1 - y0 + 0.5);
      }
    }
    ctx.globalAlpha = 1;
    // one soft additive bloom hugging the plane, plus the white-hot Doppler
    // hotspot on the approaching side — drawn behind the hole only
    if (!nearHalf) {
      ctx.scale(1, -1);
      ctx.globalCompositeOperation = "lighter";
      ctx.save();
      // blooms hug the plane tightly: heat on the band, not an airbrush wash
      ctx.scale(1, Math.max(0.12, tilt * 1.8));
      const bloom = ctx.createRadialGradient(0, 0, rIn * 0.9, 0, 0, rOut * 0.35);
      bloom.addColorStop(0, `rgba(${GOLDWHITE}, ${base * 0.12})`);
      bloom.addColorStop(0.5, `rgba(${AMBER}, ${base * 0.05})`);
      bloom.addColorStop(1, `rgba(${RUST}, 0)`);
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(0, 0, rOut * 0.4, 0, TAU);
      ctx.fill();
      const hot = ctx.createRadialGradient(-Rh * 2.1, 0, 0, -Rh * 2.1, 0, Rh * 2);
      hot.addColorStop(0, `rgba(${HOTWHITE}, ${base * 0.5})`);
      hot.addColorStop(1, "rgba(255, 244, 228, 0)");
      ctx.fillStyle = hot;
      ctx.beginPath();
      ctx.arc(-Rh * 2.1, 0, Rh * 2, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // the far side of the disk, gravitationally bent into a bright arc OVER
  // the horizon — the signature feature of the lensed look
  drawLensedBackArc(ctx, cx, cy, Rh, bass, bright) {
    const lens = this.cfg.lensingIntensity * (0.75 + bass * 0.45 + this.flash * 0.2);
    const base = this.cfg.diskBrightness * (0.62 + this.loud.value * 0.55) * bright * lens;
    this.drawWrappedArc(ctx, cx, cy, Rh, base, -1, 0.26 + bass * 0.09, this.rot * 0.7);
  }

  // the dimmer wraparound image below the hole: the return arc
  drawLowerReturnArc(ctx, cx, cy, Rh, bass, bright) {
    const base = this.cfg.diskBrightness * (0.24 + this.loud.value * 0.3) * bright * this.cfg.lensingIntensity;
    this.drawWrappedArc(ctx, cx, cy, Rh, base, 1, 0.12 + bass * 0.04, this.rot * 0.55);
  }

  // the wraparound image of the disk, drawn as ONE smooth filled crescent:
  // inner edge hugging the horizon, outer edge bulging at the crown and
  // tapering to nothing at both ends where it melts into the disk plane.
  // A radial heat gradient (white-hot at the horizon -> amber -> nothing)
  // plus a few slim additive plasma streams keep it luminous and alive
  // without any segmentation artifacts. side = -1 over the top, +1 below.
  drawWrappedArc(ctx, cx, cy, Rh, base, side, thickness, scroll) {
    if (base < 0.01) return;
    // distinct arcs above and below, clearly separated from the band at the
    // sides — never a full encircling ring
    const center = side < 0 ? -Math.PI / 2 : Math.PI / 2;
    const halfSpan = side < 0 ? 1.35 : 1.0;
    const rIn = Rh * 1.01;
    const steps = this.lowRes ? 30 : 60;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = center - halfSpan + (i / steps) * halfSpan * 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
      else ctx.lineTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
    }
    for (let i = steps; i >= 0; i--) {
      const a = center - halfSpan + (i / steps) * halfSpan * 2;
      const u = (a - center) / halfSpan;
      const bulge = Math.pow(Math.cos((u * Math.PI) / 2), 0.8);
      // gentle flowing unevenness so the edge never reads as geometry
      const wobble = 1 + 0.04 * Math.sin(a * 7 + scroll * TAU * 3) * Math.sin(a * 3 - scroll * TAU * 2);
      const r = rIn + Rh * thickness * bulge * wobble;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    // hot and tight: white-gold at the horizon, falling off fast — plasma,
    // not a milky corona
    const g = ctx.createRadialGradient(0, 0, rIn, 0, 0, rIn + Rh * thickness);
    g.addColorStop(0, `rgba(${HOTWHITE}, ${Math.min(1, base)})`);
    g.addColorStop(0.13, `rgba(${GOLDWHITE}, ${Math.min(1, base * 0.85)})`);
    g.addColorStop(0.38, `rgba(${AMBER}, ${Math.min(1, base * 0.4)})`);
    g.addColorStop(0.75, `rgba(${RUST}, 0)`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  drawJets(ctx, t, cx, cy, Rh, bright) {
    if (this.jetEnv < 0.03) return;
    const env = this.jetEnv * (0.85 + 0.15 * Math.sin(t * 40));
    const len = this.h * (0.3 + env * 0.3);
    const wBase = Rh * 0.09; // thin high-energy filament, not a fan
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.jetTilt);
    ctx.globalCompositeOperation = "lighter";
    for (const dir of [-1, 1]) {
      const g = ctx.createLinearGradient(0, 0, 0, dir * len);
      g.addColorStop(0, `rgba(${HOTWHITE}, ${0.55 * env * bright})`);
      g.addColorStop(0.25, `rgba(${BLUE}, ${0.36 * env * bright})`);
      g.addColorStop(1, `rgba(${VIOLET}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-wBase * 0.5, 0);
      ctx.lineTo(-wBase * 0.14, dir * len);
      ctx.lineTo(wBase * 0.14, dir * len);
      ctx.lineTo(wBase * 0.5, 0);
      ctx.closePath();
      ctx.fill();
      // white-hot core filament
      ctx.strokeStyle = `rgba(${HOTWHITE}, ${0.5 * env * bright})`;
      ctx.lineWidth = Math.max(1, Rh * 0.035);
      ctx.beginPath();
      ctx.moveTo(0, dir * Rh * 0.5);
      ctx.lineTo(0, dir * len * 0.82);
      ctx.stroke();
    }
    // base bloom where the jets are born
    ctx.scale(Rh * 0.7 * env, Rh * 0.7 * env);
    ctx.globalAlpha = env * 0.5;
    ctx.fillStyle = this.gradGlint;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // the event horizon: perfectly clean black, nothing inside, only a thin
  // photon rim. Bass deepens the blackness by pressing the mask outward a hair.
  drawEventHorizonMask(ctx, cx, cy, Rh, bass, bright) {
    ctx.fillStyle = "rgb(0, 0, 0)";
    ctx.beginPath();
    ctx.arc(cx, cy, Rh * (1 + bass * 0.01), 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(${HOTWHITE}, ${(0.3 + this.flash * 0.3) * bright})`;
    ctx.lineWidth = Math.max(1, Rh * 0.008);
    ctx.beginPath();
    ctx.arc(cx, cy, Rh * 1.008, 0, TAU);
    ctx.stroke();
  }

  drawPlasmaHighlights(ctx, t, dt, cx, cy, Rh, bass, loud, bright) {
    this.drawSparks(ctx, t, dt, cx, cy, Rh, bass, loud, bright);
    this.drawInfall(ctx, dt, cx, cy, Rh, loud, bright);
  }

  // final polish: a faint additive lift on beats, vignette, film grain
  applyFinalBloomAndPolish(ctx, w, h, cx, cy, bright) {
    if (this.flash > 0.04) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(${AMBER}, ${this.flash * 0.035 * bright})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(this.dim * 1.6, this.dim * 1.6);
    ctx.fillStyle = this.vignette;
    ctx.fillRect(-cx / (this.dim * 1.6), -cy / (this.dim * 1.6), w / (this.dim * 1.6), h / (this.dim * 1.6));
    ctx.restore();
    this.drawGrain(ctx, w, h);
  }

  drawSparks(ctx, t, dt, cx, cy, Rh, bass, loud, bright) {
    const turb = this.cfg.diskTurbulence * (0.2 + this.dyn * 1.6 + loud * 0.35);
    const spin = 1 + bass * 0.4 + loud * 0.3;
    const base = this.cfg.diskBrightness * (0.3 + loud * 0.6) * bright;
    const count = Math.floor(this.sparks.length * Math.max(0.4, this.quality()));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < count; i++) {
      const p = this.sparks[i];
      p.a += dt * p.w0 * spin;
      const wob = Math.sin(p.phase + t * p.tSpeed) * 0.09 * turb;
      const rr = (p.r + wob) * Rh;
      const zOff = p.z * Rh * 0.045 * p.r;
      const x = cx + Math.cos(p.a) * rr;
      const y = cy + Math.sin(p.a) * rr * this.tilt + zOff;
      const doppler = 1 + 0.85 * Math.cos(p.a - this.beamAng);
      // white-hot only at the very inner edge; amber body, dim rust outskirts
      const heat = clamp01(1.35 - (p.r - 1.3) * 0.75);
      let flare = 0;
      if (this.flareEnv > 0.05) {
        const da = Math.abs(((p.a - this.flareAng + Math.PI) % TAU) - Math.PI);
        if (da < 0.4) flare = this.flareEnv * (1 - da / 0.4) * 2;
      }
      const outerFade = clamp01((3.6 - p.r) / 0.9); // melt into the disk edge
      const alpha = Math.min(1, base * (0.06 + doppler * 0.15) * (0.4 + heat * 0.7) * outerFade + flare * 0.35);
      if (alpha < 0.02) continue;
      const color = p.blue ? BLUE : heat > 0.75 ? HOTWHITE : heat > 0.35 ? AMBER : RUST;
      const dAng = Math.min(0.18, 0.06 + p.w0 * spin * 0.07);
      ctx.strokeStyle = `rgba(${color}, ${alpha})`;
      ctx.lineWidth = p.size * (0.8 + heat * 0.5) * this.lineScale;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(cx + Math.cos(p.a - dAng) * rr, cy + Math.sin(p.a - dAng) * rr * this.tilt + zOff);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawInfall(ctx, dt, cx, cy, Rh, loud, bright) {
    const count = Math.floor(this.infall.length * (0.4 + loud * 0.6) * Math.max(0.4, this.quality()) * this.cfg.particleDensity);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i++) {
      const p = this.infall[i];
      p.a += dt * (0.9 / Math.pow(p.r, 1.5)) * (1 + loud * 0.5) * 2.2;
      p.r -= dt * (0.05 + loud * 0.22) * (1.15 - p.r / 6);
      if (p.r < 1.06) {
        p.r = 3.4 + Math.random() * 1.8;
        p.a = Math.random() * TAU;
      }
      const heat = clamp01((3.2 - p.r) / 2.4);
      const x = cx + Math.cos(p.a) * p.r * Rh;
      const y = cy + Math.sin(p.a) * p.r * Rh * (this.tilt + 0.12);
      ctx.fillStyle = `rgba(${heat > 0.7 ? HOTWHITE : AMBER}, ${(0.2 + heat * 0.5) * bright})`;
      const s = 1 + heat * 1.2;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.restore();
  }

  drawSignalHorizon(ctx, w, h, t, dt, bright) {
    const intensity = this.cfg.signalHorizonIntensity;
    if (intensity <= 0) return;
    const y0 = h * 0.9;
    const amp = h * 0.05 * (0.2 + this.loud.value * 1.3) * (1 + this.flash * 0.5) * intensity;
    const samples = this.lowRes ? 48 : 140;
    const step = this.time.length / samples;
    const idle = this.loud.value < 0.02;
    for (let pass = this.quality() < 0.55 ? 1 : 0; pass < 2; pass++) {
      ctx.strokeStyle =
        pass === 0
          ? `rgba(${AMBER}, ${(0.1 + this.bass.value * 0.14 + this.treble.value * 0.1) * bright})`
          : `rgba(${GOLDWHITE}, ${(0.5 + this.loud.value * 0.4) * bright})`;
      ctx.lineWidth = (pass === 0 ? 3 + this.bass.value * 5 : 1 + this.bass.value * 0.9) * this.lineScale;
      ctx.beginPath();
      for (let i = 0; i < samples; i++) {
        const x = (i / (samples - 1)) * w;
        const v = idle
          ? Math.sin(i * 0.3 + t * 1.4) * 0.1 + Math.sin(i * 0.11 - t * 0.9) * 0.06
          : (this.time[Math.floor(i * step)] - 128) / 128;
        const y = y0 + v * (idle ? h * 0.012 : amp);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (!idle && this.treble.value > 0.35) {
      ctx.fillStyle = `rgba(${HOTWHITE}, ${this.treble.value * 0.7})`;
      for (let k = 0; k < 4; k++) {
        ctx.fillRect(Math.random() * w, y0 + (Math.random() - 0.5) * 6, 1.5, 1.5);
      }
    }
    for (const g of this.glints) {
      if (!g.active) continue;
      g.x += g.v * dt;
      g.life -= dt * 0.8;
      if (g.life <= 0 || g.x < -20 || g.x > w + 20) {
        g.active = false;
        continue;
      }
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(g.x, y0);
      ctx.scale(14, 14);
      ctx.globalAlpha = g.life * 0.8;
      ctx.fillStyle = this.gradGlint;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawGrain(ctx, w, h) {
    if (this.lowRes || this.quality() < 0.7) return;
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.translate(-Math.random() * 160, -Math.random() * 160);
    ctx.fillStyle = this.grain;
    ctx.fillRect(0, 0, w + 160, h + 160);
    ctx.restore();
  }
}
