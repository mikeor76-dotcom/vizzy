// Blue Power Meters — big blue-illuminated output meters behind dark glass.
// Heavier, slower needles than the VU; logarithmic watts scale so quiet
// passages still move. Inspired by classic American power amps; no branding.

import { HifiAudio, Needle, dbNorm, clamp01, pickPalette, makeCache, withCache } from "./shared.js";

const PALETTES = {
  "Classic Blue": { glow: "72,140,255", arc: "#bcd6ff", tick: "#e8f1ff", text: "#9dbcf0", needle: "#f2f6ff", glassTop: "#060a14", glassBot: "#0a1224", amt: 1.0 },
  "Dark Glass": { glow: "48,96,200", arc: "#8fb0e6", tick: "#c2d4f2", text: "#7290c4", needle: "#dbe6fa", glassTop: "#04060c", glassBot: "#070d1a", amt: 0.7 },
  Minimal: { glow: "84,120,200", arc: "#a9bede", tick: "#cdd8ec", text: "#8194b8", needle: "#e8edf8", glassTop: "#05070d", glassBot: "#080c16", amt: 0.45 },
  "Night Mode": { glow: "36,70,160", arc: "#6c88bd", tick: "#93a7cc", text: "#5b6f9a", needle: "#b9c6e2", glassTop: "#03040a", glassBot: "#050912", amt: 0.35 },
};

const WATTS = ["0.02", "0.2", "2", "20", "200"];
const SWING = 0.95;

function drawFace(c, mw, mh, pal, minimal) {
  const r = mh * 0.08;
  c.fillStyle = "#010204";
  c.beginPath();
  c.roundRect(0, 0, mw, mh, r);
  c.fill();
  const g = c.createLinearGradient(0, 0, 0, mh);
  g.addColorStop(0, pal.glassTop);
  g.addColorStop(1, pal.glassBot);
  c.fillStyle = g;
  c.beginPath();
  c.roundRect(mh * 0.03, mh * 0.03, mw - mh * 0.06, mh - mh * 0.06, r * 0.8);
  c.fill();

  const px = mw / 2, py = mh * 0.99, len = mh * 0.78;
  const t2a = (t) => -SWING + t * SWING * 2;

  // main illuminated arc
  c.strokeStyle = pal.arc;
  c.lineWidth = Math.max(1.5, mh * 0.008);
  c.beginPath();
  c.arc(px, py, len, -SWING - Math.PI / 2, SWING - Math.PI / 2);
  c.stroke();

  c.textAlign = "center";
  c.textBaseline = "middle";
  const ticks = 21;
  for (let i = 0; i < ticks; i++) {
    const t = i / (ticks - 1);
    const a = t2a(t);
    const major = i % 5 === 0;
    c.strokeStyle = pal.tick;
    c.globalAlpha = major ? 0.95 : 0.45;
    c.lineWidth = Math.max(1, mh * (major ? 0.007 : 0.004));
    const r1 = len * (major ? 0.93 : 0.955);
    c.beginPath();
    c.moveTo(px + Math.sin(a) * r1, py - Math.cos(a) * r1);
    c.lineTo(px + Math.sin(a) * len * 0.99, py - Math.cos(a) * len * 0.99);
    c.stroke();
    if (major && !minimal) {
      c.globalAlpha = 1;
      c.fillStyle = pal.text;
      c.font = `500 ${Math.round(mh * 0.048)}px -apple-system, 'Segoe UI', sans-serif`;
      const rl = len * 1.085;
      c.fillText(WATTS[i / 5], px + Math.sin(a) * rl, py - Math.cos(a) * rl);
    }
  }
  c.globalAlpha = 1;
  c.fillStyle = pal.text;
  c.font = `600 ${Math.round(mh * 0.055)}px -apple-system, 'Segoe UI', sans-serif`;
  if (!minimal) c.fillText("WATTS", px, py - len * 0.4);

  // glass reflection: soft angled sheen
  c.save();
  c.beginPath();
  c.roundRect(mh * 0.03, mh * 0.03, mw - mh * 0.06, mh - mh * 0.06, r * 0.8);
  c.clip();
  const gl = c.createLinearGradient(0, 0, mw * 0.6, mh);
  gl.addColorStop(0, "rgba(200,220,255,0.07)");
  gl.addColorStop(0.4, "rgba(200,220,255,0.015)");
  gl.addColorStop(0.55, "rgba(200,220,255,0)");
  c.fillStyle = gl;
  c.fillRect(0, 0, mw, mh);
  c.restore();
}

