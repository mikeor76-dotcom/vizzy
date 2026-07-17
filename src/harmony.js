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
import { HarmonicRibbon, RIB_HZ, RIB_SECONDS } from "./harmonicribbon.js";

const TAU = Math.PI * 2;
const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// wheel slot -> pitch class. pos(p) = (p*7) % 12 inverts to this.
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const SLOT_OF = new Array(12);
FIFTHS.forEach((pc, slot) => { SLOT_OF[pc] = slot; });

// the English scale for the tension number: a listener shouldn't need to
// know what 0.49 means — the display says "moderate" for them
const TENSION_WORDS = [[0.15, "Serene"], [0.3, "Calm"], [0.45, "Mild"], [0.6, "Moderate"], [0.75, "Tense"], [2, "Dissonant"]];
function tensionWord(t) {
  for (const [max, wrd] of TENSION_WORDS) if (t < max) return wrd;
  return "Dissonant";
}
const MAJ_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MIN_SCALE = [0, 2, 3, 5, 7, 8, 10];

// gradients need numeric rgb, and the palettes speak hsl
function hslToRgb(hDeg, sFrac, lFrac) {
  const h = ((hDeg % 360) + 360) % 360 / 360;
  const q = lFrac < 0.5 ? lFrac * (1 + sFrac) : lFrac + sFrac - lFrac * sFrac;
  const p = 2 * lFrac - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}


