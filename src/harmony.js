// Harmony Wheel — the mode that proves the platform understands music.
//
// Twelve petals in CIRCLE-OF-FIFTHS order (C G D A E B F# C# G# D# A# F), not
// chromatic order, and that single choice is what makes the whole thing work:
// consonant notes become NEIGHBOURS. A chord stops being a scatter of lit bars
// and becomes a compact shape, and — because the layout is a transposition —
// that shape is INVARIANT. Every major triad draws the same figure; it just
// rotates to point at its root. Minor leans the other way. You learn to read
// the progression as geometry turning, which is exactly what a progression is.
//
// Measured, a struck major triad lights FIVE petals, not the three of theory:
// the 3rd partial of its fifth is a second, the 3rd of its third is a seventh,
// and those pitches are genuinely in the air — the ear hears them too. The
// figure is a compact pentagon rather than a triangle, still identical for
// every major triad and still distinct from minor. The recording wins.
//
//   left    a 30-second chromagram ribbon: the song's harmony as architecture
//   centre  the wheel, the chord polygon, and the key in the hub
//   right   a harmonic-tension gauge (dissonance vs consonance) + key history
//
// The key label carries a CONFIDENCE HALO and dims when the detector is
// unsure, because a confidently wrong key reads as a broken instrument while
// an uncertain one reads as an honest one.
//
// It is also deliberately SLOW: measured, it takes ~12s to follow a modulation
// (chroma's key histogram is a leaky ~11s window, and it cannot know the key
// changed until it has heard enough of the new one). Everything else here —
// petals, chord polygon, ribbon, tension — is instant. That split is the point:
// a key is a claim about a stretch of music, not about this frame, and a label
// that flickers reads as a broken instrument while one that lags reads as a
// considered one. src/chroma.js does the listening; this file only draws.

import { Chroma, hiResOf } from "./chroma.js";

const TAU = Math.PI * 2;
const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// wheel slot -> pitch class. pos(p) = (p*7) % 12 inverts to this.
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const SLOT_OF = new Array(12);
FIFTHS.forEach((pc, slot) => { SLOT_OF[pc] = slot; });

const RIB_SECONDS = 30;
const RIB_HZ = 20; // ribbon columns per second
const RIB_COLS = RIB_SECONDS * RIB_HZ;

const PALETTES = {
  Spectral: {
    // hue per pitch class — 30 degrees each, so the wheel is also a colour wheel
    pc: (pc, v) => `hsl(${pc * 30} 85% ${18 + v * 45}%)`,
    ink: [225, 232, 248], dim: [90, 105, 140], bg: [6, 7, 14],
    accent: [120, 200, 255],
  },
  "Gold Engraving": {
    // one colour, energy only: no hue to read, so you read the SHAPE
    pc: (pc, v) => `rgb(${Math.round(30 + v * 225)},${Math.round(22 + v * 180)},${Math.round(8 + v * 70)})`,
    ink: [246, 232, 200], dim: [110, 95, 62], bg: [10, 8, 5],
    accent: [255, 205, 110],
  },
  Nebula: {
    pc: (pc, v) => `hsl(${255 + pc * 9} ${70 + v * 25}% ${16 + v * 46}%)`,
    ink: [232, 224, 255], dim: [110, 96, 150], bg: [8, 5, 16],
    accent: [200, 130, 255],
  },
};

export class Harmony {
  constructor() {
    this.cfg = { preset: "Spectral" }; // self-governing via chroma's own gate
    this.chroma = new Chroma();
    this.beat = 0; // gentle radial pulse — the only energy-driven thing here
    this._prevBass = 0;
    this._bassPeak = 0.05;
    this._fluxAvg = 0.03;
    this._freq = new Uint8Array(1024);

    this.rib = null; // offscreen ribbon (scrolled, never redrawn wholesale)
    this.ribKey = "";
    this._ribAcc = 0;
    this.keyHistory = []; // {label, at}
    this._lastKey = null;
    this._tenHist = new Float32Array(180); // ~6s tension sparkline
    this._tenIdx = 0;
    this._tenAcc = 0;
    this.homeSlot = 0; // the tonic marker glides rather than jumps
    this.t = 0;
    this.lastNow = 0;
    this.ms = 0;
  }