export class BlueMeters {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Classic Blue" };
    this.audio = new HifiAudio();
    // heavier movement: lower stiffness, more damping
    this.needleL = new Needle(58, 11);
    this.needleR = new Needle(58, 11);
    this._face = makeCache();
  }

  render(ctx, analyser, w, h, now) {
    const pal = pickPalette(PALETTES, this.cfg.preset);
    const minimal = this.cfg.preset === "Minimal";
    const a = this.audio.update(analyser, this.cfg.sensitivity, now);

    const mh = Math.min(h * 0.64, w * 0.28);
    const mw = mh * 1.7;
    const gap = Math.min(w * 0.045, mw * 0.16);
    const cy = h / 2;
    const xs = [w / 2 - mw - gap / 2, w / 2 + gap / 2];

    const face = withCache(this._face, `bpm-${this.cfg.preset}`, mw, mh, (c) =>
      drawFace(c, mw, mh, pal, minimal)
    );

    for (const side of [0, 1]) {
      const x = xs[side];
      const y = cy - mh / 2;
      const level = side ? a.right : a.left;
      // log scale so quiet music still moves, soft knee so peaks don't peg
      const target = Math.pow(dbNorm(level, -56), 1.3);
      const pos = (side ? this.needleR : this.needleL).update(target, now);

      ctx.drawImage(face, x, y, mw, mh);

      // blue illumination inside the glass, breathing with level (additive,
      // so it reads as backlight rather than a wash over the ticks)
      const px = x + mw / 2, py = y + mh * 0.99, len = mh * 0.78;
      const amt = pal.amt * (0.55 + level * 0.7);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.beginPath();
      ctx.roundRect(x + mh * 0.03, y + mh * 0.03, mw - mh * 0.06, mh - mh * 0.06, mh * 0.064);
      ctx.clip();
      const bg = ctx.createRadialGradient(px, py - len * 0.35, len * 0.05, px, py - len * 0.3, len * 1.2);
      bg.addColorStop(0, `rgba(${pal.glow},${0.30 * amt})`);
      bg.addColorStop(0.7, `rgba(${pal.glow},${0.12 * amt})`);
      bg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, mw, mh);
      ctx.restore();

      const ang = -SWING + pos * SWING * 2;
      ctx.strokeStyle = `rgba(${pal.glow},0.35)`;
      ctx.lineWidth = Math.max(3, mh * 0.02);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.sin(ang) * len * 0.99, py - Math.cos(ang) * len * 0.99);
      ctx.stroke();
      ctx.strokeStyle = pal.needle;
      ctx.lineWidth = Math.max(1.2, mh * 0.008);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.sin(ang) * len * 0.99, py - Math.cos(ang) * len * 0.99);
      ctx.stroke();

      ctx.fillStyle = pal.text;
      ctx.font = `600 ${Math.round(mh * 0.06)}px -apple-system, 'Segoe UI', sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(side ? "RIGHT" : "LEFT", x + mw * 0.07, y + mh * 0.16);
    }

    // calm ambient blue wash across the room
    const wash = ctx.createRadialGradient(w / 2, cy, mh * 0.4, w / 2, cy, w * 0.6);
    wash.addColorStop(0, `rgba(${pal.glow},${0.05 * pal.amt * (0.5 + a.rms)})`);
    wash.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
  }
}