const PALETTES = {
  Spectral: {
    // hue per pitch class — 30 degrees each, so the wheel is also a colour wheel
    pc: (pc, v) => `hsl(${pc * 30} 85% ${18 + v * 45}%)`,
    pcRGB: (pc) => hslToRgb(pc * 30, 0.85, 0.62),
    ink: [225, 232, 248], dim: [90, 105, 140], bg: [6, 7, 14],
    accent: [120, 200, 255],
  },
  "Gold Engraving": {
    // one colour, energy only: no hue to read, so you read the SHAPE
    pc: (pc, v) => `rgb(${Math.round(30 + v * 225)},${Math.round(22 + v * 180)},${Math.round(8 + v * 70)})`,
    pcRGB: (pc) => [255, 186 + (pc % 4) * 12, 96 + (pc % 3) * 14], // braided golds
    ink: [246, 232, 200], dim: [110, 95, 62], bg: [10, 8, 5],
    accent: [255, 205, 110],
  },
  Nebula: {
    pc: (pc, v) => `hsl(${255 + pc * 9} ${70 + v * 25}% ${16 + v * 46}%)`,
    pcRGB: (pc) => hslToRgb(255 + pc * 9, 0.8, 0.64),
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

    this.ribbon = new HarmonicRibbon(); // the 30s harmonic-history panel
    this._ribAcc = 0;
    this.keyHistory = []; // {label, at}
    this._lastKey = null;
    this._tenHist = new Float32Array(450); // 30s of tension at 15Hz
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

  // small-caps section header, letter-spaced like an instrument faceplate
  _header(ctx, text, x, y) {
    const pal = this._pal();
    ctx.font = "600 11px -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = `rgba(${pal.dim},0.9)`;
    const prev = ctx.letterSpacing;
    try { ctx.letterSpacing = "1.5px"; } catch {}
    ctx.fillText(text.toUpperCase(), x, y);
    try { ctx.letterSpacing = prev || "0px"; } catch {}
  }

  // the tension gauge: labelled scale, cold-to-hot fill, a pointer at the
  // value, and the number said in ENGLISH underneath — "0.49" means nothing
  // to a listener until the display admits it means "moderate"
  _drawGauge(ctx, x, y, w, h) {
    const pal = this._pal();
    const t = Math.min(1, this.chroma.tension * 1.25);
    this._header(ctx, "Harmonic Tension", x, y - 14);

    // frame + faint well
    ctx.fillStyle = `rgba(${pal.ink},0.04)`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = `rgba(${pal.dim},0.4)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // scale: major ticks + labels at quarters, minor ticks at eighths
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 8; i++) {
      const v = i / 8;
      const ty = y + h - v * h;
      const major = i % 2 === 0;
      ctx.strokeStyle = `rgba(${pal.dim},${major ? 0.55 : 0.28})`;
      ctx.beginPath();
      ctx.moveTo(x + w + 4, ty + 0.5);
      ctx.lineTo(x + w + (major ? 11 : 8), ty + 0.5);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = `rgba(${pal.dim},0.8)`;
        ctx.fillText(v === 0 ? "0.00" : v === 1 ? "1.0" : v.toFixed(2), x + w + 15, ty);
      }
    }

    // the fill: cold blue at rest, gold under strain. The gradient spans the
    // FULL scale and gets clipped by the fill height, so colours live at
    // absolute tension levels rather than stretching with the value.
    const fh = Math.max(2, t * h);
    const g = ctx.createLinearGradient(0, y + h, 0, y);
    g.addColorStop(0, "rgba(24,52,120,0.9)");
    g.addColorStop(0.35, "rgba(52,84,150,0.9)");
    g.addColorStop(0.62, "rgba(190,140,80,0.92)");
    g.addColorStop(1, "rgba(255,198,112,0.95)");
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + h - fh, w - 2, fh);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(x + 1, y, w - 2, h);
    ctx.restore();
    // bright cap + soft bloom above it
    const capY = y + h - fh;
    ctx.fillStyle = "rgba(255,226,170,0.28)";
    ctx.fillRect(x + 1, capY - 4, w - 2, 4);
    ctx.fillStyle = "rgba(255,236,190,0.95)";
    ctx.fillRect(x + 1, capY - 1.25, w - 2, 2.5);
    // pointer riding the scale side
    ctx.fillStyle = `rgba(${pal.ink},0.9)`;
    ctx.beginPath();
    ctx.moveTo(x + w + 3, capY);
    ctx.lineTo(x + w + 10, capY - 4);
    ctx.lineTo(x + w + 10, capY + 4);
    ctx.closePath();
    ctx.fill();

    // the number, and what it MEANS
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 26px -apple-system, 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(255,198,112,0.95)";
    ctx.fillText(this.chroma.tension.toFixed(2), x, y + h + 32);
    this._header(ctx, tensionWord(this.chroma.tension), x, y + h + 50);
  }

  _drawChart(ctx, x, y, w, h) {
    const pal = this._pal();
    const labW = 36;
    const px0 = x + labW, pw = w - labW;
    this._header(ctx, "Tension Over Time", px0, y - 14);

    // y scale + gridlines at quarters
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = i / 4;
      const gy2 = y + h - v * h;
      ctx.strokeStyle = `rgba(${pal.dim},${i === 0 ? 0.4 : 0.16})`;
      ctx.beginPath();
      ctx.moveTo(px0, gy2 + 0.5);
      ctx.lineTo(px0 + pw, gy2 + 0.5);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillStyle = `rgba(${pal.dim},0.8)`;
      ctx.fillText(v === 0 ? "0.00" : v === 1 ? "1.0" : v.toFixed(2), px0 - 6, gy2);
    }
    // time axis: gridlines + labels every 10s
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i <= 3; i++) {
      const gx = px0 + (i / 3) * pw;
      if (i > 0 && i < 3) {
        ctx.strokeStyle = `rgba(${pal.dim},0.12)`;
        ctx.beginPath();
        ctx.moveTo(gx + 0.5, y);
        ctx.lineTo(gx + 0.5, y + h);
        ctx.stroke();
      }
      ctx.textAlign = i === 0 ? "left" : i === 3 ? "right" : "center";
      ctx.fillStyle = `rgba(${pal.dim},0.8)`;
      ctx.fillText(i === 3 ? "NOW" : `-${30 - i * 10}s`, gx, y + h + 16);
    }
    ctx.strokeStyle = `rgba(${pal.dim},0.35)`;
    ctx.strokeRect(px0 + 0.5, y + 0.5, pw - 1, h - 1);

    // the curve: one path, used three ways — gradient fill underneath, a wide
    // soft glow pass, then the hot core (the additive-glow house style)
    const n = this._tenHist.length;
    const pts = new Array(n);
    for (let i = 0; i < n; i++) {
      const idx = (this._tenIdx + i) % n;
      pts[i] = [px0 + (i / (n - 1)) * pw, y + h - Math.min(1, this._tenHist[idx] * 1.25) * h];
    }
    const trace = () => {
      ctx.beginPath();
      pts.forEach(([ax, ay], i) => (i ? ctx.lineTo(ax, ay) : ctx.moveTo(ax, ay)));
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(px0, y, pw, h);
    ctx.clip();
    trace();
    ctx.lineTo(px0 + pw, y + h);
    ctx.lineTo(px0, y + h);
    ctx.closePath();
    const fg = ctx.createLinearGradient(0, y, 0, y + h);
    fg.addColorStop(0, "rgba(255,198,112,0.30)");
    fg.addColorStop(0.6, "rgba(200,150,90,0.10)");
    fg.addColorStop(1, "rgba(60,60,80,0)");
    ctx.fillStyle = fg;
    ctx.fill();
    trace();
    ctx.strokeStyle = "rgba(255,190,110,0.18)";
    ctx.lineWidth = 5;
    ctx.stroke();
    trace();
    ctx.strokeStyle = "rgba(255,222,160,0.92)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  // how much of the harmony sits inside the detected key's scale — the word
  // under the key ("Diatonic" / "Chromatic") is this number speaking English
  _diatonicity() {
    const pc = this.chroma.keyPc;
    if (pc < 0) return null;
    const scale = this.chroma.keyMode === "minor" ? MIN_SCALE : MAJ_SCALE;
    let inScale = 0, all = 1e-6;
    for (let i = 0; i < 12; i++) {
      all += this.chroma.chroma[i];
      if (scale.includes((i - pc + 12) % 12)) inScale += this.chroma.chroma[i];
    }
    return inScale / all;
  }

  _drawKeyPanel(ctx, x, y, w) {
    const pal = this._pal();
    this._header(ctx, "Key", x, y - 14);
    ctx.strokeStyle = `rgba(${pal.dim},0.4)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 6.5);
    ctx.lineTo(x + w, y - 6.5);
    ctx.stroke();

    const label = this.chroma.keyLabel();
    const conf = this.chroma.keyConfidence;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (label) {
      ctx.font = "600 27px -apple-system, 'Segoe UI', sans-serif";
      ctx.fillStyle = `rgba(${pal.ink},${0.35 + conf * 0.6})`;
      ctx.fillText(label, x, y + 76);
      const d = this._diatonicity();
      const word = d === null ? "" : d > 0.82 ? "Diatonic" : d > 0.62 ? "Mostly diatonic" : "Chromatic";
      ctx.font = "13px -apple-system, 'Segoe UI', sans-serif";
      ctx.fillStyle = `rgba(${pal.dim},0.95)`;
      ctx.fillText(word, x, y + 98);
    } else {
      ctx.font = "13px ui-monospace, Menlo, monospace";
      ctx.fillStyle = `rgba(${pal.dim},0.6)`;
      ctx.fillText("listening…", x, y + 76);
    }

    // a live 12-bar chroma glyph — the mock's little mark, but real data
    const gw2 = 4, gap = 2.5;
    const gx0 = x + 2, gy0 = y + 150;
    ctx.fillStyle = "rgba(255,198,112,0.75)";
    for (let pc = 0; pc < 12; pc++) {
      const v = this.chroma.chroma[pc];
      const bh = 3 + v * 15;
      ctx.fillRect(gx0 + pc * (gw2 + gap), gy0 - bh, gw2, bh);
    }
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

    this._ribAcc += dt;
    while (this._ribAcc >= 1 / RIB_HZ) { this._ribAcc -= 1 / RIB_HZ; this.ribbon.push(this.chroma.chroma); }
    this._tenAcc += dt;
    if (this._tenAcc >= 1 / 15) { // 450 samples = the chart's 30 seconds
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
    const ribH = h * 0.72, ribW = w * 0.34, ribX = w * 0.028, ribY = (h - ribH) / 2;
    this._header(ctx, "Harmonic History", ribX, ribY - 14);
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = `rgba(${pal.dim},0.7)`;
    ctx.fillText(`last ${RIB_SECONDS} seconds`, ribX + ribW, ribY - 14);
    this.ribbon.draw(ctx, { x: ribX, y: ribY, w: ribW, h: ribH },
      { id: this.cfg.preset, pcRGB: pal.pcRGB, dim: pal.dim, ink: pal.ink }, dt);
    this._drawWheel(ctx, w * 0.545, h * 0.5, Math.min(h * 0.43, w * 0.12));
    const gy = h * 0.2, gh = h * 0.55;
    this._drawGauge(ctx, w * 0.672, gy, 34, gh);
    this._drawChart(ctx, w * 0.732, gy, w * 0.16, gh);
    this._drawKeyPanel(ctx, w * 0.918, gy, w * 0.055);

    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
}
