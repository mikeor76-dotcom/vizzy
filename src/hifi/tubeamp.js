// Tube Amp — pure instruments, edge to edge. This mode renders INSIDE a real
// hardware enclosure, so there is deliberately no case art: no cabinet, no
// faceplate, no knobs, no branding. Just the components — two big VU meters,
// a bank of vacuum tubes breathing with the music, and a spectrum window —
// floating on darkness, as if looking through the front panel of an amp.
//
// Meter faces and tube glass are prerendered once per preset/size via
// withCache; the per-frame cost is one drawImage plus needles, tube glows,
// spectrum bars and a room glow.

import { HifiAudio, Needle, clamp01, pickPalette, makeCache, withCache } from "./shared.js";

const PALETTES = {
  Walnut: {
    bg: "#0a0806",
    meterFaceA: "#f2e2ba", meterFaceB: "#e0c893", meterTick: "#4a3b25", meterRed: "#b8402e", needle: "#2b2118",
    windowGlass: "#160f06", spec: "255,168,60", specHi: "255,220,150",
    tube: "255,150,60", glow: "255,190,110", glowAmt: 0.5,
  },
  "Midnight Blue": {
    bg: "#04050a",
    meterFaceA: "#0a1e42", meterFaceB: "#061228", meterTick: "#bcd2f4", meterRed: "#58b6ff", needle: "#e8f2ff",
    windowGlass: "#050a14", spec: "90,180,255", specHi: "190,230,255",
    tube: "255,140,60", glow: "90,150,255", glowAmt: 0.30,
  },
  Champagne: {
    bg: "#0a0704",
    meterFaceA: "#f6e8c4", meterFaceB: "#e6d2a0", meterTick: "#54431f", meterRed: "#a63a24", needle: "#33260f",
    windowGlass: "#12224a", spec: "120,190,255", specHi: "210,235,255",
    tube: "255,160,70", glow: "255,205,120", glowAmt: 0.45,
  },
  "Black Silver": {
    bg: "#060608",
    meterFaceA: "#e9e8e0", meterFaceB: "#d4d1c4", meterTick: "#3a3a40", meterRed: "#c03a30", needle: "#1e1e22",
    windowGlass: "#0c0d08", spec: "170,255,120", specHi: "230,255,200",
    tube: "255,145,60", glow: "200,210,230", glowAmt: 0.16,
  },
};

// classic VU scale: -20 .. +3 dB across an 0.82 rad half-swing
const MARKS = [-20, -10, -7, -5, -3, 0, 3];
const vuT = (db) => (db + 20) / 23;
const SWING = 0.82;
const FONT = "-apple-system, 'Segoe UI', sans-serif";

function drawVUFace(c, x, y, mw, mh, pal) {
  const r = mh * 0.08;
  // the meter's own housing — an instrument has a bezel even without a case
  c.fillStyle = "#0d0b08";
  c.beginPath();
  c.roundRect(x - mw * 0.035, y - mh * 0.05, mw * 1.07, mh * 1.1, r);
  c.fill();
  c.save();
  c.beginPath();
  c.roundRect(x, y, mw, mh, r * 0.8);
  c.clip();
  const g = c.createLinearGradient(0, y, 0, y + mh);
  g.addColorStop(0, pal.meterFaceA);
  g.addColorStop(1, pal.meterFaceB);
  c.fillStyle = g;
  c.fillRect(x, y, mw, mh);
  const px = x + mw / 2, py = y + mh * 0.95, len = mh * 0.7;
  const bl = c.createRadialGradient(px, py, len * 0.1, px, py, len * 1.3);
  bl.addColorStop(0, `rgba(${pal.glow},${pal.glowAmt * 0.5})`);
  bl.addColorStop(1, "rgba(0,0,0,0.12)");
  c.fillStyle = bl;
  c.fillRect(x, y, mw, mh);

  const t2a = (t) => -SWING + t * SWING * 2;
  c.strokeStyle = pal.meterTick;
  c.lineWidth = Math.max(1, mh * 0.01);
  c.beginPath();
  c.arc(px, py, len, -SWING - Math.PI / 2, t2a(vuT(0)) - Math.PI / 2);
  c.stroke();
  c.strokeStyle = pal.meterRed;
  c.lineWidth = Math.max(1.5, mh * 0.018);
  c.beginPath();
  c.arc(px, py, len, t2a(vuT(0)) - Math.PI / 2, SWING - Math.PI / 2);
  c.stroke();
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (const db of MARKS) {
    const a = t2a(vuT(db));
    c.strokeStyle = db >= 0 ? pal.meterRed : pal.meterTick;
    c.lineWidth = Math.max(1, mh * 0.01);
    c.beginPath();
    c.moveTo(px + Math.sin(a) * len * 0.93, py - Math.cos(a) * len * 0.93);
    c.lineTo(px + Math.sin(a) * len * 1.03, py - Math.cos(a) * len * 1.03);
    c.stroke();
    c.fillStyle = db >= 0 ? pal.meterRed : pal.meterTick;
    c.font = `600 ${Math.round(mh * 0.075)}px ${FONT}`;
    c.fillText(db > 0 ? `+${db}` : `${Math.abs(db)}`, px + Math.sin(a) * len * 1.14, py - Math.cos(a) * len * 1.14);
  }
  c.fillStyle = pal.meterTick;
  c.font = `700 ${Math.round(mh * 0.14)}px ${FONT}`;
  c.fillText("VU", px, py - len * 0.4);
  const gl = c.createLinearGradient(x, y, x + mw * 0.7, y + mh);
  gl.addColorStop(0, "rgba(255,255,255,0.10)");
  gl.addColorStop(0.4, "rgba(255,255,255,0.02)");
  gl.addColorStop(0.55, "rgba(255,255,255,0)");
  c.fillStyle = gl;
  c.fillRect(x, y, mw, mh);
  c.restore();
}

