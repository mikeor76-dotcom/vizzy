// Oscilloscope — vintage CRT scope trace of the live waveform.
// Trigger-stabilized so the wave holds still like real lab gear; phosphor
// persistence comes from the canvas fade in main.js.
//
// SELF-NORMALIZING (like a real scope's auto-range, and like src/wave.js).
// It used `gain = 0.9 * cfg.sensitivity`, but AutoGain's "linear" profile
// solves sensitivity against the loudest FREQUENCY BIN — a different scale
// from time-domain excursion — so the trace sat at ~5% of panel height on
// ordinary music. It now tracks its own excursion peak and is `auto: null`.
// Float samples, not byte: heavy gain on 8-bit data turns its 256 levels into
// a visible staircase.

import { pickPalette, makeCache, withCache } from "./shared.js";

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
    this.cfg = { preset: "Green Phosphor" }; // no sensitivity: self-governing
    this.time = new Float32Array(2048);
    this.byte = new Uint8Array(2048); // fallback for analysers without the float API
    this.peak = 0.05; // recent excursion peak — a scope's auto-range
    this.lastNow = 0;
    this._grid = makeCache();
  }

  render(ctx, analyser, w, h, now) {
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    const pal = pickPalette(PALETTES, this.cfg.preset);
    const live = !!analyser;
    ctx.drawImage(withCache(this._grid, `scope-${this.cfg.preset}`, w, h, (c) => drawGrid(c, w, h, pal)), 0, 0, w, h);

    if (live && analyser.getFloatTimeDomainData) analyser.getFloatTimeDomainData(this.time);
    else if (live) {
      analyser.getByteTimeDomainData(this.byte);
      for (let i = 0; i < this.byte.length; i++) this.time[i] = (this.byte[i] - 128) / 128;
    }
    const t = this.time;

    // auto-range on the EXCURSION: fast attack shows a transient instantly,
    // slow release keeps the trace from pumping between beats
    let maxExc = 0;
    if (live) for (let i = 0; i < t.length; i += 2) {
      const e = Math.abs(t[i]);
      if (e > maxExc) maxExc = e;
    }
    this.peak = maxExc > this.peak ? this.peak + (maxExc - this.peak) * 0.35 : Math.max(0.015, this.peak * (1 - dt * 0.22));
    const gain = Math.min(30, 0.8 / Math.max(0.015, this.peak));

    const cy = h / 2;
    const amp = h * 0.42;

    // trigger: first rising zero-crossing keeps the trace steady
    let trig = 0;
    for (let i = 1; i < 900; i++) {
      if (t[i - 1] < 0 && t[i] >= 0) {
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
        let s;
        if (!live) s = Math.sin(k * 0.06 + now / 300) * 0.06; // faint idle hum
        else {
          const e = Math.min(1, Math.max(-1, t[i] * gain));
          s = Math.sign(e) * Math.pow(Math.abs(e), 0.7); // soft knee lifts the mids
        }
        const y = cy - s * amp;
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
