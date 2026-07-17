// Ink Fluid — music injects luminous ink into dark water.
//
// Bass blooms heavy slow plumes from the tank's floor, treble stipples fine
// turbulence, a kick punches a vortex ring up through the ink, and a drop
// slams a full-width swirl through the whole tank. When the music stops, the
// ink keeps advecting and fades to black over ~20 seconds — the beautiful
// death — and the first plume of the next song is the world waking.
//
// REAL FLUID, not a shader trick: Stam stable fluids on a 240x60 grid
// (matching the 4:1 panel) — semi-Lagrangian advection, Jacobi pressure
// projection, vorticity confinement. Three dye channels are advected through
// the same velocity field, so colors MIX PHYSICALLY where plumes collide
// instead of averaging to mud. Rendered coarse and upscaled with smoothing:
// the blur is the aesthetic.
//
// The spec called this the riskiest perf budget in the document and ordered
// the solver PROTOTYPED AND MEASURED before polish (Mac budget <=2.5ms;
// declared fallback: curl-noise advection). The bench's perf group is that
// measurement — the solver ships because the number said so.
//
// Perf notes that matter: the three dye channels share ONE backtrace per
// cell (the bilinear weights are computed once and applied three times);
// velocity in cell units/sec keeps the advection arithmetic bare; zero
// per-frame allocation.

import { SilenceGate, EnergyJump } from "./silencegate.js";
import { Chroma, hiResOf } from "./chroma.js";

const PALETTES = {
  Bioluminescent: {
    bg: [2, 4, 10], inverted: false,
    bands: [[40, 110, 255], [0, 190, 215], [110, 235, 255], [215, 250, 255]],
    slug: [255, 255, 255],
  },
  Nebula: {
    bg: [4, 2, 10], inverted: false,
    bands: [[140, 60, 255], [255, 60, 180], [255, 150, 60], [255, 220, 160]],
    slug: [255, 245, 200],
  },
  "Sumi-e": {
    // white paper, dark ink: dye SUBTRACTS light
    bg: [230, 226, 216], inverted: true,
    bands: [[200, 205, 215], [170, 175, 190], [140, 150, 170], [110, 125, 150]],
    slug: [60, 90, 140],
  },
  Lava: {
    bg: [6, 2, 2], inverted: false,
    bands: [[255, 60, 10], [255, 140, 20], [255, 210, 60], [255, 250, 200]],
    slug: [255, 255, 255],
  },
};

// 7 emitters along the floor, mirrored spectrum: bass center, treble edges
const EMIT_X = [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92];
const EMIT_BAND = [3, 2, 1, 0, 1, 2, 3]; // band index per emitter

export class InkFluid {
  constructor() {
    this.cfg = { preset: "Bioluminescent" }; // self-governing (auto:null)
    this.gate = new SilenceGate();
    this.jump = new EnergyJump({ cooldown: 10 });
    this.chroma = new Chroma(); // note events — sparse music is NOTES, not bands
    this.freq = new Uint8Array(1024);
    this.notePuffs = 0; // bench counter
    this.puffs = []; // bench log: {midi, x} of recent blooms

    this._alloc(240, 60);
    this.iters = 12;

    // audio state
    this.energy = 0;
    this.visE = 0;
    this._eLo = 0.35; this._eHi = 0.65;
    this._loudPeak = 0.05;
    this._bandPeak = new Float32Array(4).fill(0.04);
    this.bands = new Float32Array(4);
    this._prevBass = 0;
    this._bassPeak = 0.05;
    this._fluxAvg = 0.03;
    this.beat = 0;
    this.mid = 0;
    this.treble = 0;
    this._wakeArm = 2.1;

    // bench counters
    this.kicks = 0;
    this.ruptures = 0;
    this.wakes = 0;

    this.t = 0;
    this.lastNow = 0;
    this.ms = 0;
    this.msSolve = 0;
    this.msRender = 0;
    this._slowFor = 0;
    this._img = null;
    this._cv = null;
  }

