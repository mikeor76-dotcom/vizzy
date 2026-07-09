// Analog VU — dual warm-backlit analog VU meters on a dark faceplate.
// Face artwork is prerendered; per-frame work is drawImage + needle.

import { HifiAudio, Needle, clamp01, lerp, pickPalette, makeCache, withCache } from "./shared.js";

const PALETTES = {
  Warm: {
    bezel: "#161209",
    faceTop: "#f4e4bc",
    faceBot: "#e3cb96",
    tick: "#4a3b25",
    label: "#5d4b2e",
    red: "#b8402e",
    needle: "#2b2118",
    glow: "255,196,110",
    glowAmt: 0.5,
  },
  Studio: {
    bezel: "#101013",
    faceTop: "#ecebe3",
    faceBot: "#d8d5c8",
    tick: "#3a3a40",
    label: "#4c4c54",
    red: "#c03a30",
    needle: "#1e1e22",
    glow: "235,235,225",
    glowAmt: 0.22,
  },
  Vintage: {
    bezel: "#1a1208",
    faceTop: "#e6d09c",
    faceBot: "#c6a76e",
    tick: "#54401f",
    label: "#63512a",
    red: "#a63a24",
    needle: "#33260f",
    glow: "255,176,84",
    glowAmt: 0.65,
  },
  Minimal: {
    bezel: "#0c0c10",
    faceTop: "#181a20",
    faceBot: "#101218",
    tick: "#9098ac",
    label: "#7a8296",
    red: "#e05545",
    needle: "#e6eaf4",
    glow: "120,132,164",
    glowAmt: 0.18,
  },
};

// standard VU scale: -20 .. +3 dB
const MARKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
const LABELED = new Set([-20, -10, -7, -5, -3, 0, 3]);
const vuT = (db) => (db + 20) / 23;
const SWING = 0.82; // half-angle of needle sweep in radians

function drawFace(c, mw, mh, pal) {
  const r = mh * 0.1;
  // bezel
  c.fillStyle = pal.bezel;
  c.beginPath();
  c.roundRect(0, 0, mw, mh, r);
  c.fill();
  // face window
  const inset = mh * 0.06;
  const fx = inset, fy = inset, fw = mw - inset * 2, fh = mh - inset * 2;
  c.save();
  c.beginPath();
  c.roundRect(fx, fy, fw, fh, r * 0.6);
  c.clip();
  const g = c.createLinearGradient(0, fy, 0, fy + fh);
  g.addColorStop(0, pal.faceTop);
  g.addColorStop(1, pal.faceBot);
  c.fillStyle = g;
  c.fillRect(fx, fy, fw, fh);
  // warm backlight pooling at the bottom center
  const px = mw / 2, py = mh * 0.94, len = mh * 0.72;
  const bl = c.createRadialGradient(px, py, len * 0.1, px, py, len * 1.25);
  bl.addColorStop(0, `rgba(${pal.glow},${pal.glowAmt * 0.55})`);
  bl.addColorStop(1, "rgba(0,0,0,0.14)");
  c.fillStyle = bl;
  c.fillRect(fx, fy, fw, fh);

  // arc + ticks
  const t2a = (t) => -SWING + t * SWING * 2;
  c.strokeStyle = pal.tick;
  c.lineWidth = Math.max(1, mh * 0.008);
  c.beginPath();
  c.arc(px, py, len, -SWING - Math.PI / 2, vuT(0) * 2 * SWING - SWING - Math.PI / 2);
  c.stroke();
  c.strokeStyle = pal.red;
  c.lineWidth = Math.max(1.5, mh * 0.014);
  c.beginPath();
  c.arc(px, py, len, vuT(0) * 2 * SWING - SWING - Math.PI / 2, SWING - Math.PI / 2);
  c.stroke();

  c.textAlign = "center";
  c.textBaseline = "middle";
  for (const db of MARKS) {
    const a = t2a(vuT(db));
    const major = LABELED.has(db);
    const r1 = len * (major ? 0.94 : 0.965);
    const r2 = len * 1.03;
    c.strokeStyle = db >= 0 ? pal.red : pal.tick;
    c.lineWidth = Math.max(1, mh * (major ? 0.008 : 0.005));
    c.beginPath();
    c.moveTo(px + Math.sin(a) * r1, py - Math.cos(a) * r1);
    c.lineTo(px + Math.sin(a) * r2, py - Math.cos(a) * r2);
    c.stroke();
    if (major) {
      c.fillStyle = db >= 0 ? pal.red : pal.label;
      c.font = `600 ${Math.round(mh * 0.055)}px -apple-system, 'Segoe UI', sans-serif`;
      const rl = len * 1.12;
      c.fillText(db > 0 ? `+${db}` : `${Math.abs(db)}`, px + Math.sin(a) * rl, py - Math.cos(a) * rl);
    }
  }
  c.fillStyle = pal.label;
  c.font = `700 ${Math.round(mh * 0.11)}px -apple-system, 'Segoe UI', sans-serif`;
  c.fillText("VU", px, py - len * 0.42);

  // glass: diagonal highlight band
  const gl = c.createLinearGradient(fx, fy, fx + fw * 0.7, fy + fh);
  gl.addColorStop(0, "rgba(255,255,255,0.10)");
  gl.addColorStop(0.35, "rgba(255,255,255,0.02)");
  gl.addColorStop(0.5, "rgba(255,255,255,0)");
  c.fillStyle = gl;
  c.fillRect(fx, fy, fw, fh);
  c.restore();
}

