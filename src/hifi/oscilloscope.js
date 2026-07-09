// Oscilloscope — vintage CRT scope trace of the live waveform.
// Trigger-stabilized so the wave holds still like real lab gear; phosphor
// persistence comes from the canvas fade in main.js.

import { HifiAudio, pickPalette, makeCache, withCache } from "./shared.js";

const PALETTES = {
  "Green Phosphor": { trace: "70,255,150", grid: "110,200,150", text: "#3f8f63" },
  "Amber Trace": { trace: "255,181,69", grid: "220,170,110", text: "#a3763a" },
  "Blue Trace": { trace: "96,180,255", grid: "120,170,230", text: "#4a7bb0" },
  "White Studio": { trace: "232,238,242", grid: "180,190,205", text: "#8b939f" },
};

function drawGrid(c, w, h, pal) {
  const cols = 12, rows = 8;
  c.strokeStyle = `rgba(${pal.grid},0.10)`;
  c.lineWidth = 1;
  for (let i = 1; i < cols; i++) {
    const x = (w * i) / cols;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h);
    c.stroke();
  }
  for (let j = 1; j < rows; j++) {
    const y = (h * j) / rows;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }
  // brighter center axes with fine ticks
  c.strokeStyle = `rgba(${pal.grid},0.22)`;
  c.beginPath();
  c.moveTo(0, h / 2);
  c.lineTo(w, h / 2);
  c.moveTo(w / 2, 0);
  c.lineTo(w / 2, h);
  c.stroke();
  for (let x = 0; x < w; x += w / cols / 5) {
    c.beginPath();
    c.moveTo(x, h / 2 - 3);
    c.lineTo(x, h / 2 + 3);
    c.stroke();
  }
  // CRT vignette
  const v = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.55)");
  c.fillStyle = v;
  c.fillRect(0, 0, w, h);
  c.fillStyle = pal.text;
  c.font = "500 11px -apple-system, 'Segoe UI', sans-serif";
  c.textAlign = "left";
  c.fillText("CH 1 · 10 ms/div", 16, h - 14);
}

export class Oscilloscope {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Green Phosphor" };
    this.audio = new HifiAudio();
    this._grid = makeCache();
  }

  render(ctx, analyser, w, h, now) {
    const pal = pickPalette(PALETTES, this.cfg.preset);
    const a = this.audio.update(analyser, this.cfg.sensitivity, now);
    ctx.drawImage(withCache(this._grid, `scope-${this.cfg.preset}`, w, h, (c) => drawGrid(c, w, h, pal)), 0, 0, w, h);

    const t = a.time;
    const gain = 0.9 * this.cfg.sensitivity;
    const cy = h / 2;
    const amp = h * 0.36;

    // trigger: first rising zero-crossing keeps the trace steady
    let trig = 0;
    for (let i = 1; i < 900; i++) {
      if (t[i - 1] < 128 && t[i] >= 128) {
        trig = i;
        break;
      }
    }
    const span = 1024;
    const n = Math.min(480, w);

    const path = () => {
      ctx.beginPath();
      for (let k = 0; k <= n; k++) {
        const i = trig + Math.floor((k / n) * span);
        let s = (t[i] - 128) / 128;
        if (!a.live) s = Math.sin(k * 0.06 + now / 300) * 0.006; // faint idle hum
        const y = cy - s * amp * gain;
        const x = (k / n) * w;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };

    // two-pass glow (no shadowBlur — cheap on the Pi)
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(${pal.trace},0.16)`;
    ctx.lineWidth = 7;
    path();
    ctx.stroke();
    ctx.strokeStyle = `rgba(${pal.trace},0.95)`;
    ctx.lineWidth = 1.8;
    path();
    ctx.stroke();
  }
}