  _alloc(gw, gh) {
    this.gw = gw; this.gh = gh;
    const n = gw * gh;
    this.u = new Float32Array(n); this.v = new Float32Array(n);
    this.u0 = new Float32Array(n); this.v0 = new Float32Array(n);
    this.p = new Float32Array(n); this.div = new Float32Array(n);
    this.curl = new Float32Array(n);
    this.dr = new Float32Array(n); this.dg = new Float32Array(n); this.db = new Float32Array(n);
    this.dr0 = new Float32Array(n); this.dg0 = new Float32Array(n); this.db0 = new Float32Array(n);
    this._img = null; // rebuilt at the new size
  }

  // ---- solver ---------------------------------------------------------------

  _bnd(f, mode) {
    // mode 1: negate at x walls (u), 2: negate at y walls (v), 0: copy
    const { gw, gh } = this;
    for (let j = 1; j < gh - 1; j++) {
      f[j * gw] = mode === 1 ? -f[j * gw + 1] : f[j * gw + 1];
      f[j * gw + gw - 1] = mode === 1 ? -f[j * gw + gw - 2] : f[j * gw + gw - 2];
    }
    for (let i = 1; i < gw - 1; i++) {
      f[i] = mode === 2 ? -f[gw + i] : f[gw + i];
      f[(gh - 1) * gw + i] = mode === 2 ? -f[(gh - 2) * gw + i] : f[(gh - 2) * gw + i];
    }
    f[0] = 0.5 * (f[1] + f[gw]);
    f[gw - 1] = 0.5 * (f[gw - 2] + f[2 * gw - 1]);
    f[(gh - 1) * gw] = 0.5 * (f[(gh - 1) * gw + 1] + f[(gh - 2) * gw]);
    f[gh * gw - 1] = 0.5 * (f[gh * gw - 2] + f[(gh - 1) * gw - 1]);
  }

  _advectVel(dt) {
    const { gw, gh, u, v, u0, v0 } = this;
    const xMax = gw - 1.501, yMax = gh - 1.501;
    for (let j = 1; j < gh - 1; j++) {
      const row = j * gw;
      for (let i = 1; i < gw - 1; i++) {
        const idx = row + i;
        let x = i - dt * u0[idx];
        let y = j - dt * v0[idx];
        if (x < 0.5) x = 0.5; else if (x > xMax) x = xMax;
        if (y < 0.5) y = 0.5; else if (y > yMax) y = yMax;
        const i0 = x | 0, j0 = y | 0;
        const s = x - i0, t = y - j0;
        const a = j0 * gw + i0;
        const w00 = (1 - s) * (1 - t), w10 = s * (1 - t), w01 = (1 - s) * t, w11 = s * t;
        u[idx] = u0[a] * w00 + u0[a + 1] * w10 + u0[a + gw] * w01 + u0[a + gw + 1] * w11;
        v[idx] = v0[a] * w00 + v0[a + 1] * w10 + v0[a + gw] * w01 + v0[a + gw + 1] * w11;
      }
    }
    this._bnd(u, 1); this._bnd(v, 2);
  }

  _advectDye(dt, decay) {
    const { gw, gh, u, v, dr, dg, db, dr0, dg0, db0 } = this;
    const xMax = gw - 1.501, yMax = gh - 1.501;
    for (let j = 1; j < gh - 1; j++) {
      const row = j * gw;
      for (let i = 1; i < gw - 1; i++) {
        const idx = row + i;
        let x = i - dt * u[idx];
        let y = j - dt * v[idx];
        if (x < 0.5) x = 0.5; else if (x > xMax) x = xMax;
        if (y < 0.5) y = 0.5; else if (y > yMax) y = yMax;
        const i0 = x | 0, j0 = y | 0;
        const s = x - i0, t = y - j0;
        const a = j0 * gw + i0;
        const w00 = (1 - s) * (1 - t) * decay, w10 = s * (1 - t) * decay;
        const w01 = (1 - s) * t * decay, w11 = s * t * decay;
        // one backtrace, three channels — this fusion is a third of the budget
        dr[idx] = dr0[a] * w00 + dr0[a + 1] * w10 + dr0[a + gw] * w01 + dr0[a + gw + 1] * w11;
        dg[idx] = dg0[a] * w00 + dg0[a + 1] * w10 + dg0[a + gw] * w01 + dg0[a + gw + 1] * w11;
        db[idx] = db0[a] * w00 + db0[a + 1] * w10 + db0[a + gw] * w01 + db0[a + gw + 1] * w11;
      }
    }
  }

