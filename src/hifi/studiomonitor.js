// Studio Monitor — a mastering-style dashboard: L/R meters with peak hold,
// smoothed frequency curve, stereo correlation, numeric readouts, and a
// waveform strip. Serious, clean, minimal.

import { HifiAudio, PeakHold, clamp01, lerp, pickPalette } from "./shared.js";

const PALETTES = {
  Mastering: { accent: "126,231,135", text: "#6f7683" },
  Minimal: { accent: "201,204,214", text: "#6a6e7a" },
  "Blue Studio": { accent: "110,168,255", text: "#5f7091" },
  "Amber Studio": { accent: "255,180,84", text: "#8a7457" },
};

const FONT = "-apple-system, 'Segoe UI', sans-serif";
const MONO = "'SF Mono', Menlo, monospace";

const FLOOR = -60; // meter range in dBFS

export class StudioMonitor {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Mastering" };
    this.audio = new HifiAudio();
    this.peakL = new PeakHold(1200, 0.35);
    this.peakR = new PeakHold(1200, 0.35);
    this.curve = new Float32Array(64);
    this.corr = 0.97;
    // honest program measurements, in dB (not sensitivity-scaled)
    this.rmsDb = FLOOR;
    this.peakHoldDb = FLOOR;
    this._peakUntil = 0;
    this._t = 0;
    this._text = { rms: "−∞", peak: "−∞" };
    this._nextText = 0;
  }

  // true sample peak + RMS from the raw buffer — the numbers a real meter shows
  #measure(a, now) {
    const dt = Math.min(0.05, this._t ? (now - this._t) / 1000 : 0.016);
    this._t = now;
    let peak = 0,
      sumsq = 0;
    for (let i = 0; i < a.time.length; i++) {
      const s = (a.time[i] - 128) / 128;
      if (s > peak) peak = s;
      else if (-s > peak) peak = -s;
      sumsq += s * s;
    }
    const rmsDb = 20 * Math.log10(Math.max(Math.sqrt(sumsq / a.time.length), 1e-5));
    const peakDb = 20 * Math.log10(Math.max(peak, 1e-5));
    this.rmsDb += (Math.max(rmsDb, FLOOR) - this.rmsDb) * 0.18;
    if (peakDb >= this.peakHoldDb) {
      this.peakHoldDb = peakDb;
      this._peakUntil = now + 1500;
    } else if (now > this._peakUntil) {
      this.peakHoldDb = Math.max(Math.max(peakDb, FLOOR), this.peakHoldDb - 12 * dt); // 12 dB/s fall
    }
    // digits refresh a few times a second, like real gear — not a blur
    if (now >= this._nextText) {
      this._nextText = now + 180;
      this._text.rms = this.rmsDb <= FLOOR + 0.5 ? "−∞" : this.rmsDb.toFixed(1);
      this._text.peak = this.peakHoldDb <= FLOOR + 0.5 ? "−∞" : this.peakHoldDb.toFixed(1);
    }
    return { rmsDb: this.rmsDb, peakDb };
  }

  #panel(ctx, x, y, w, h, label, pal) {
    ctx.fillStyle = "rgba(255,255,255,0.015)";
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pal.text;
    ctx.font = `600 10px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // letterspaced label
    ctx.fillText(label.split("").join("  "), x + 12, y + 18);
  }

  render(ctx, analyser, w, h, now) {
    const pal = pickPalette(PALETTES, this.cfg.preset);
    const a = this.audio.update(analyser, this.cfg.sensitivity, now);
    this.#measure(a, now);

    const m = Math.min(w * 0.035, h * 0.06);
    const top = h * 0.1;
    const mainH = h * 0.56;
    const stripY = top + mainH + m * 0.7;
    const stripH = h * 0.16;
    const col1 = w * 0.16, col3 = w * 0.24;
    const col2 = w - col1 - col3 - m * 4;
    const x1 = m, x2 = x1 + col1 + m, x3 = x2 + col2 + m;

    // ---- L/R level meters -------------------------------------------------
    this.#panel(ctx, x1, top, col1, mainH, "LEVELS", pal);
    const bw = col1 * 0.2;
    const by0 = top + mainH * 0.12, by1 = top + mainH * 0.9;
    for (const side of [0, 1]) {
      // honest dBFS, with a subtle L/R offset from the pseudo-stereo balance
      const offset = Math.max(-1.5, Math.min(1.5, (side ? a.right - a.left : a.left - a.right) * 4));
      const sideDb = Math.max(this.rmsDb + offset, FLOOR);
      const pos = clamp01((sideDb - FLOOR) / -FLOOR);
      const peak = (side ? this.peakR : this.peakL).update(pos, now);
      const bx = x1 + col1 * (side ? 0.58 : 0.22);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(bx, by0, bw, by1 - by0);
      const g = ctx.createLinearGradient(0, by1, 0, by0);
      g.addColorStop(0, `rgba(${pal.accent},0.35)`);
      g.addColorStop(0.75, `rgba(${pal.accent},0.85)`);
      g.addColorStop(1, "rgba(235,90,70,0.95)");
      ctx.fillStyle = g;
      ctx.fillRect(bx, by1 - (by1 - by0) * pos, bw, (by1 - by0) * pos);
      // peak-hold line
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(bx, by1 - (by1 - by0) * peak - 1, bw, 2);
      ctx.fillStyle = pal.text;
      ctx.font = `600 11px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(side ? "R" : "L", bx + bw / 2, by1 + 18);
    }
    // dB ruler
    ctx.fillStyle = pal.text;
    ctx.font = `500 8px ${FONT}`;
    ctx.textAlign = "right";
    for (const db of [0, -12, -24, -36, -48, -60]) {
      const y = by1 - (by1 - by0) * ((db - FLOOR) / -FLOOR);
      ctx.fillText(`${db}`, x1 + col1 - 8, y + 3);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x1 + col1 * 0.16, y, col1 * 0.68, 1);
      ctx.fillStyle = pal.text;
    }

    // ---- frequency curve --------------------------------------------------
    this.#panel(ctx, x2, top, col2, mainH, "SPECTRUM", pal);
    const fx = x2 + 14, fw = col2 - 28;
    const fy0 = top + mainH * 0.14, fy1 = top + mainH * 0.88;
    for (let b = 0; b < 64; b++) {
      const i0 = Math.floor(Math.pow(b / 64, 1.7) * 680) + 2;
      const i1 = Math.floor(Math.pow((b + 1) / 64, 1.7) * 680) + 3;
      let sum = 0;
      for (let i = i0; i < i1; i++) sum += a.freq[i];
      const v = clamp01((sum / (i1 - i0) / 255) * (0.85 + b / 64) * this.cfg.sensitivity);
      this.curve[b] += (v - this.curve[b]) * 0.25;
    }
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (const f of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(fx, lerp(fy1, fy0, f));
      ctx.lineTo(fx + fw, lerp(fy1, fy0, f));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(fx, fy1);
    for (let b = 0; b < 64; b++) {
      const px = fx + (b / 63) * fw;
      const py = fy1 - this.curve[b] * (fy1 - fy0);
      b === 0 ? ctx.lineTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.lineTo(fx + fw, fy1);
    ctx.closePath();
    const fg = ctx.createLinearGradient(0, fy0, 0, fy1);
    fg.addColorStop(0, `rgba(${pal.accent},0.22)`);
    fg.addColorStop(1, `rgba(${pal.accent},0.02)`);
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.strokeStyle = `rgba(${pal.accent},0.85)`;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fillStyle = pal.text;
    ctx.font = `500 9px ${FONT}`;
    ctx.textAlign = "center";
    const hz = ["60", "250", "1k", "4k", "12k"];
    hz.forEach((t, i) => ctx.fillText(t, fx + fw * (0.08 + (i / 4) * 0.84), fy1 + 16));

    // ---- correlation + readouts -------------------------------------------
    this.#panel(ctx, x3, top, col3, mainH, "STEREO · PROGRAM", pal);
    // correlation: a mono source IS ~+1 — only tiny, believable dips from
    // high-frequency content, never below +0.85
    const corrTarget = a.live ? Math.max(0.85, 0.98 - a.high * 0.08 - a.spread * 0.03) : 1;
    this.corr += (corrTarget - this.corr) * 0.04;
    const sx = x3 + 20, sw = col3 - 40, sy = top + mainH * 0.24;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(sx, sy, sw, 3);
    ctx.fillStyle = pal.text;
    ctx.font = `500 9px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("−1", sx, sy + 16);
    ctx.fillText("0", sx + sw / 2, sy + 16);
    ctx.fillText("+1", sx + sw, sy + 16);
    ctx.fillText("CORRELATION", sx + sw / 2, sy - 10);
    const cxp = sx + sw * ((this.corr + 1) / 2);
    ctx.fillStyle = `rgba(${pal.accent},0.95)`;
    ctx.fillRect(cxp - 2, sy - 5, 4, 13);

    // numeric readouts: true RMS + held true-peak, refreshed at readable rate
    ctx.textAlign = "left";
    ctx.fillStyle = pal.text;
    ctx.font = `500 10px ${FONT}`;
    ctx.fillText("RMS", sx, top + mainH * 0.52);
    ctx.fillText("PEAK", sx + sw * 0.55, top + mainH * 0.52);
    ctx.fillStyle = `rgba(${pal.accent},0.95)`;
    ctx.font = `600 22px ${MONO}`;
    ctx.fillText(this._text.rms, sx, top + mainH * 0.62);
    ctx.fillText(this._text.peak, sx + sw * 0.55, top + mainH * 0.62);
    ctx.fillStyle = pal.text;
    ctx.font = `500 9px ${FONT}`;
    ctx.fillText("dBFS", sx, top + mainH * 0.68);
    ctx.fillText("dBFS", sx + sw * 0.55, top + mainH * 0.68);

    // balance: a mono feed sits near center — only a gentle drift
    const bal =
      a.left + a.right > 0.02
        ? Math.max(-0.1, Math.min(0.1, ((a.right - a.left) / (a.left + a.right)) * 0.5))
        : 0;
    const byy = top + mainH * 0.84;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(sx, byy, sw, 3);
    ctx.fillStyle = `rgba(${pal.accent},0.9)`;
    ctx.fillRect(sx + sw * ((bal + 1) / 2) - 2, byy - 4, 4, 11);
    ctx.fillStyle = pal.text;
    ctx.textAlign = "center";
    ctx.fillText("BALANCE", sx + sw / 2, byy - 8);

    // ---- waveform strip ----------------------------------------------------
    this.#panel(ctx, x1, stripY, w - m * 2, stripH, "WAVEFORM", pal);
    const wy = stripY + stripH * 0.58;
    const wamp = stripH * 0.3;
    ctx.beginPath();
    const n = 300;
    for (let k = 0; k <= n; k++) {
      let s = (a.time[Math.floor((k / n) * 2000)] - 128) / 128;
      if (!a.live) s = 0;
      const x = x1 + 14 + (k / n) * (w - m * 2 - 28);
      k === 0 ? ctx.moveTo(x, wy - s * wamp) : ctx.lineTo(x, wy - s * wamp);
    }
    ctx.strokeStyle = `rgba(${pal.accent},0.7)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}
