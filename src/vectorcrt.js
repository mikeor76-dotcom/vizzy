// Vector CRT — an Asteroids/Tempest-era vector monitor doing oscilloscope-
// music art: everything on screen is a single luminous beam tracing geometry,
// with real phosphor persistence, dwell-glow at the vertices (where a vector
// beam pauses, it burns brighter — this one detail sells the illusion more
// than anything else), subtle barrel distortion, and a bezel vignette.
//
// Persistence is a ping-pong feedback buffer: each frame the previous frame
// is redrawn slightly zoomed and faded, then the new strokes land on top —
// the classic trail-bloom. (Never draw a canvas onto itself; the pair swap
// avoids the artifacts.)
//
// The beam draws one of four figures, rotated by song section the way
// MilkDrop's director cuts presets: a rotating wireframe solid (cube when
// calm, icosahedron when the music drives), the live waveform bent into a
// closed ring, band Lissajous curves, and the spectrum as a single-stroke
// mountain skyline. Kick = scale punch + beam flash; treble = vertex jitter.
// In silence the beam parks as a slowly drifting standby dot.
//
// Time-domain amplitude is self-governed on EXCURSION via the shared RANGE_*
// constants from wave.js (the "linear AutoGain is for frequency bins only"
// lesson). Pi-friendly: a few hundred segments + two drawImages, no shadowBlur.

import { SilenceGate } from "./silencegate.js";
import { RANGE_UP, RANGE_DN, RANGE_TARGET, RANGE_MAXGAIN, RANGE_KNEE } from "./wave.js";

const TAU = Math.PI * 2;

const PALETTES = {
  "P1 Green": { core: [225, 255, 230], glow: [60, 255, 110], fade: 0.8 },
  "P7 Blue": { core: [235, 245, 255], glow: [90, 170, 255], fade: 0.86 }, // long-persistence phosphor
  "Amber Mono": { core: [255, 240, 210], glow: [255, 176, 60], fade: 0.82 },
};

const CONTENT = ["solid", "ring", "lissajous", "mountain"];
const PHRASE_BEATS = 32;

// the two solids, unit-radius (cube + icosahedron), as vertex/edge lists
function makeSolids() {
  const cube = { v: [], e: [] };
  for (let i = 0; i < 8; i++) cube.v.push([(i & 1) * 2 - 1, ((i >> 1) & 1) * 2 - 1, ((i >> 2) & 1) * 2 - 1].map((c) => c * 0.62));
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    let d = 0;
    for (let k = 0; k < 3; k++) d += Math.abs(cube.v[i][k] - cube.v[j][k]) > 0.01 ? 1 : 0;
    if (d === 1) cube.e.push([i, j]);
  }
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw = [];
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
    raw.push([0, s1, s2 * phi], [s1, s2 * phi, 0], [s2 * phi, 0, s1]);
  }
  const norm = Math.hypot(1, phi);
  const ico = { v: raw.map((p) => p.map((c) => c / norm)), e: [] };
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
    const d = Math.hypot(ico.v[i][0] - ico.v[j][0], ico.v[i][1] - ico.v[j][1], ico.v[i][2] - ico.v[j][2]);
    if (d < 1.06) ico.e.push([i, j]); // edge length of unit icosahedron ≈ 1.05
  }
  return { cube, ico };
}
const SOLIDS = makeSolids();

export class VectorCrt {
  constructor() {
    this.cfg = { preset: "P1 Green" }; // self-governing (auto: null)
    this.freq = new Uint8Array(1024);
    this.timeF = null; // Float32Array when the analyser supports it
    this.timeB = new Uint8Array(2048);
    this.gate = new SilenceGate();

    this.level = 0.05; // slow excursion tracker (the wave.js pattern)
    this.gain = 1;
    this.energy = 0;
    this.beat = 0;
    this.treble = 0;
    this._loudPeak = 0.06;
    this._bassPeak = 0.05;
    this._trebPeak = 0.05;
    this._prevBass = 0;
    this._fluxAvg = 0.03;
    this._lastSection = 0;

    this.contentIdx = 0;
    this.beatsInContent = 0;
    this.lissAB = 0;
    this.flash = 0; // beam over-drive on section cuts (brief, not a strobe)
    this.driftX = 0.5; this.driftY = 0.5; // the standby dot wanders

    this.fbA = null; this.fbB = null; this.fbKey = "";
    this.t = 0;
    this.lastNow = 0;
    this.ms = 0;
  }