export class AnalogVU {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Warm" };
    this.audio = new HifiAudio();
    this.needleL = new Needle(110, 13);
    this.needleR = new Needle(110, 13);
    this._faceL = makeCache();
    this._faceR = makeCache();
  }

  render(ctx, analyser, w, h, now) {
    const pal = pickPalette(PALETTES, this.cfg.preset);
    const a = this.audio.update(analyser, this.cfg.sensitivity, now);

    const mh = Math.min(h * 0.6, w * 0.27);
    const mw = mh * 1.6;
    const gap = Math.min(w * 0.05, mw * 0.2);
    const cy = h / 2;
    const leftX = w / 2 - mw - gap / 2;
    const rightX = w / 2 + gap / 2;

    const face = withCache(this._faceL, `vu-${this.cfg.preset}`, mw, mh, (c) => drawFace(c, mw, mh, pal));

    for (const side of [0, 1]) {
      const x = side ? rightX : leftX;
      const y = cy - mh / 2;
      ctx.drawImage(face, x, y, mw, mh);

      // needle: VU ballistics on the smoothed channel level
      const level = side ? a.right : a.left;
      const db = 20 * Math.log10(Math.max(level, 1e-4));
      const target = clamp01((db + 20) / 23);
      const pos = (side ? this.needleR : this.needleL).update(target, now);
      const ang = -SWING + pos * SWING * 2;
      const px = x + mw / 2, py = y + mh * 0.94, len = mh * 0.72;

      ctx.strokeStyle = pal.needle;
      ctx.lineWidth = Math.max(1.5, mh * 0.012);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.sin(ang) * len * 1.02, py - Math.cos(ang) * len * 1.02);
      ctx.stroke();
      // hub
      ctx.fillStyle = pal.bezel;
      ctx.beginPath();
      ctx.arc(px, py, mh * 0.05, 0, Math.PI * 2);
      ctx.fill();

      // peak lamp: lights past 0 VU
      const hot = clamp01((pos - vuT(0)) / (1 - vuT(0)));
      const lx = x + mw * 0.88, ly = y + mh * 0.2;
      ctx.fillStyle = hot > 0.02 ? `rgba(235,70,50,${0.35 + hot * 0.65})` : "rgba(60,25,20,0.55)";
      ctx.beginPath();
      ctx.arc(lx, ly, mh * 0.022, 0, Math.PI * 2);
      ctx.fill();

      // L / R badge
      ctx.fillStyle = pal.label;
      ctx.font = `700 ${Math.round(mh * 0.07)}px -apple-system, 'Segoe UI', sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(side ? "R" : "L", x + mw * 0.09, y + mh * 0.2);
    }

    // whole-room warm glow that breathes with level
    const glow = ctx.createRadialGradient(w / 2, cy, mh * 0.3, w / 2, cy, w * 0.55);
    glow.addColorStop(0, `rgba(${pal.glow},${pal.glowAmt * 0.12 * (0.4 + a.rms)})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }
}
