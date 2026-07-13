// Tube Amp — the Hi-Fi flagship: a wall-filling amplifier faceplate. Walnut
// cabinet, brushed faceplate, dual VU meters, a vent window with glowing
// vacuum tubes breathing with the music, an amber tuning-window spectrum, and
// a knob bank that eases along with the mix.
//
// Everything static (wood, plate, brush texture, meter faces, knob bodies,
// labels) is prerendered once per preset/size via withCache; the per-frame
// cost is one drawImage plus needles, tube glows, spectrum bars and lamps.

import { HifiAudio, Needle, clamp01, follow, pickPalette, makeCache, withCache } from "./shared.js";

const PALETTES = {
  Walnut: {
    woodA: "#2c1c10", woodB: "#4a2f1a", woodGrain: "rgba(20,11,5,0.5)",
    plateA: "#cfcabd", plateB: "#b3ada0", brush: "rgba(255,255,255,0.05)",
    label: "#4c463a", accent: "#8a5a2a",
    meterFaceA: "#f2e2ba", meterFaceB: "#e0c893", meterTick: "#4a3b25", meterRed: "#b8402e", needle: "#2b2118",
    windowGlass: "#160f06", spec: "255,168,60", specHi: "255,220,150",
    tube: "255,150,60", lamp: "#e0a24a", glow: "255,190,110", glowAmt: 0.5,
  },
  "Midnight Blue": {
    woodA: "#0a0a0d", woodB: "#17171d", woodGrain: "rgba(0,0,0,0.5)",
    plateA: "#14161c", plateB: "#0c0e13", brush: "rgba(160,180,220,0.04)",
    label: "#8b96b4", accent: "#3f70c4",
    meterFaceA: "#0a1e42", meterFaceB: "#061228", meterTick: "#bcd2f4", meterRed: "#58b6ff", needle: "#e8f2ff",
    windowGlass: "#050a14", spec: "90,180,255", specHi: "190,230,255",
    tube: "255,140,60", lamp: "#58b6ff", glow: "90,150,255", glowAmt: 0.30,
  },
  Champagne: {
    woodA: "#241408", woodB: "#3c2410", woodGrain: "rgba(16,8,2,0.5)",
    plateA: "#dccba2", plateB: "#c4b184", brush: "rgba(255,250,220,0.06)",
    label: "#5c4c28", accent: "#a07828",
    meterFaceA: "#f6e8c4", meterFaceB: "#e6d2a0", meterTick: "#54431f", meterRed: "#a63a24", needle: "#33260f",
    windowGlass: "#12224a", spec: "120,190,255", specHi: "210,235,255",
    tube: "255,160,70", lamp: "#e6b84a", glow: "255,205,120", glowAmt: 0.45,
  },
  "Black Silver": {
    woodA: "#0b0b0e", woodB: "#141318", woodGrain: "rgba(0,0,0,0.45)",
    plateA: "#1a1c22", plateB: "#111318", brush: "rgba(210,215,230,0.05)",
    label: "#aeb4c4", accent: "#c8ccd8",
    meterFaceA: "#e9e8e0", meterFaceB: "#d4d1c4", meterTick: "#3a3a40", meterRed: "#c03a30", needle: "#1e1e22",
    windowGlass: "#0c0d08", spec: "170,255,120", specHi: "230,255,200",
    tube: "255,145,60", lamp: "#e05545", glow: "200,210,230", glowAmt: 0.16,
  },
};

// classic VU scale: -20 .. +3 dB across an 0.82 rad half-swing
const MARKS = [-20, -10, -7, -5, -3, 0, 3];
const vuT = (db) => (db + 20) / 23;
const SWING = 0.82;
const FONT = "-apple-system, 'Segoe UI', sans-serif";