  sample(i, n) {
    // time-domain sample in -1..1, index i of n across the capture window
    if (this.timeF) {
      const idx = Math.min(this.timeF.length - 1, Math.round((i / n) * (this.timeF.length - 1)));
      return this.timeF[idx];
    }
    const idx = Math.min(this.timeB.length - 1, Math.round((i / n) * (this.timeB.length - 1)));
    return (this.timeB[idx] - 128) / 128;
  }

  amp(s) {
    // soft-knee excursion gain: quiet songs visible, loud songs unclipped
    const g = s * this.gain;
    return Math.sign(g) * Math.pow(Math.min(1, Math.abs(g)), RANGE_KNEE);
  }

  analyze(dt, now) {
    const g = this.gate.update(this.freq, dt);
    const band = (lo, hi) => {
      let s = 0;
      for (let i = lo; i < hi; i++) s += this.freq[i];
      return Math.max(0, s / ((hi - lo) * 255) - g.sub);
    };
    const rawBass = band(1, 6);
    const rawTreb = band(92, 372);
    if (g.open) {
      const dk = 1 - dt * 0.05;
      this._loudPeak = Math.max(this._loudPeak * dk, g.loud, 0.04);
      this._bassPeak = Math.max(this._bassPeak * dk, rawBass, 0.04);
      this._trebPeak = Math.max(this._trebPeak * dk, rawTreb, 0.03);
    }
    this.energy += (g.gate * Math.min(1, g.loud / this._loudPeak) - this.energy) * Math.min(1, dt * 2.2);
    this.treble += (g.gate * Math.min(1, rawTreb / this._trebPeak) - this.treble) * Math.min(1, dt * 6);

    // excursion auto-range (wave.js lesson: NEVER "linear" AutoGain for
    // time-domain display; govern on what is actually drawn)
    let maxExc = 0.001;
    const N = 128;
    for (let i = 0; i < N; i++) maxExc = Math.max(maxExc, Math.abs(this.sample(i, N)));
    if (g.open) {
      const kUp = 1 - Math.exp(-dt / RANGE_UP);
      const kDn = 1 - Math.exp(-dt / RANGE_DN);
      this.level += (maxExc - this.level) * (maxExc > this.level ? kUp : kDn);
      this.level = Math.max(0.012, this.level);
    }
    this.gain = Math.min(RANGE_MAXGAIN, RANGE_TARGET / this.level);

    const fluxN = g.open ? Math.max(0, rawBass - this._prevBass) / Math.max(0.04, this._bassPeak) : 0;
    this._prevBass = rawBass;
    this._fluxAvg += (fluxN - this._fluxAvg) * Math.min(1, dt * 1.5);
    if (g.open && fluxN > Math.max(0.05, this._fluxAvg * 2.1)) {
      if (this.beat < 0.6) this.onBeat();
      this.beat = 1;
    }
    this.beat = Math.max(0, this.beat - dt * 4);
    // section accent (or a fresh song) cuts to the next figure
    if (g.open && fluxN > Math.max(0.14, this._fluxAvg * 4.2) && now - this._lastSection > 9000) {
      this._lastSection = now;
      this.nextContent();
    }
    const wasResting = this.resting;
    this.resting = g.gate < 0.15;
    if (wasResting === true && !this.resting) this.nextContent();
  }

  onBeat() {
    this.beatsInContent++;
    if (CONTENT[this.contentIdx] === "lissajous") this.lissAB = (this.lissAB + 1) % 4;
    if (this.beatsInContent >= PHRASE_BEATS) this.nextContent();
  }

