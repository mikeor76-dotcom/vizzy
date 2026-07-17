// Cymatics — sand on a vibrating plate. Real standing-wave physics: thousands
// of grains random-walk with step size proportional to the local field
// amplitude, so they jitter off antinodes and come to rest on nodal lines —
// exactly why real sand forms Chladni figures. The pattern is never drawn;
// it ASSEMBLES, and watching it assemble is the mode.
//
// The field is a superposition of rectangular-plate modes chosen by pitch:
// the dominant spectral peak (semitone-quantized, with hold-time hysteresis so
// melodic flutter can't thrash the plate) picks the primary (M,N) mode, the
// 2nd/3rd peaks superpose weaker ones. A kick taps the plate (local scatter +
// flash); a drop re-scatters every grain and the new figure forms out of the
// chaos — the signature moment. Silence freezes everything: the last figure
// holds, museum-still, breathing an 8-second glow.
//
// ASPECT CORRECTION: classic Chladni figures live on square plates. This
// panel is 4:1, so modes are computed in "square units" — the plate is four
// unit squares side by side: F = cos(4Mπu)cos(Nπv) − cos(4Nπu)cos(Mπv).
// That keeps every cell near-square (real figures, not smeared ellipses) and
// satisfies the free-edge boundary at both ends.
//
// The field lives on a coarse grid (97x25), recomputed ONLY on retarget;
// grains bilinear-sample |F| and take the gradient from the same grid.

import { SilenceGate, EnergyJump } from "./silencegate.js";
import { hiResOf } from "./chroma.js";

// mode ladder, coarse -> fine; pitch height selects the rung. Unordered pairs
// only ({M,N} and {N,M} give the same |field|), M != N always (M == N is
// identically zero — the classic degenerate pair).
const LADDER = [
  [1, 2], [1, 3], [2, 3], [1, 4], [2, 4], [3, 4], [1, 5], [2, 5],
  [3, 5], [2, 6], [4, 5], [3, 6], [4, 6], [5, 6], [4, 7], [5, 7],
];
const MIDI_LO = 33, MIDI_SPAN = 60; // A1..A6 mapped across the ladder
const GW = 97, GH = 25;

// feel dials (the bench's formation half-life is the meter for these):
const JIT = 3.6; // px/frame @60: jitter amplitude at a full-agitation antinode
const DRIFT = 110; // px/frame per unit |F|-gradient: the settle bias
const TAP_R = 180, TAP_AMP = 230; // plate-tap scatter radius / impulse
const RUP_AMP = 380; // rupture: every grain gets a kick of this order

const PALETTES = {
  "Gold Sand": [255, 214, 150],
  "Iron Filings": [186, 206, 226],
  "Neon Cyan": [110, 240, 255],
  Ember: [255, 142, 84],
};

export function rungOfMidi(midi) {
  const r = Math.round(((midi - MIDI_LO) / MIDI_SPAN) * (LADDER.length - 1));
  return Math.max(0, Math.min(LADDER.length - 1, r));
}

export class Cymatics {
  constructor() {
    this.cfg = { preset: "Gold Sand" }; // self-governing: gate + own ranging
    this.gate = new SilenceGate();
    this.n = 10000;
    this._act = this.n; // auto-quality: active grain count
    this.px = new Float32Array(this.n);
    this.py = new Float32Array(this.n);
    this.vx = new Float32Array(this.n);
    this.vy = new Float32Array(this.n);
    this._seeded = false;

    this.fld = new Float32Array(GW * GH); // |F| normalized 0..1
    this.gxA = new Float32Array(GW * GH); // d|F|/dx (per px)
    this.gyA = new Float32Array(GW * GH);
    this.rung = -1;
    this._candRung = -1;
    this._candFor = 0;

    // bench ground truth
    this.retargets = 0;
    this.taps = 0;
    this.ruptures = 0;

    this.agitation = 0;
    this._boost = 0;
    this.energy = 0;
    this.visE = 0;
    this._eLo = 0.35;
    this._eHi = 0.65;
    this._loudPeak = 0.05;
    this._prevBass = 0;
    this._bassPeak = 0.04;
    this._sinceTap = 9;
    this.jump = new EnergyJump({ cooldown: 5 });
    this.flash = 0;

    this.freq = new Uint8Array(1024);
    this._hf = null; // float spectrum scratch (hi-res)
    this._med = null;
    this.t = 0;
    this.lastNow = 0;
    this.ms = 0;
    this._slowFor = 0;
    this._plate = null;
    this._plateKey = "";
    this._grainCv = null;
    this._img = null;
  }