function drawVUFace(c, x, y, mw, mh, pal) {
  const r = mh * 0.1;
  c.fillStyle = "#0d0b08";
  c.beginPath();
  c.roundRect(x - mw * 0.04, y - mh * 0.06, mw * 1.08, mh * 1.12, r);
  c.fill();
  c.save();
  c.beginPath();
  c.roundRect(x, y, mw, mh, r * 0.7);
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

function drawKnobBody(c, x, y, r, pal, label) {
  c.fillStyle = "rgba(0,0,0,0.35)";
  c.beginPath();
  c.arc(x, y + r * 0.08, r * 1.04, 0, Math.PI * 2);
  c.fill();
  const g = c.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.2, x, y, r * 1.1);
  g.addColorStop(0, "#3c3e46");
  g.addColorStop(0.6, "#22242a");
  g.addColorStop(1, "#101116");
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  // knurled edge
  c.strokeStyle = "rgba(255,255,255,0.10)";
  c.lineWidth = 1;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
    c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    c.stroke();
  }
  c.fillStyle = pal.label;
  c.font = `600 ${Math.round(r * 0.42)}px ${FONT}`;
  c.textAlign = "center";
  c.textBaseline = "top";
  c.fillText(label, x, y + r * 1.22);
}

// full static faceplate; L() maps layout so face + live pass agree on geometry
function layout(w, h) {
  const f = Math.min(h * 0.075, w * 0.03); // wood frame thickness
  const px = f * 1.7, py = f * 1.55, pw = w - px * 2, ph = h - py * 2;
  // both meters must FIT the strip left of the tube vent at any aspect
  const mw0 = (pw * 0.265) / 2.14; // zone [2.5%, 29%] holds mw*1.14 + mw
  const mh = Math.min(ph * 0.5, mw0 / 1.5);
  const mw = mh * 1.5;
  const mcy = py + ph * 0.52;
  const m1x = px + pw * 0.025, m2x = m1x + mw * 1.14;
  const vent = { x: px + pw * 0.315, y: py + ph * 0.22, w: pw * 0.185, h: ph * 0.56 };
  const spec = { x: px + pw * 0.535, y: py + ph * 0.26, w: pw * 0.25, h: ph * 0.48 };
  const volR = Math.min(ph * 0.2, pw * 0.045);
  const vol = { x: px + pw * 0.845, y: mcy, r: volR };
  const small = [0, 1, 2].map((i) => ({
    x: px + pw * 0.925 + (i - 1) * volR * 0.0, // stacked column
    y: py + ph * (0.24 + i * 0.26),
    r: volR * 0.42,
  }));
  return { f, px, py, pw, ph, mh, mw, mcy, m1x, m2x, vent, spec, vol, small };
}