  _pal() { return PALETTES[this.cfg.preset] || PALETTES.Spectral; }

  // the beat is read from the SHARED analyser; harmony itself is chroma's job
  _beat(analyser, dt) {
    if (!analyser) return;
    analyser.getByteFrequencyData(this._freq);
    let bs = 0;
    for (let i = 1; i < 6; i++) bs += this._freq[i];
    const bass = bs / (5 * 255);
    if (bass > 0.03) this._bassPeak = Math.max(this._bassPeak * (1 - dt * 0.05), bass, 0.04);
    const flux = Math.max(0, bass - this._prevBass) / Math.max(0.04, this._bassPeak);
    this._prevBass = bass;
    this._fluxAvg += (flux - this._fluxAvg) * Math.min(1, dt * 1.5);
    if (bass > 0.035 && flux > Math.max(0.05, this._fluxAvg * 2.1)) this.beat = 1;
    this.beat = Math.max(0, this.beat - dt * 4);
  }

  _ensureRibbon(h) {
    const rh = Math.round(h * 0.75);
    const key = `${RIB_COLS}x${rh}|${this.cfg.preset}`;
    if (this.rib && this.ribKey === key) return;
    this.rib = document.createElement("canvas");
    this.rib.width = RIB_COLS;
    this.rib.height = rh;
    this.ribKey = key;
    const c = this.rib.getContext("2d");
    c.fillStyle = `rgb(${this._pal().bg})`;
    c.fillRect(0, 0, RIB_COLS, rh);
  }

  // scroll one pixel and paint the newest chroma column at the right edge.
  // (Redrawing 600 columns x 12 lanes every frame would be 7200 rects; this is
  // one drawImage and twelve — the waterfall trick.)
  _pushRibbon() {
    const c = this.rib.getContext("2d");
    const w = this.rib.width, h = this.rib.height;
    c.globalCompositeOperation = "copy";
    c.drawImage(this.rib, -1, 0);
    c.globalCompositeOperation = "source-over";
    const pal = this._pal();
    const laneH = h / 12;
    for (let slot = 0; slot < 12; slot++) {
      const pc = FIFTHS[slot];
      const v = this.chroma.chroma[pc];
      c.fillStyle = v > 0.04 ? pal.pc(pc, v) : `rgb(${pal.bg})`;
      c.fillRect(w - 1, slot * laneH, 1, laneH + 0.5);
    }
  }

