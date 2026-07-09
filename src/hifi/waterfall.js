// Waterfall — ridgeline spectrogram: the live spectrum in front, history
// receding toward a horizon behind it. Capped ring buffer (52 rows × 72
// bands ≈ 15 KB) keeps it Raspberry Pi friendly.

import { HifiAudio, clamp01, lerp, pickPalette } from "./shared.js";

const PALETTES = {
  "Studio Blue": { front: "110,180,255", back: "40,80,160", fill: "6,10,18" },
  "Amber Heat": { front: "255,190,100", back: "180,90,40", fill: "14,9,5" },
  Monochrome: { front: "230,234,240", back: "110,115,125", fill: "8,9,11" },
  "Deep Space": { front: "180,140,255", back: "70,50,150", fill: "9,7,16" },
};

const BANDS = 72;
const ROWS = 52;

export class Waterfall {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Studio Blue" };
    this.audio = new HifiAudio();
    this.buf = new Float32Array(ROWS * BANDS);
    this.head = 0; // index of newest row
    this.row = new Float32Array(BANDS); // live row, ema-smoothed
    this._tmp = new Float32Array(BANDS);
    this._nextPush = 0;
  }

  #sampleBands(freq) {
    // log-ish grouping so bass/mid/high all get readable space
    for (let b = 0; b < BANDS; b++) {
      const i0 = Math.floor(Math.pow(b / BANDS, 1.6) * 680) + 2;
      const i1 = Math.floor(Math.pow((b + 1) / BANDS, 1.6) * 680) + 3;
      let sum = 0;
      for (let i = i0; i < i1; i++) sum += freq[i];
      const v = clamp01(((sum / (i1 - i0) / 255) * (0.9 + b / BANDS)) * this.cfg.sensitivity);
      this._tmp[b] = v;
    }
    // light spatial blur: ridges instead of needles
    for (let b = 0; b < BANDS; b++) {
      const l = this._tmp[Math.max(0, b - 1)];
      const r = this._tmp[Math.min(BANDS - 1, b + 1)];
      const v = l * 0.25 + this._tmp[b] * 0.5 + r * 0.25;
      this.row[b] += (v - this.row[b]) * 0.38;
    }
  }

  render(ctx, analyser, w, h, now) {
    const pal = pickPalette(PALETTES, this.cfg.preset);
    const a = this.audio.update(analyser, this.cfg.sensitivity, now);
    this.#sampleBands(a.freq);

    // history advances every 55 ms → ~2.9 s visible, calm motion
    if (now >= this._nextPush) {
      this._nextPush = now + 55;
      this.head = (this.head + 1) % ROWS;
      this.buf.set(this.row, this.head * BANDS);
    }

    const yFront = h * 0.88;
    const yBack = h * 0.3;
    const hFront = h * 0.36;
    const hBack = h * 0.08;

    // draw oldest → newest so near ridges occlude far ones
    for (let age = ROWS - 1; age >= 0; age--) {
      const r = ((this.head - age) % ROWS + ROWS) % ROWS;
      const row = age === 0 ? this.row : this.buf.subarray(r * BANDS, r * BANDS + BANDS);
      const t = age / ROWS; // 0 = front
      const p = Math.pow(t, 0.85);
      const y = lerp(yFront, yBack, p);
      const inset = lerp(w * 0.04, w * 0.23, p);
      const width = w - inset * 2;
      const scaleH = lerp(hFront, hBack, p);

      ctx.beginPath();
      ctx.moveTo(inset, y);
      for (let b = 0; b < BANDS; b++) {
        ctx.lineTo(inset + (b / (BANDS - 1)) * width, y - row[b] * scaleH);
      }
      ctx.lineTo(inset + width, y);
      ctx.closePath();
      // opaque-ish fill hides the ridges behind — the 3D landscape effect
      ctx.fillStyle = `rgba(${pal.fill},0.94)`;
      ctx.fill();
      const cr = [
        Math.round(lerp(+pal.front.split(",")[0], +pal.back.split(",")[0], p)),
        Math.round(lerp(+pal.front.split(",")[1], +pal.back.split(",")[1], p)),
        Math.round(lerp(+pal.front.split(",")[2], +pal.back.split(",")[2], p)),
      ];
      ctx.strokeStyle = `rgba(${cr.join(",")},${lerp(0.9, 0.1, p)})`;
      ctx.lineWidth = age === 0 ? 1.8 : 1;
      ctx.stroke();
    }

    // soft light under the live ridge
    const glow = ctx.createLinearGradient(0, yFront - hFront, 0, yFront);
    glow.addColorStop(0, "rgba(0,0,0,0)");
    glow.addColorStop(1, `rgba(${pal.front},${0.06 + a.rms * 0.08})`);
    ctx.fillStyle = glow;
    ctx.fillRect(w * 0.04, yFront - hFront, w * 0.92, hFront);
  }
}