  _project() {
    const { gw, gh, u, v, p, div } = this;
    for (let j = 1; j < gh - 1; j++) {
      const row = j * gw;
      for (let i = 1; i < gw - 1; i++) {
        const idx = row + i;
        div[idx] = -0.5 * (u[idx + 1] - u[idx - 1] + v[idx + gw] - v[idx - gw]);
        p[idx] = 0;
      }
    }
    this._bnd(div, 0); this._bnd(p, 0);
    for (let k = 0; k < this.iters; k++) {
      for (let j = 1; j < gh - 1; j++) {
        const row = j * gw;
        for (let i = 1; i < gw - 1; i++) {
          const idx = row + i;
          p[idx] = (div[idx] + p[idx - 1] + p[idx + 1] + p[idx - gw] + p[idx + gw]) * 0.25;
        }
      }
      this._bnd(p, 0);
    }
    for (let j = 1; j < gh - 1; j++) {
      const row = j * gw;
      for (let i = 1; i < gw - 1; i++) {
        const idx = row + i;
        u[idx] -= 0.5 * (p[idx + 1] - p[idx - 1]);
        v[idx] -= 0.5 * (p[idx + gw] - p[idx - gw]);
      }
    }
    this._bnd(u, 1); this._bnd(v, 2);
  }

  _vorticity(dt, eps) {
    const { gw, gh, u, v, curl } = this;
    for (let j = 1; j < gh - 1; j++) {
      const row = j * gw;
      for (let i = 1; i < gw - 1; i++) {
        const idx = row + i;
        curl[idx] = 0.5 * (v[idx + 1] - v[idx - 1] - u[idx + gw] + u[idx - gw]);
      }
    }
    const k = dt * eps;
    for (let j = 2; j < gh - 2; j++) {
      const row = j * gw;
      for (let i = 2; i < gw - 2; i++) {
        const idx = row + i;
        const c = curl[idx];
        let nx = Math.abs(curl[idx + 1]) - Math.abs(curl[idx - 1]);
        let ny = Math.abs(curl[idx + gw]) - Math.abs(curl[idx - gw]);
        const m = Math.sqrt(nx * nx + ny * ny) + 1e-5;
        nx /= m; ny /= m;
        // force = eps * (N x omega): pushes existing swirls to keep swirling
        u[idx] += k * ny * c;
        v[idx] -= k * nx * c;
      }
    }
  }

  step(dt, eps) {
    // one solver tick: forces were already stamped into u/v by the caller
    this._vorticity(dt, eps);
    this.u0.set(this.u); this.v0.set(this.v);
    this._advectVel(dt);
    this._project();
    this.dr0.set(this.dr); this.dg0.set(this.dg); this.db0.set(this.db);
    this._advectDye(dt, this._dyeDecay);
    // mild velocity dissipation: the tank calms, never rings forever
    const vd = 1 - dt * 0.12;
    for (let i = 0; i < this.u.length; i++) { this.u[i] *= vd; this.v[i] *= vd; }
  }

  // ---- ink + events ---------------------------------------------------------