  // ---- field ----------------------------------------------------------------

  _buildField(modes, w, h) {
    const f = this.fld;
    let mx = 1e-9;
    for (let j = 0; j < GH; j++) {
      const v = j / (GH - 1);
      for (let i = 0; i < GW; i++) {
        const u = i / (GW - 1);
        let s = 0;
        for (const md of modes) {
          const [M, N] = LADDER[md.rung];
          s += md.w * (Math.cos(4 * M * Math.PI * u) * Math.cos(N * Math.PI * v) -
                       Math.cos(4 * N * Math.PI * u) * Math.cos(M * Math.PI * v));
        }
        const a = Math.abs(s);
        f[j * GW + i] = a;
        if (a > mx) mx = a;
      }
    }
    for (let i = 0; i < f.length; i++) f[i] /= mx;
    // gradient in per-PIXEL units so the drift constant is resolution-honest
    const cw = w / (GW - 1), ch = h / (GH - 1);
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(GW - 1, i + 1);
        const j0 = Math.max(0, j - 1), j1 = Math.min(GH - 1, j + 1);
        this.gxA[j * GW + i] = (f[j * GW + i1] - f[j * GW + i0]) / ((i1 - i0) * cw);
        this.gyA[j * GW + i] = (f[j1 * GW + i] - f[j0 * GW + i]) / ((j1 - j0) * ch);
      }
    }
  }

  sampleF(x, y, w, h) {
    const fx = (x / w) * (GW - 1), fy = (y / h) * (GH - 1);
    const i0 = Math.max(0, Math.min(GW - 2, fx | 0));
    const j0 = Math.max(0, Math.min(GH - 2, fy | 0));
    const tx = fx - i0, ty = fy - j0;
    const f = this.fld, r0 = j0 * GW + i0, r1 = r0 + GW;
    return (f[r0] * (1 - tx) + f[r0 + 1] * tx) * (1 - ty) +
           (f[r1] * (1 - tx) + f[r1 + 1] * tx) * ty;
  }

  // ---- pitch -> mode selection ----------------------------------------------

  _analyzePitch(hi, dt, open) {
    const sr = hi.sampleRate ?? 48000;
    const nBins = hi.frequencyBinCount ?? 4096;
    if (!this._hf || this._hf.length !== nBins) {
      this._hf = new Float32Array(nBins);
      this._med = new Float32Array(64);
    }
    hi.getFloatFrequencyData(this._hf);
    const binHz = sr / (nBins * 2);
    const lo = Math.max(2, Math.round(70 / binHz)); // below ~70Hz is kick country
    const hiK = Math.min(nBins - 2, Math.round(2500 / binHz));

    // median of the scanned band: is there a PITCH, or just broadband wash?
    // (drums must never re-sculpt the plate — same tonality idea as chroma)
    let nm = 0;
    for (let k = lo; k < hiK && nm < 64; k += 8) {
      const db = this._hf[k];
      this._med[nm++] = db < -160 ? -160 : db;
    }
    const med = this._med.subarray(0, nm);
    med.sort();
    const median = med[nm >> 1];

    // top peaks, greedily kept >= 3 semitones apart
    let peaks = this._pk || (this._pk = []);
    peaks.length = 0;
    for (let k = lo + 1; k < hiK; k++) {
      const db = this._hf[k];
      if (db < -70 || db <= this._hf[k - 1] || db < this._hf[k + 1]) continue;
      peaks.push({ k, db });
    }
    peaks.sort((a, b) => b.db - a.db);
    const kept = this._kept || (this._kept = []);
    kept.length = 0;
    for (const p of peaks) {
      if (kept.length >= 3) break;
      if (p.db < peaks[0].db - 30) break;
      // parabolic interpolation: sub-bin frequency, so semitones are honest
      const a = this._hf[p.k - 1], b = p.db, c = this._hf[p.k + 1];
      const den = a - 2 * b + c;
      const off = den ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      const midi = 69 + 12 * Math.log2(((p.k + off) * binHz) / 440);
      if (kept.some((q) => Math.abs(q.midi - midi) < 3)) continue;
      kept.push({ midi, db: p.db });
    }

    // A held pure tone — the classic cymatics demo — is SPARSE: two hot bins
    // can never pass SilenceGate's broadband "musical" test (the same reason
    // solo piano needed chroma's tonality gate). So tonality is a co-equal
    // gate here: a clear pitch drives the plate even when the mix is thin.
    // PROMINENCE: a real pitch is a NARROW peak — two semitones away is a
    // valley. A kick train's smeared 50-120Hz shelf beats the median test
    // (it re-sculpted the plate once per drums-only song) but is still hot
    // 2 st away. Offset floored at 3 bins so the Blackman main lobe of a
    // genuine low tone doesn't fail its own prominence.
    let prom = 99;
    if (kept.length > 0) {
      const k0 = Math.round((440 * Math.pow(2, (kept[0].midi - 69) / 12)) / binHz);
      const off = Math.max(3, Math.round(k0 * 0.122));
      prom = kept[0].db - Math.max(this._hf[Math.max(0, k0 - off)], this._hf[Math.min(nBins - 1, k0 + off)]);
    }
    const tonal = kept.length > 0 && kept[0].db - median > 15 && kept[0].db > -58 && prom > 9;
    this.tonal = tonal;
    if (!tonal) { this._candFor = 0; return; }

    const r0 = rungOfMidi(kept[0].midi);
    if (r0 === this.rung) { this._candFor = 0; return; }
    if (r0 === this._candRung) this._candFor += dt;
    else { this._candRung = r0; this._candFor = dt; }
    // 250ms hold, not 150: a snare's shell resonance (~185Hz) is a REAL
    // narrow pitch that survives the prominence gate for ~130ms per hit —
    // measured, it re-sculpted the plate once per drums-only song. A pitch
    // must be HELD to count; a drum's momentary ring is not a held pitch.
    if (this._candFor >= 0.25) {
      // a real new pitch, held: re-sculpt. Secondaries ride along, energy-weighted.
      this.rung = r0;
      const modes = [{ rung: r0, w: 1 }];
      for (let i = 1; i < kept.length; i++) {
        const r = rungOfMidi(kept[i].midi);
        if (modes.some((m) => m.rung === r)) continue;
        modes.push({ rung: r, w: Math.pow(10, (kept[i].db - kept[0].db) / 40) * 0.6 });
      }
      this._buildField(modes, this._w, this._h);
      this.retargets++;
      this._candFor = 0;
    }
  }

  // ---- events ---------------------------------------------------------------

  _tap(w, h) {
    this.taps++;
    this.flash = Math.min(1, this.flash + 0.55);
    this._boost = Math.min(1.1, this._boost + 0.22);
    const ex = 60 + Math.random() * (w - 120), ey = 40 + Math.random() * (h - 80);
    const R2 = TAP_R * TAP_R;
    for (let i = 0; i < this._act; i++) {
      const dx = this.px[i] - ex, dy = this.py[i] - ey;
      const d2 = dx * dx + dy * dy;
      if (d2 > R2 || d2 < 1) continue;
      const d = Math.sqrt(d2), s = (1 - d / TAP_R) * TAP_AMP;
      this.vx[i] += (dx / d) * s;
      this.vy[i] += (dy / d) * s;
    }
  }

  _rupture() {
    this.ruptures++;
    this.flash = 1;
    this._boost = 1.1; // ~1.5s of chaos, then the new figure assembles
    for (let i = 0; i < this._act; i++) {
      this.vx[i] += (Math.random() - 0.5) * 2 * RUP_AMP;
      this.vy[i] += (Math.random() - 0.5) * 2 * RUP_AMP * 0.6; // 4:1 panel: sideways drama
    }
  }

  // ---- chrome ---------------------------------------------------------------

  _ensurePlate(w, h) {
    const key = `${w}x${h}`;
    if (this._plate && this._plateKey === key) return;
    this._plateKey = key;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const c = cv.getContext("2d");
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0a0a0e");
    bg.addColorStop(0.5, "#07070a");
    bg.addColorStop(1, "#09090c");
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    // brushed anodize: deterministic faint streaks
    let seed = 41;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 260; i++) {
      const y = rnd() * h, x0 = rnd() * w, len = 200 + rnd() * 900;
      c.strokeStyle = `rgba(${170 + rnd() * 40},${175 + rnd() * 40},${190 + rnd() * 40},${0.008 + rnd() * 0.018})`;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + len, y); c.stroke();
    }
    // vignette
    const vg = c.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.62);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.42)");
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
    // machined border + corner screws
    c.strokeStyle = "rgba(150,160,180,0.16)";
    c.lineWidth = 1;
    c.strokeRect(6.5, 6.5, w - 13, h - 13);
    c.strokeStyle = "rgba(0,0,0,0.6)";
    c.strokeRect(9.5, 9.5, w - 19, h - 19);
    for (const [sx, sy] of [[18, 18], [w - 18, 18], [18, h - 18], [w - 18, h - 18]]) {
      c.fillStyle = "#101218";
      c.beginPath(); c.arc(sx, sy, 5, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "rgba(180,190,210,0.25)";
      c.beginPath(); c.arc(sx, sy, 5, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(sx - 3, sy - 3); c.lineTo(sx + 3, sy + 3); c.stroke();
    }
    this._plate = cv;
  }

  // ---- frame ----------------------------------------------------------------

  render(ctx, analyser, w, h, now) {
    const t0 = performance.now();
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t += dt;
    this._w = w; this._h = h;

    if (!this._seeded) {
      this._seeded = true;
      for (let i = 0; i < this.n; i++) {
        this.px[i] = 14 + Math.random() * (w - 28);
        this.py[i] = 14 + Math.random() * (h - 28);
      }
      // a default figure so the first notes have somewhere to send the sand
      this._buildField([{ rung: 4, w: 1 }], w, h);
    }

    analyser.getByteFrequencyData(this.freq);
    const g = this.gate.update(this.freq, dt);
    this._analyzePitch(hiResOf(analyser), dt, g.open);

    // energy -> agitation, contrast-stretched (compressed masters pin raw
    // energy near the top; the plate must read THIS song's quiet vs loud)
    const loud = this.gate.loud;
    if (g.open) {
      if (loud > this._loudPeak) this._loudPeak = loud;
      else this._loudPeak += (loud - this._loudPeak) * Math.min(1, dt * 0.05);
    }
    this._loudPeak = Math.max(0.05, this._loudPeak);
    const loudN = g.gate * Math.min(1, loud / this._loudPeak);
    this.energy += (loudN - this.energy) * Math.min(1, dt * 2.2);
    if (g.gate > 0.8) {
      const e = this.energy;
      if (e < this._eLo) this._eLo = e;
      else this._eLo += (e - this._eLo) * Math.min(1, dt * 0.05);
      if (e > this._eHi) this._eHi = e;
      else this._eHi += (e - this._eHi) * Math.min(1, dt * 0.05);
    }
    const span = this._eHi - this._eLo;
    const stretched = span > 0.02 ? Math.max(0, Math.min(1, (this.energy - this._eLo) / span)) : 0.5;
    const conf = Math.min(1, span / 0.12);
    this.visE += ((stretched * conf + this.energy * (1 - conf)) * g.gate - this.visE) * Math.min(1, dt * 3);

    // kick = plate tap (volume-independent bass flux)
    let rawBass = 0;
    for (let i = 2; i < 10; i++) rawBass += this.freq[i];
    rawBass /= 8 * 255;
    if (g.open && rawBass > this._bassPeak) this._bassPeak = rawBass;
    else this._bassPeak = Math.max(0.04, this._bassPeak - dt * 0.01);
    const fluxN = g.open ? Math.max(0, rawBass - this._prevBass) / Math.max(0.04, this._bassPeak) : 0;
    this._prevBass = rawBass;
    this._sinceTap += dt;
    if (fluxN > 0.3 && this._sinceTap > 0.16 && g.gate > 0.4) {
      this._sinceTap = 0;
      this._tap(w, h);
    }

    // drop / rupture: fast energy tearing away from the recent average
    // drop / rupture: the shared EnergyJump detector (silencegate.js) — kick-
    // bridging fast/slow trackers, sustain, relative loudness floors, seeded
    // baseline. Its lessons were measured here and in murmuration; one home.
    if (this.jump.update(loud, this._loudPeak, g.open, g.gate, dt)) this._rupture();

    // a clear pitch alone (no broadband mix) still vibrates the plate at
    // half strength — a signal generator is the classic way to play one
    this._tonalEnv = (this._tonalEnv || 0) + ((this.tonal ? 1 : 0) - (this._tonalEnv || 0)) * Math.min(1, dt * (this.tonal ? 4 : 2));
    const agT = Math.max(g.gate * (0.14 + this.visE * 0.86), this._tonalEnv * 0.55);
    this.agitation += (agT - this.agitation) * Math.min(1, dt * 4);
    this._boost *= Math.exp(-dt * 1.4);
    this.flash *= Math.exp(-dt * 5);
    const ag = Math.min(1.25, this.agitation + this._boost);

    // ---- physics + plot into the half-res additive buffer
    this._ensurePlate(w, h);
    const bw = w >> 1, bh = h >> 1;
    if (!this._img || this._img.width !== bw) {
      this._grainCv = document.createElement("canvas");
      this._grainCv.width = bw; this._grainCv.height = bh;
      this._img = this._grainCv.getContext("2d").createImageData(bw, bh);
    }
    const data = this._img.data;
    data.fill(0);

    const [R, G, B] = PALETTES[this.cfg.preset] || PALETTES["Gold Sand"];
    const idle = g.gate < 0.25 && (this._tonalEnv || 0) < 0.25;
    const breathe = idle ? 0.78 + 0.22 * Math.sin((this.t * Math.PI * 2) / 8) : 1;
    const it = (0.34 + this.visE * 0.3 + this.flash * 0.45) * breathe;
    const ar = (R * it) | 0, agc = (G * it) | 0, ab = (B * it) | 0;

    const k = Math.min(2, dt * 60);
    const sx = (GW - 1) / w, sy = (GH - 1) / h;
    const f = this.fld, gxA = this.gxA, gyA = this.gyA;
    const moving = ag > 0.004;
    const dec = Math.exp(-dt * 5);
    for (let i = 0; i < this._act; i++) {
      let x = this.px[i], y = this.py[i];
      if (moving || this.vx[i] || this.vy[i]) {
        const fx = x * sx, fy = y * sy;
        const i0 = fx < 0 ? 0 : fx > GW - 2 ? GW - 2 : fx | 0;
        const j0 = fy < 0 ? 0 : fy > GH - 2 ? GH - 2 : fy | 0;
        const tx = fx - i0, ty = fy - j0;
        const r0 = j0 * GW + i0, r1 = r0 + GW;
        const fv = (f[r0] * (1 - tx) + f[r0 + 1] * tx) * (1 - ty) +
                   (f[r1] * (1 - tx) + f[r1 + 1] * tx) * ty;
        const jit = fv * ag * JIT * k;
        const dr = fv * ag * DRIFT * k;
        x += (Math.random() - 0.5) * 2 * jit - gxA[r0] * dr + this.vx[i] * dt;
        y += (Math.random() - 0.5) * 2 * jit - gyA[r0] * dr + this.vy[i] * dt;
        this.vx[i] *= dec; this.vy[i] *= dec;
        if (Math.abs(this.vx[i]) < 0.5) this.vx[i] = 0;
        if (Math.abs(this.vy[i]) < 0.5) this.vy[i] = 0;
        if (x < 12) x = 24 - x; else if (x > w - 12) x = 2 * (w - 12) - x;
        if (y < 12) y = 24 - y; else if (y > h - 12) y = 2 * (h - 12) - y;
        this.px[i] = x; this.py[i] = y;
      }
      const bx = (x * 0.5) | 0, by = (y * 0.5) | 0;
      const p4 = (by * bw + bx) * 4;
      data[p4] += ar; data[p4 + 1] += agc; data[p4 + 2] += ab; data[p4 + 3] += 200;
    }

    ctx.drawImage(this._plate, 0, 0);
    this._grainCv.getContext("2d").putImageData(this._img, 0, 0);
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._grainCv, 0, 0, w, h);
    ctx.globalCompositeOperation = prevOp;

    // auto-quality: if the Pi can't afford 10k grains, it gets 6k
    const cost = performance.now() - t0;
    this.ms += (cost - this.ms) * 0.05;
    if (this.ms > 2.6 && this._act > 6000) {
      this._slowFor += dt;
      if (this._slowFor > 2) this._act = 6000;
    } else this._slowFor = 0;
  }
}