  nextContent() {
    this.contentIdx = (this.contentIdx + 1) % CONTENT.length;
    this.beatsInContent = 0;
    this.flash = 1; // the beam over-drives for a moment on the cut
  }

  // subtle barrel distortion — the glass is curved
  barrel(x, y, w, h) {
    const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2);
    const r2 = dx * dx * 0.28 + dy * dy; // panel is 4:1 — weight x down
    const f = 1 + r2 * 0.045;
    return [w / 2 + dx * (w / 2) * f, h / 2 + dy * (h / 2) * f];
  }

  // one beam polyline: glow pass, hot core, dwell dots at the vertices
  stroke(ctx, pts, w, h, closed, dwellEvery = 1) {
    const pal = PALETTES[this.cfg.preset] || PALETTES["P1 Green"];
    const [cr, cg, cb] = pal.core, [gr, gg, gb] = pal.glow;
    const boost = 1 + this.beat * 0.35 + this.flash * 0.8;
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [bx, by] = this.barrel(pts[i][0], pts[i][1], w, h);
        if (i === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
      }
      if (closed) ctx.closePath();
    };
    ctx.strokeStyle = `rgba(${gr},${gg},${gb},${0.16 * boost})`;
    ctx.lineWidth = 5.5;
    path(); ctx.stroke();
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${Math.min(1, 0.85 * boost)})`;
    ctx.lineWidth = 1.5;
    path(); ctx.stroke();
    // dwell: the beam pauses at vertices and burns
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${Math.min(1, 0.7 * boost)})`;
    for (let i = 0; i < pts.length; i += dwellEvery) {
      const [bx, by] = this.barrel(pts[i][0], pts[i][1], w, h);
      ctx.fillRect(bx - 1.3, by - 1.3, 2.6, 2.6);
    }
  }

  drawSolid(ctx, w, h) {
    const solid = this.energy > 0.55 ? SOLIDS.ico : SOLIDS.cube;
    const rx = this.t * 0.5, ry = this.t * 0.73;
    const cx = w / 2, cy = h / 2;
    const scale = h * 0.34 * (1 + this.beat * 0.16) * (0.85 + this.energy * 0.25);
    const jit = this.treble * 6;
    const proj = solid.v.map(([x, y, z]) => {
      let y2 = y * Math.cos(rx) - z * Math.sin(rx), z2 = y * Math.sin(rx) + z * Math.cos(rx);
      let x2 = x * Math.cos(ry) + z2 * Math.sin(ry); z2 = -x * Math.sin(ry) + z2 * Math.cos(ry);
      const p = 2.6 / (2.6 + z2);
      return [cx + x2 * scale * p + (Math.random() - 0.5) * jit, cy + y2 * scale * p + (Math.random() - 0.5) * jit];
    });
    for (const [a, b] of solid.e) this.stroke(ctx, [proj[a], proj[b]], w, h, false);
  }

  drawRing(ctx, w, h) {
    const N = 160;
    const pts = [];
    const R = h * 0.3;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * TAU + this.t * 0.22;
      const r = R * (0.72 + this.amp(this.sample(i, N)) * 0.5 + this.beat * 0.06);
      pts.push([w / 2 + Math.cos(th) * r * 1.35, h / 2 + Math.sin(th) * r]); // a touch wide for the bar
    }
    this.stroke(ctx, pts, w, h, true, 8);
  }

  drawLissajous(ctx, w, h) {
    const [a, b] = [[3, 2], [5, 4], [2, 3], [4, 3]][this.lissAB];
    const N = 140;
    const pts = [];
    const ph = this.t * (0.55 + this.energy * 0.8);
    for (let i = 0; i <= N; i++) {
      const p = ph + (i / N) * 1.7;
      pts.push([
        w / 2 + Math.sin(p * a) * w * 0.36 * (1 + this.amp(this.sample(i, N)) * 0.1),
        h / 2 + Math.sin(p * b) * h * 0.36,
      ]);
    }
    this.stroke(ctx, pts, w, h, false, 10);
  }

  drawMountain(ctx, w, h) {
    const N = 150;
    const pts = [];
    const base = h * 0.72;
    for (let i = 0; i <= N; i++) {
      const bin = Math.round(2 + Math.pow(i / N, 1.6) * 380);
      const v = Math.min(1, (this.freq[bin] / 255) * 1.15 * (1 + this.beat * 0.1));
      pts.push([w * 0.05 + (i / N) * w * 0.9, base - v * h * 0.5]);
    }
    this.stroke(ctx, pts, w, h, false, 10);
  }

  render(ctx, analyser, w, h, now) {
    const t0 = performance.now();
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t += dt;
    if (analyser) {
      analyser.getByteFrequencyData(this.freq);
      if (analyser.getFloatTimeDomainData) {
        if (!this.timeF || this.timeF.length !== analyser.fftSize) this.timeF = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(this.timeF);
      } else if (analyser.getByteTimeDomainData) {
        this.timeF = null;
        analyser.getByteTimeDomainData(this.timeB);
      }
    } else {
      this.freq.fill(0);
      if (this.timeF) this.timeF.fill(0); else this.timeB.fill(128);
    }
    this.analyze(dt, now);
    this.flash = Math.max(0, this.flash - dt * 4);

    const pal = PALETTES[this.cfg.preset] || PALETTES["P1 Green"];
    if (!this.fbA || this.fbKey !== `${w}x${h}`) {
      this.fbA = document.createElement("canvas");
      this.fbB = document.createElement("canvas");
      this.fbA.width = this.fbB.width = w;
      this.fbA.height = this.fbB.height = h;
      this.fbA.getContext("2d").fillRect(0, 0, w, h);
      this.fbKey = `${w}x${h}`;
    }
    // phosphor: previous frame, faded and zoomed a hair (the trail blooms
    // outward), then the new beam strokes on top
    const b = this.fbB.getContext("2d");
    b.globalCompositeOperation = "source-over";
    b.fillStyle = "#000";
    b.fillRect(0, 0, w, h);
    b.globalAlpha = pal.fade;
    const zx = w * 0.004, zy = h * 0.004;
    b.drawImage(this.fbA, -zx, -zy, w + zx * 2, h + zy * 2);
    b.globalAlpha = 1;
    b.globalCompositeOperation = "lighter";

    if (this.resting) {
      // standby: the beam parks as a drifting dot (its trail is the ghost)
      this.driftX += Math.sin(this.t * 0.21) * 0.0006;
      this.driftY += Math.cos(this.t * 0.17) * 0.0011;
      this.driftX = Math.min(0.7, Math.max(0.3, this.driftX));
      this.driftY = Math.min(0.7, Math.max(0.3, this.driftY));
      const [dx, dy] = this.barrel(this.driftX * w, this.driftY * h, w, h);
      const [cr, cg, cb] = pal.core;
      b.fillStyle = `rgba(${cr},${cg},${cb},0.8)`;
      b.fillRect(dx - 1.5, dy - 1.5, 3, 3);
      const [gr, gg, gb] = pal.glow;
      b.fillStyle = `rgba(${gr},${gg},${gb},0.2)`;
      b.fillRect(dx - 4, dy - 4, 8, 8);
    } else {
      const c = CONTENT[this.contentIdx];
      if (c === "solid") this.drawSolid(b, w, h);
      else if (c === "ring") this.drawRing(b, w, h);
      else if (c === "lissajous") this.drawLissajous(b, w, h);
      else this.drawMountain(b, w, h);
    }
    b.globalCompositeOperation = "source-over";

    ctx.drawImage(this.fbB, 0, 0);
    // bezel vignette: curved glass in a dark surround
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.62);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(0.8, "rgba(0,0,0,0.25)");
    vg.addColorStop(1, "rgba(0,0,0,0.75)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    const tmp = this.fbA; this.fbA = this.fbB; this.fbB = tmp;
    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
}