// zones: meters left ~38%, tube bank center ~22%, spectrum right ~36%
function layout(w, h) {
  const pad = Math.min(h * 0.08, w * 0.02);
  const mw0 = (w * 0.36 - pad) / 2.08; // two meters + inner gap fit the left zone
  const mh = Math.min(h * 0.66, mw0 / 1.45);
  const mw = mh * 1.45;
  const mcy = h * 0.5;
  const m1x = pad, m2x = m1x + mw * 1.08;
  const tubes = { x: w * 0.40, y: h * 0.14, w: w * 0.22, h: h * 0.72, n: 5 };
  const spec = { x: w * 0.645, y: h * 0.17, w: w - pad - w * 0.645, h: h * 0.66 };
  return { pad, mh, mw, mcy, m1x, m2x, tubes, spec };
}

function drawFace(c, w, h, pal) {
  const L = layout(w, h);
  // darkness, faintly warmer at center — the inside of an enclosure
  const bg = c.createRadialGradient(w / 2, h * 0.55, h * 0.2, w / 2, h * 0.55, w * 0.6);
  bg.addColorStop(0, pal.bg);
  bg.addColorStop(1, "#020202");
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);

  drawVUFace(c, L.m1x, L.mcy - L.mh / 2, L.mw, L.mh, pal);
  drawVUFace(c, L.m2x, L.mcy - L.mh / 2, L.mw, L.mh, pal);

  // tube bank: glass envelopes + sockets on darkness (glow added live)
  const T = L.tubes;
  for (let i = 0; i < T.n; i++) {
    const tx = T.x + T.w * ((i + 0.5) / T.n);
    const tw = T.w * 0.11, th = T.h * 0.74, ty = T.y + T.h * 0.16;
    const gg = c.createLinearGradient(tx - tw / 2, 0, tx + tw / 2, 0);
    gg.addColorStop(0, "rgba(150,160,185,0.05)");
    gg.addColorStop(0.3, "rgba(200,210,235,0.13)");
    gg.addColorStop(0.5, "rgba(150,160,185,0.05)");
    gg.addColorStop(1, "rgba(120,130,155,0.03)");
    c.fillStyle = gg;
    c.beginPath();
    c.roundRect(tx - tw / 2, ty, tw, th, tw / 2);
    c.fill();
    c.strokeStyle = "rgba(200,210,235,0.10)";
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(tx - tw / 2, ty, tw, th, tw / 2);
    c.stroke();
    c.fillStyle = "#1c1d24"; // socket
    c.beginPath();
    c.roundRect(tx - tw * 0.75, ty + th - 2, tw * 1.5, Math.max(4, T.h * 0.035), 2);
    c.fill();
  }

  // spectrum glass: a recessed dark window, no bright frame
  const S = L.spec;
  const sg = c.createLinearGradient(0, S.y, 0, S.y + S.h);
  sg.addColorStop(0, pal.windowGlass);
  sg.addColorStop(1, "#020204");
  c.fillStyle = sg;
  c.beginPath();
  c.roundRect(S.x, S.y, S.w, S.h, 8);
  c.fill();
  c.strokeStyle = "rgba(255,255,255,0.05)";
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect(S.x, S.y, S.w, S.h, 8);
  c.stroke();
}