  _stamp(cx, cy, rad, cr, cg, cb, amount, upV) {
    const { gw, gh } = this;
    const x0 = Math.max(1, cx - rad), x1 = Math.min(gw - 2, cx + rad);
    const y0 = Math.max(1, cy - rad), y1 = Math.min(gh - 2, cy + rad);
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const idx = j * gw + i;
        this.dr[idx] += cr * amount;
        this.dg[idx] += cg * amount;
        this.db[idx] += cb * amount;
        if (upV) this.v[idx] -= upV; // grid y points down: up is negative
      }
    }
  }

  _kickVortex(pal) {
    // a vortex ring seen side-on: a hard, narrow upward jet at a bass
    // emitter — the projection step itself rolls the jet's shoulders into
    // the two counter-rotating cores (the mushroom cloud). Injecting a
    // hand-drawn swirl looks fake; letting the solver make it doesn't.
    this.kicks++;
    const e = 3 + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.35 ? 1 : 0);
    const cx = Math.round(EMIT_X[e] * this.gw);
    this.lastKick = { x: cx, y: this.gh - 6 }; // bench probes curl HERE
    const [r, g, b] = pal.bands[0];
    this._stamp(cx, this.gh - 4, 2, r / 255, g / 255, b / 255, 0.5, 55);
  }

  _rupture(pal) {
    // full-width swirl + a palette-shifted dye slug across mid-height
    this.ruptures++;
    const { gw, gh, u } = this;
    const midY = (gh / 2) | 0;
    for (let j = 1; j < gh - 1; j++) {
      const s = j < midY ? 1 : -1; // shear: top goes one way, bottom the other
      const row = j * gw;
      const fall = 1 - Math.abs(j - midY) / midY;
      for (let i = 1; i < gw - 1; i++) u[row + i] += s * 34 * fall;
    }
    const [r, g, b] = pal.slug;
    for (let i = 2; i < gw - 2; i += 2) {
      this._stamp(i, midY + (((i * 13) % 5) - 2), 1, r / 255, g / 255, b / 255, 0.24, 0);
    }
  }

  _wakePlume(pal) {
    this.wakes++;
    const [r, g, b] = pal.bands[0];
    this._stamp((this.gw / 2) | 0, this.gh - 5, 3, r / 255, g / 255, b / 255, 0.7, 70);
  }

  // ---- audio ----------------------------------------------------------------

  _analyze(dt) {
    const g = this.gate.update(this.freq, dt);
    // 4 mirrored bands: bass / low-mid / high-mid / treble
    const RANGES = [[1, 6], [6, 26], [26, 92], [92, 372]];
    let maxPeak = 0.04;
    for (let b2 = 0; b2 < 4; b2++) maxPeak = Math.max(maxPeak, this._bandPeak[b2]);
    for (let b2 = 0; b2 < 4; b2++) {
      const raw = this.gate.band(this.freq, RANGES[b2][0], RANGES[b2][1]);
      if (g.open) this._bandPeak[b2] = Math.max(this._bandPeak[b2] * (1 - dt * 0.05), raw, 0.02);
      // a band's peak may not read below 10% of the loudest band's peak — the
      // skyline lesson: a steady quiet bed otherwise normalizes itself to full
      const peak = Math.max(this._bandPeak[b2], maxPeak * 0.1);
      this.bands[b2] += (g.gate * Math.min(1, raw / peak) - this.bands[b2]) * Math.min(1, dt * 8);
    }
    this.mid += (this.bands[2] - this.mid) * Math.min(1, dt * 4);
    this.treble += (this.bands[3] - this.treble) * Math.min(1, dt * 6);

    const loud = g.loud;
    if (g.open) {
      if (loud > this._loudPeak) this._loudPeak = loud;
      else this._loudPeak += (loud - this._loudPeak) * Math.min(1, dt * 0.05);
    }
    this._loudPeak = Math.max(0.05, this._loudPeak);
    const loudN = g.gate * Math.min(1, loud / this._loudPeak);
    this.energy += (loudN - this.energy) * Math.min(1, dt * 2.2);
    if (g.gate > 0.8) {
      const e = this.energy;
      if (e < this._eLo) this._eLo = e;
      else this._eLo += (e - this._eLo) * Math.min(1, dt * 0.05);
      if (e > this._eHi) this._eHi = e;
      else this._eHi += (e - this._eHi) * Math.min(1, dt * 0.05);
    }
    const span = this._eHi - this._eLo;
    const stretched = span > 0.02 ? Math.max(0, Math.min(1, (this.energy - this._eLo) / span)) : 0.5;
    const conf = Math.min(1, span / 0.12);
    this.visE += ((stretched * conf + this.energy * (1 - conf)) * g.gate - this.visE) * Math.min(1, dt * 3);

    // kick: volume-independent bass flux
    const rawBass = this.gate.band(this.freq, 1, 6);
    if (g.open && rawBass > this._bassPeak) this._bassPeak = rawBass;
    else this._bassPeak = Math.max(0.04, this._bassPeak - dt * 0.01);
    const fluxN = g.open ? Math.max(0, rawBass - this._prevBass) / Math.max(0.04, this._bassPeak) : 0;
    this._prevBass = rawBass;
    this._fluxAvg += (fluxN - this._fluxAvg) * Math.min(1, dt * 1.5);
    this._kickNow = g.open && fluxN > Math.max(0.05, this._fluxAvg * 2.1) && this.beat < 0.6;
    if (this._kickNow) this.beat = 1;
    this.beat = Math.max(0, this.beat - dt * 4);

    this._ruptureNow = this.jump.update(loud, this._loudPeak, g.open, g.gate, dt);

    // the world wakes: gate reopens after real silence
    this._wakeNow = false;
    if (!g.open) this._wakeArm += dt;
    else {
      if (this._wakeArm > 2) this._wakeNow = true;
      this._wakeArm = 0;
    }
    return g;
  }

  // ---- frame ----------------------------------------------------------------

  render(ctx, analyser, w, h, now) {
    const t0 = performance.now();
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 1 / 30);
    this.lastNow = now;
    this.t += dt;
    if (analyser) analyser.getByteFrequencyData(this.freq);
    else this.freq.fill(0);
    const g = this._analyze(dt);
    this.chroma.update(hiResOf(analyser), dt);
    // sparse tonal material (solo piano) barely moves the broadband gate —
    // the chroma tonality gate is the co-equal driver (the cymatics lesson)
    const drive = Math.max(g.gate, this.chroma._gateEnv * 0.85);
    const pal = PALETTES[this.cfg.preset] || PALETTES.Bioluminescent;

    // ---- inject: emitters breathe with their bands
    const inj = g.gate * (0.25 + this.visE * 0.75);
    if (inj > 0.01) {
      for (let e = 0; e < 7; e++) {
        const lvl = this.bands[EMIT_BAND[e]];
        if (lvl < 0.04) continue;
        const [r, gg, b] = pal.bands[EMIT_BAND[e]];
        const cx = Math.round(EMIT_X[e] * this.gw);
        const amt = lvl * inj * dt * 5.4;
        const up = lvl * inj * (EMIT_BAND[e] === 0 ? 34 : 22) * dt * 60;
        this._stamp(cx, this.gh - 3, 1, r / 255, gg / 255, b / 255, amt, up * 0.016);
      }
    }
    // NOTE BLOOMS — the "quiet piano is boring" fix. Band emitters gave a
    // solo piano the same two anonymous bass puffs whatever was played; now
    // every tracked note blooms its own ink at its PITCH position (low notes
    // left, high right, like the keyboard) colored by register, so a melody
    // literally paints across the tank. Dense mixes cap at chroma's 8
    // strongest voices, so this stays texture there, not spray.
    for (const nt of this.chroma.notes) {
      if (nt.state !== "on" || nt._seenByInk || nt.conf < 0.2) continue;
      nt._seenByInk = true;
      this.notePuffs++;
      const t2 = Math.max(0, Math.min(1, (nt.midi - 36) / 60));
      const cx = Math.round((0.06 + t2 * 0.88) * this.gw);
      if (this.puffs.push({ midi: nt.midi, x: cx }) > 64) this.puffs.shift();
      const f3 = Math.min(2.999, t2 * 3), i0 = f3 | 0, fr = f3 - i0;
      const c0 = pal.bands[i0], c1 = pal.bands[i0 + 1];
      const amt = (0.3 + nt.vel * 0.5) * (0.5 + nt.conf * 0.5);
      this._stamp(cx, this.gh - 6, 1,
        (c0[0] + (c1[0] - c0[0]) * fr) / 255,
        (c0[1] + (c1[1] - c0[1]) * fr) / 255,
        (c0[2] + (c1[2] - c0[2]) * fr) / 255,
        amt, 0.55);
    }
    if (this._kickNow) this._kickVortex(pal);
    if (this._ruptureNow) this._rupture(pal);
    if (this._wakeNow) this._wakePlume(pal);
    // treble: fine surface shimmer — tiny random velocity stipple
    const jit = this.treble * g.gate * 26;
    if (jit > 0.5) {
      const n = this.gw * this.gh;
      for (let k2 = 0; k2 < 90; k2++) {
        const idx = (Math.random() * n) | 0;
        this.u[idx] += (Math.random() - 0.5) * jit;
        this.v[idx] += (Math.random() - 0.5) * jit;
      }
    }

    // buoyancy: luminous ink is warm — dense dye gently rises, so plumes
    // keep blooming through sustained passages instead of settling into
    // static haze between kicks. Stays faintly on during the death: the
    // fading ink drifts upward as it goes, which is most of the beauty.
    {
      const { gw, gh, v, dr, dg, db } = this;
      const bk = dt * (1.5 + drive * 3.5);
      for (let j = 1; j < gh - 1; j++) {
        const row = j * gw;
        for (let i = 1; i < gw - 1; i++) {
          const idx = row + i;
          v[idx] -= bk * (dr[idx] + dg[idx] + db[idx]);
        }
      }
    }

    // ---- solve. dye decays to ~nothing in ~20s once injection stops
    this._dyeDecay = 1 - dt * 0.155;
    const eps = (1.4 + this.mid * 3.2) * drive + 0.25;
    this.step(dt, eps);
    const tSolve = performance.now();

    // ---- render: dye -> coarse ImageData -> smoothed upscale
    const { gw, gh } = this;
    if (!this._img) {
      this._cv = document.createElement("canvas");
      this._cv.width = gw; this._cv.height = gh;
      this._img = this._cv.getContext("2d").createImageData(gw, gh);
    }
    const px = this._img.data;
    const [bgR, bgG, bgB] = pal.bg;
    const inv = pal.inverted;
    for (let i = 0, o = 0; i < gw * gh; i++, o += 4) {
      // x/(1+0.6x) soft clip: plume cores glow without clipping to flat white
      const r = this.dr[i], g2 = this.dg[i], b = this.db[i];
      const cr = (255 * r) / (1 + 0.6 * r), cg = (255 * g2) / (1 + 0.6 * g2), cb = (255 * b) / (1 + 0.6 * b);
      if (inv) {
        px[o] = bgR - cr; px[o + 1] = bgG - cg; px[o + 2] = bgB - cb;
      } else {
        px[o] = bgR + cr; px[o + 1] = bgG + cg; px[o + 2] = bgB + cb;
      }
      px[o + 3] = 255;
    }
    this._cv.getContext("2d").putImageData(this._img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._cv, 0, 1, gw, gh - 2, 0, 0, w, h); // crop boundary rows
    const tEnd = performance.now();

    this.msSolve += (tSolve - t0 - this.msSolve) * 0.05;
    this.msRender += (tEnd - tSolve - this.msRender) * 0.05;
    this.ms += (tEnd - t0 - this.ms) * 0.05;
    // auto-quality: sustained real slowness drops grid + iterations once
    if (this.ms > 4 && this.gw === 240) {
      this._slowFor += dt;
      if (this._slowFor > 2) { this._alloc(160, 40); this.iters = 8; }
    } else this._slowFor = 0;
  }
}