function drawFace(c, w, h, pal) {
  const L = layout(w, h);
  // cabinet wood
  const wg = c.createLinearGradient(0, 0, 0, h);
  wg.addColorStop(0, pal.woodB);
  wg.addColorStop(1, pal.woodA);
  c.fillStyle = wg;
  c.beginPath();
  c.roundRect(0, 0, w, h, Math.min(18, h * 0.04));
  c.fill();
  // grain streaks
  c.strokeStyle = pal.woodGrain;
  c.lineWidth = 1;
  for (let i = 0; i < 46; i++) {
    const yy = (i / 46) * h + Math.sin(i * 7.3) * 3;
    c.globalAlpha = 0.25 + ((i * 37) % 10) / 22;
    c.beginPath();
    c.moveTo(0, yy);
    for (let x = 0; x <= w; x += w / 14) c.lineTo(x, yy + Math.sin(x * 0.013 + i * 3.1) * 2.4);
    c.stroke();
  }
  c.globalAlpha = 1;

  // brushed faceplate
  c.save();
  c.beginPath();
  c.roundRect(L.px, L.py, L.pw, L.ph, Math.min(10, h * 0.02));
  const pg = c.createLinearGradient(0, L.py, 0, L.py + L.ph);
  pg.addColorStop(0, pal.plateA);
  pg.addColorStop(1, pal.plateB);
  c.fillStyle = pg;
  c.fill();
  c.clip();
  c.strokeStyle = pal.brush;
  for (let y = L.py; y < L.py + L.ph; y += 2) {
    c.globalAlpha = 0.3 + ((y * 131) % 17) / 24;
    c.beginPath();
    c.moveTo(L.px, y);
    c.lineTo(L.px + L.pw, y);
    c.stroke();
  }
  c.globalAlpha = 1;

  // badge
  c.fillStyle = pal.label;
  c.font = `700 ${Math.round(L.ph * 0.055)}px ${FONT}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("V I Z Z Y", L.px + L.pw / 2, L.py + L.ph * 0.085);
  c.font = `500 ${Math.round(L.ph * 0.036)}px ${FONT}`;
  c.globalAlpha = 0.75;
  c.fillText("TUBE  STEREO  AMPLIFIER", L.px + L.pw / 2, L.py + L.ph * 0.155);
  c.globalAlpha = 1;

  // meters
  drawVUFace(c, L.m1x, L.mcy - L.mh / 2, L.mw, L.mh, pal);
  drawVUFace(c, L.m2x, L.mcy - L.mh / 2, L.mw, L.mh, pal);
  c.fillStyle = pal.label;
  c.font = `600 ${Math.round(L.mh * 0.1)}px ${FONT}`;
  c.fillText("LEFT", L.m1x + L.mw / 2, L.mcy + L.mh * 0.66);
  c.fillText("RIGHT", L.m2x + L.mw / 2, L.mcy + L.mh * 0.66);

  // tube vent window: recessed dark slot + glass tubes (glow added live)
  const V = L.vent;
  c.fillStyle = "rgba(0,0,0,0.4)";
  c.beginPath();
  c.roundRect(V.x - 4, V.y - 4, V.w + 8, V.h + 8, 8);
  c.fill();
  c.fillStyle = "#07050a";
  c.beginPath();
  c.roundRect(V.x, V.y, V.w, V.h, 6);
  c.fill();
  for (let i = 0; i < 5; i++) {
    const tx = V.x + V.w * (0.14 + i * 0.18);
    const tw = V.w * 0.09, th = V.h * 0.62, ty = V.y + V.h * 0.3;
    c.fillStyle = "rgba(180,190,210,0.10)"; // glass envelope
    c.beginPath();
    c.roundRect(tx - tw / 2, ty, tw, th, tw / 2);
    c.fill();
    c.fillStyle = "rgba(60,62,70,0.9)"; // base socket
    c.fillRect(tx - tw * 0.7, ty + th - 3, tw * 1.4, 5);
  }
  c.fillStyle = pal.label;
  c.font = `600 ${Math.round(L.ph * 0.034)}px ${FONT}`;
  c.fillText("OUTPUT  STAGE", V.x + V.w / 2, V.y + V.h + L.ph * 0.055);

  // spectrum tuning window: tinted glass (bars added live)
  const S = L.spec;
  c.fillStyle = "rgba(0,0,0,0.4)";
  c.beginPath();
  c.roundRect(S.x - 4, S.y - 4, S.w + 8, S.h + 8, 8);
  c.fill();
  const sg = c.createLinearGradient(0, S.y, 0, S.y + S.h);
  sg.addColorStop(0, pal.windowGlass);
  sg.addColorStop(1, "#020204");
  c.fillStyle = sg;
  c.beginPath();
  c.roundRect(S.x, S.y, S.w, S.h, 6);
  c.fill();
  c.fillStyle = pal.label;
  c.fillText("SPECTRUM", S.x + S.w / 2, S.y + S.h + L.ph * 0.055);

  // knobs
  drawKnobBody(c, L.vol.x, L.vol.y, L.vol.r, pal, "VOLUME");
  const NAMES = ["BASS", "MID", "TREBLE"];
  L.small.forEach((k, i) => drawKnobBody(c, k.x, k.y, k.r, pal, NAMES[i]));

  // power lamp bed + label (lamp lit live)
  c.fillStyle = "rgba(0,0,0,0.5)";
  c.beginPath();
  c.arc(L.px + L.pw * 0.012 + 14, L.py + L.ph - 18, 7, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = pal.label;
  c.font = `600 ${Math.round(L.ph * 0.032)}px ${FONT}`;
  c.textAlign = "left";
  c.fillText("POWER", L.px + L.pw * 0.012 + 26, L.py + L.ph - 18);
  c.restore();
}

export class TubeAmp {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Walnut" };
    this.audio = new HifiAudio();
    this.needleL = new Needle(110, 13);
    this.needleR = new Needle(110, 13);
    this._face = makeCache();
    this._vol = 0.2;
    this._tone = [0, 0, 0];
    this._caps = new Float32Array(40);
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
    const V = L.vent;
    const heat = a.live ? 0.34 + a.mid * 0.5 + a.bass * 0.28 : 0.12;
    for (let i = 0; i < 5; i++) {
      const tx = V.x + V.w * (0.14 + i * 0.18);
      const ty = V.y + V.h * 0.58;
      const fl = 1 + Math.sin(now / 53 + i * 2.6) * 0.05 + Math.sin(now / 271 + i) * 0.05;
      const b = clamp01(heat * fl);
      const r = V.h * (0.2 + b * 0.16);
      const g = ctx.createRadialGradient(tx, ty, 1, tx, ty, r);
      g.addColorStop(0, `rgba(255,230,180,${0.5 * b})`);
      g.addColorStop(0.35, `rgba(${pal.tube},${0.4 * b})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(tx - r, ty - r, r * 2, r * 2);
      ctx.fillStyle = `rgba(255,225,170,${0.35 + 0.6 * b})`; // the filament itself
      ctx.fillRect(tx - 1, ty - V.h * 0.1, 2, V.h * 0.14);
    }

    // spectrum window bars with slow-falling caps
    const S = L.spec;
    const N = 40;
    const bw = S.w / N;
    for (let i = 0; i < N; i++) {
      const idx = 2 + Math.floor(Math.pow(i / N, 1.6) * 340);
      const v = clamp01((this.audio.freq[idx] / 255) * this.cfg.sensitivity * 1.15);
      const bh = v * S.h * 0.86;
      const bx = S.x + i * bw + bw * 0.2;
      if (bh > 1) {
        const g = ctx.createLinearGradient(0, S.y + S.h, 0, S.y + S.h - bh);
        g.addColorStop(0, `rgba(${pal.spec},0.85)`);
        g.addColorStop(1, `rgba(${pal.specHi},0.95)`);
        ctx.fillStyle = g;
        ctx.fillRect(bx, S.y + S.h - 3 - bh, bw * 0.6, bh);
      }
      this._caps[i] = Math.max(v, this._caps[i] - 0.008);
      ctx.fillStyle = `rgba(${pal.specHi},0.8)`;
      ctx.fillRect(bx, S.y + S.h - 4 - this._caps[i] * S.h * 0.86, bw * 0.6, 2);
    }
    // glass reflection over the live bars
    const gl = ctx.createLinearGradient(S.x, S.y, S.x + S.w * 0.5, S.y + S.h);
    gl.addColorStop(0, "rgba(255,255,255,0.07)");
    gl.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(S.x, S.y, S.w, S.h);

    // knob pointers: volume eases with overall level, tone knobs with bands
    this._vol = follow(this._vol, 0.18 + a.rms * 0.72, 0.02, 0.008);
    const drawPtr = (k, t, r) => {
      const ang = (-0.78 + t * 1.56) * Math.PI; // -140°..+140°
      ctx.strokeStyle = "#e8eaf2";
      ctx.lineWidth = Math.max(1.5, r * 0.09);
      ctx.beginPath();
      ctx.moveTo(k.x + Math.sin(ang) * r * 0.35, k.y - Math.cos(ang) * r * 0.35);
      ctx.lineTo(k.x + Math.sin(ang) * r * 0.86, k.y - Math.cos(ang) * r * 0.86);
      ctx.stroke();
    };
    drawPtr(L.vol, this._vol, L.vol.r);
    const bands = [a.bass, a.mid, a.high];
    for (let i = 0; i < 3; i++) {
      this._tone[i] = follow(this._tone[i], 0.25 + bands[i] * 0.6, 0.03, 0.012);
      drawPtr(L.small[i], this._tone[i], L.small[i].r);
    }

    // power lamp
    const lx = L.px + L.pw * 0.012 + 14, ly = L.py + L.ph - 18;
    const breathe = a.live ? 0.75 + Math.sin(now / 900) * 0.1 + a.rms * 0.15 : 0.45 + Math.sin(now / 1600) * 0.1;
    ctx.fillStyle = pal.lamp;
    ctx.globalAlpha = breathe;
    ctx.beginPath();
    ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
    ctx.fill();
    const lg = ctx.createRadialGradient(lx, ly, 1, lx, ly, 16);
    lg.addColorStop(0, pal.lamp);
    lg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lg;
    ctx.globalAlpha = breathe * 0.35;
    ctx.fillRect(lx - 16, ly - 16, 32, 32);
    ctx.globalAlpha = 1;

    // room glow off the tubes
    const glow = ctx.createRadialGradient(w / 2, h * 0.5, h * 0.2, w / 2, h * 0.5, w * 0.55);
    glow.addColorStop(0, `rgba(${pal.glow},${pal.glowAmt * 0.1 * (0.4 + a.rms)})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }
}