export class TubeAmp {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Walnut" };
    this.audio = new HifiAudio();
    this.needleL = new Needle(110, 13);
    this.needleR = new Needle(110, 13);
    this._face = makeCache();
    this._caps = new Float32Array(48);
  }

  render(ctx, analyser, w, h, now) {
    const pal = pickPalette(PALETTES, this.cfg.preset);
    const a = this.audio.update(analyser, this.cfg.sensitivity, now);
    const L = layout(w, h);
    ctx.drawImage(withCache(this._face, `amp-${this.cfg.preset}`, w, h, (c) => drawFace(c, w, h, pal)), 0, 0, w, h);

    // needles
    for (const side of [0, 1]) {
      const x = side ? L.m2x : L.m1x, y = L.mcy - L.mh / 2;
      const level = side ? a.right : a.left;
      const db = 20 * Math.log10(Math.max(level, 1e-4));
      const pos = (side ? this.needleR : this.needleL).update(clamp01((db + 20) / 23), now);
      const ang = -SWING + pos * SWING * 2;
      const px = x + L.mw / 2, py = y + L.mh * 0.95, len = L.mh * 0.7;
      ctx.strokeStyle = pal.needle;
      ctx.lineWidth = Math.max(1.5, L.mh * 0.015);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.sin(ang) * len * 1.02, py - Math.cos(ang) * len * 1.02);
      ctx.stroke();
      ctx.fillStyle = "#0d0b08";
      ctx.beginPath();
      ctx.arc(px, py, L.mh * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }

    // tubes: warm filaments breathing with the mids, surging on bass
    const T = L.tubes;
    const heat = a.live ? 0.34 + a.mid * 0.5 + a.bass * 0.28 : 0.12;
    for (let i = 0; i < T.n; i++) {
      const tx = T.x + T.w * ((i + 0.5) / T.n);
      const ty = T.y + T.h * 0.55;
      const fl = 1 + Math.sin(now / 53 + i * 2.6) * 0.05 + Math.sin(now / 271 + i) * 0.05;
      const b = clamp01(heat * fl);
      const r = T.h * (0.22 + b * 0.18);
      const g = ctx.createRadialGradient(tx, ty, 1, tx, ty, r);
      g.addColorStop(0, `rgba(255,230,180,${0.5 * b})`);
      g.addColorStop(0.35, `rgba(${pal.tube},${0.4 * b})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(tx - r, ty - r, r * 2, r * 2);
      ctx.fillStyle = `rgba(255,225,170,${0.35 + 0.6 * b})`; // the filament itself
      ctx.fillRect(tx - 1.5, ty - T.h * 0.12, 3, T.h * 0.17);
    }

    // spectrum bars with slow-falling caps
    const S = L.spec;
    const N = 48;
    const bw = S.w / N;
    for (let i = 0; i < N; i++) {
      const idx = 2 + Math.floor(Math.pow(i / N, 1.6) * 340);
      const v = clamp01((this.audio.freq[idx] / 255) * this.cfg.sensitivity * 1.15);
      const bh = v * S.h * 0.88;
      const bx = S.x + i * bw + bw * 0.2;
      if (bh > 1) {
        const g = ctx.createLinearGradient(0, S.y + S.h, 0, S.y + S.h - bh);
        g.addColorStop(0, `rgba(${pal.spec},0.85)`);
        g.addColorStop(1, `rgba(${pal.specHi},0.95)`);
        ctx.fillStyle = g;
        ctx.fillRect(bx, S.y + S.h - 4 - bh, bw * 0.6, bh);
      }
      this._caps[i] = Math.max(v, this._caps[i] - 0.008);
      ctx.fillStyle = `rgba(${pal.specHi},0.8)`;
      ctx.fillRect(bx, S.y + S.h - 5 - this._caps[i] * S.h * 0.88, bw * 0.6, 2);
    }
    // glass reflection over the live bars
    const gl = ctx.createLinearGradient(S.x, S.y, S.x + S.w * 0.5, S.y + S.h);
    gl.addColorStop(0, "rgba(255,255,255,0.06)");
    gl.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(S.x, S.y, S.w, S.h);

    // room glow off the tubes
    const glow = ctx.createRadialGradient(w / 2, h * 0.5, h * 0.2, w / 2, h * 0.5, w * 0.55);
    glow.addColorStop(0, `rgba(${pal.glow},${pal.glowAmt * 0.1 * (0.4 + a.rms)})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }
}