  _drawRibbon(ctx, x, y, w, h) {
    const pal = this._pal();
    ctx.drawImage(this.rib, x, y, w, h);
    // lane labels + the fifths ladder
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const laneH = h / 12;
    for (let slot = 0; slot < 12; slot++) {
      const pc = FIFTHS[slot];
      const lit = this.chroma.chroma[pc];
      ctx.fillStyle = `rgba(${lit > 0.35 ? pal.ink : pal.dim},${0.35 + lit * 0.6})`;
      ctx.fillText(PC_NAMES[pc], x - 6, y + slot * laneH + laneH / 2);
    }
    ctx.strokeStyle = `rgba(${pal.dim},0.25)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = `rgba(${pal.dim},0.7)`;
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${RIB_SECONDS}s of harmony`, x, y - 8);
    ctx.textAlign = "right";
    ctx.fillText("now", x + w, y - 8);
  }

  _drawWheel(ctx, cx, cy, R) {
    const pal = this._pal();
    const ch = this.chroma.chroma;
    const inner = R * 0.42;
    const pulse = 1 + this.beat * 0.025; // the only thing loudness moves here

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);

    // the ring the petals stand on
    ctx.strokeStyle = `rgba(${pal.dim},0.3)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, inner, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.stroke();

    // --- petals: length AND brightness carry the class's energy
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let slot = 0; slot < 12; slot++) {
      const pc = FIFTHS[slot];
      const v = ch[pc];
      const a = (slot / 12) * TAU - Math.PI / 2;
      const half = (TAU / 12) * 0.36;
      const len = inner + (R - inner) * Math.max(0.02, v);
      const col = pal.pc(pc, v);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - half) * inner, Math.sin(a - half) * inner);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.lineTo(Math.cos(a + half) * inner, Math.sin(a + half) * inner);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.25 + v * 0.75;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // --- THE CHORD POLYGON. Because the wheel is in fifths, this shape is
    // transposition-invariant: every major triad is the same figure, rotated to
    // its root, and compact — an arbitrary set of five pitch classes would
    // sprawl right across the wheel. That's the whole idea: you read chords by
    // shape, and the progression by watching it turn.
    const active = [];
    for (let slot = 0; slot < 12; slot++) {
      const pc = FIFTHS[slot];
      if (ch[pc] > 0.42) active.push({ slot, pc, v: ch[pc] });
    }
    if (active.length >= 2) {
      const pts = active.map(({ slot }) => {
        const a = (slot / 12) * TAU - Math.PI / 2;
        return [Math.cos(a) * inner * 0.92, Math.sin(a) * inner * 0.92];
      });
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const mean = active.reduce((s, x) => s + x.v, 0) / active.length;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = `rgba(${pal.accent},${0.05 + mean * 0.12})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${pal.accent},${0.14 + mean * 0.2})`; // wide soft
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${pal.ink},${0.5 + mean * 0.45})`; // bright core
      ctx.lineWidth = 1.4;
      ctx.stroke();
      for (const [px, py] of pts) { // dwell dots at the chord tones
        ctx.fillStyle = `rgba(${pal.ink},0.9)`;
        ctx.beginPath();
        ctx.arc(px, py, 2.4, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- the tonic marker glides around the ring instead of teleporting
    const kp = this.chroma.keyPc;
    if (kp >= 0 && this.chroma.keyConfidence > 0.05) {
      const target = SLOT_OF[kp];
      let d = target - this.homeSlot;
      while (d > 6) d -= 12;
      while (d < -6) d += 12;
      this.homeSlot = (this.homeSlot + d * Math.min(1, this._dt * 2.5) + 12) % 12;
      const a = (this.homeSlot / 12) * TAU - Math.PI / 2;
      const conf = this.chroma.keyConfidence;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(${pal.ink},${0.25 + conf * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (R + 9), Math.sin(a) * (R + 9), 5, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // --- hub: the key, and how sure we are. An uncertain label must LOOK
    // uncertain — a confidently wrong key reads as a broken instrument.
    const conf = this.chroma.keyConfidence;
    if (conf > 0.02) {
      const hg = ctx.createRadialGradient(cx, cy, 0, cx, cy, inner * 0.95);
      hg.addColorStop(0, `rgba(${pal.accent},${0.05 + conf * 0.22})`);
      hg.addColorStop(1, `rgba(${pal.accent},0)`);
      ctx.fillStyle = hg;
      ctx.fillRect(cx - inner, cy - inner, inner * 2, inner * 2);
    }
    const label = this.chroma.keyLabel();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (label) {
      ctx.font = "600 21px -apple-system, 'Segoe UI', sans-serif";
      ctx.fillStyle = `rgba(${pal.ink},${0.25 + conf * 0.7})`;
      ctx.fillText(label, cx, cy - 6);
      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.fillStyle = `rgba(${pal.dim},${0.4 + conf * 0.4})`;
      ctx.fillText(`${Math.round(conf * 100)}% sure`, cx, cy + 14);
    } else {
      ctx.font = "12px ui-monospace, Menlo, monospace";
      ctx.fillStyle = `rgba(${pal.dim},0.5)`;
      ctx.fillText("listening…", cx, cy);
    }
  }

  _drawTension(ctx, x, y, w, h, sparkW) {
    const pal = this._pal();
    const t = this.chroma.tension;
    ctx.strokeStyle = `rgba(${pal.dim},0.3)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // the column fills from the bottom; dissonance climbs, resolution drops
    const fh = h * Math.min(1, t * 1.25);
    const g = ctx.createLinearGradient(0, y + h, 0, y);
    g.addColorStop(0, `rgba(${pal.accent},0.5)`);
    g.addColorStop(0.65, "rgba(255,170,60,0.6)");
    g.addColorStop(1, "rgba(255,80,70,0.85)");
    ctx.fillStyle = g;
    ctx.fillRect(x + 1, y + h - fh, w - 2, fh);
    ctx.fillStyle = `rgba(${pal.ink},0.85)`;
    ctx.fillRect(x + 1, y + h - fh - 1, w - 2, 2);
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(${pal.dim},0.75)`;
    ctx.fillText("TENSION", x + w / 2, y - 8);
    ctx.fillText(t.toFixed(2), x + w / 2, y + h + 12);

    // a short sparkline: you can see a suspension resolve
    const sx = x + w + 16, sw = sparkW, sh = h;
    ctx.strokeStyle = `rgba(${pal.dim},0.2)`;
    ctx.strokeRect(sx + 0.5, y + 0.5, sw - 1, sh - 1);
    ctx.beginPath();
    for (let i = 0; i < this._tenHist.length; i++) {
      const idx = (this._tenIdx + i) % this._tenHist.length;
      const px = sx + (i / (this._tenHist.length - 1)) * sw;
      const py = y + sh - Math.min(1, this._tenHist[idx] * 1.25) * sh;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.strokeStyle = `rgba(${pal.accent},0.75)`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = `rgba(${pal.dim},0.7)`;
    ctx.fillText("dissonance rises · resolution falls", sx, y - 8);
  }

  _drawKeyHistory(ctx, x, y) {
    const pal = this._pal();
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = `rgba(${pal.dim},0.75)`;
    ctx.fillText("KEY", x, y - 12);
    this.keyHistory.slice(0, 6).forEach((k, i) => {
      const a = i === 0 ? 0.95 : Math.max(0.12, 0.6 - i * 0.14);
      ctx.font = i === 0 ? "600 17px -apple-system, sans-serif" : "13px -apple-system, sans-serif";
      ctx.fillStyle = `rgba(${i === 0 ? pal.ink : pal.dim},${a})`;
      ctx.fillText(k.label, x, y + i * 21);
    });
  }

  render(ctx, analyser, w, h, now) {
    const t0 = performance.now();
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this._dt = dt;
    this.t += dt;

    // chroma wants the HI-RES analyser (main.js attaches it as .hiRes for modes
    // that declare needsChroma); it degrades gracefully if it isn't there
    this.chroma.update(hiResOf(analyser), dt);
    this._beat(analyser, dt);

    const pal = this._pal();
    ctx.fillStyle = `rgb(${pal.bg})`;
    ctx.fillRect(0, 0, w, h);

    this._ensureRibbon(h);
    this._ribAcc += dt;
    while (this._ribAcc >= 1 / RIB_HZ) { this._ribAcc -= 1 / RIB_HZ; this._pushRibbon(); }
    this._tenAcc += dt;
    if (this._tenAcc >= 1 / 30) {
      this._tenAcc = 0;
      this._tenHist[this._tenIdx] = this.chroma.tension;
      this._tenIdx = (this._tenIdx + 1) % this._tenHist.length;
    }

    const label = this.chroma.keyLabel();
    if (label && label !== this._lastKey) {
      this._lastKey = label;
      this.keyHistory.unshift({ label, at: now });
      if (this.keyHistory.length > 6) this.keyHistory.length = 6;
    }

    // Layout for the 4:1 bar. The wheel is inherently SQUARE and height-capped
    // (~200px radius on a 480px panel), so it can only ever own a fifth of the
    // width — the two readouts that genuinely want to be wide get the rest.
    // A first pass centred the wheel and left the right third as dead space
    // around a thin gauge; everything now earns its width.
    const ribH = h * 0.76, ribW = w * 0.34;
    this._drawRibbon(ctx, w * 0.028, (h - ribH) / 2, ribW, ribH);
    this._drawWheel(ctx, w * 0.545, h * 0.5, Math.min(h * 0.43, w * 0.12));
    const gy = h * 0.17, gh = h * 0.6;
    this._drawTension(ctx, w * 0.685, gy, 28, gh, w * 0.185);
    this._drawKeyHistory(ctx, w * 0.895, gy);

    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
}
