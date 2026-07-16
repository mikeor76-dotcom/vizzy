// Laser Show — a concert lighting rig aimed at the audience, run by a
// virtual light jockey who listens the way MilkDrop's director does.
//
// The rig: three emitter clusters (bottom-left, bottom-right, centre) behind
// a low stage-truss silhouette, firing additive glow beams through haze.
// The LJ: a pattern state machine — FAN, SCISSORS, TUNNEL, LISSAJOUS SCAN,
// MIRRORBALL — where every KICK advances the cue inside the pattern (fans
// flip direction, scissors cross, the tunnel spawns a ring), a SECTION
// change (a genuine accent, or a new song after silence) hard-cuts to the
// next pattern, and ENERGY scales beam count and sweep speed. Patterns hold
// ~24 beats so the show has phrasing, not chaos. In silence the rig rests:
// one faint static fan through breathing haze, roadies gone home.
//
// PHOTOSENSITIVITY CAP (non-negotiable, and enforced HERE in the engine, not
// per-cue, so no future cue can violate it): full-field flashes are limited
// to 3 per second (WCAG guidance). Every whole-screen luminance event goes
// through firePulse(), which silently drops requests inside the 333ms window.
// The bench asserts this over a 190bpm metal run.
//
// Pi-friendly: <=80 additive polylines + a few gradients, no shadowBlur.

import { SilenceGate } from "./silencegate.js";

const TAU = Math.PI * 2;

const PALETTES = {
  "Club RGB": { colors: [[255, 60, 60], [60, 255, 120], [80, 140, 255], [255, 200, 60]], haze: [40, 60, 130] },
  "Emerald Mono": { colors: [[40, 255, 140]], haze: [20, 80, 50] }, // the most authentic: one green laser
  Sunset: { colors: [[255, 120, 60], [255, 60, 160], [255, 190, 80]], haze: [120, 50, 60] },
  "UV Violet": { colors: [[150, 60, 255], [80, 40, 220], [220, 120, 255]], haze: [70, 40, 130] },
};

const PATTERNS = ["fan", "scissors", "tunnel", "lissajous", "mirrorball"];
const PATTERN_BEATS = 24; // phrase length before the LJ moves on anyway
const PULSE_MIN_MS = 333; // the 3Hz cap

export class Lasers {
  constructor() {
    this.cfg = { preset: "Club RGB" }; // self-governing (auto: null)
    this.freq = new Uint8Array(1024);
    this.gate = new SilenceGate();

    // music reading (the established self-governing pattern)
    this.energy = 0;
    this.visE = 0; // contrast-stretched (the compressed-master lesson)
    this._eLo = 0.35; this._eHi = 0.65;
    this.beat = 0;
    this.treble = 0;
    this._loudPeak = 0.06;
    this._bassPeak = 0.05;
    this._trebPeak = 0.05;
    this._prevBass = 0;
    this._fluxAvg = 0.03;

    // the LJ
    this.patternIdx = 0;
    this.beatsInPattern = 0;
    this.colorShift = 0;
    this.cueSteps = 0; // bench counters
    this.patternChanges = 0;
    this.pulseFires = 0;
    this.pulseDenied = 0;
    this._lastPulse = 0;
    this._lastSection = 0;
    this.pulse = 0; // the capped full-field envelope
    this.resting = true;

    // per-pattern state
    this.sweep = 0; this.sweepDir = 1;
    this.cross = 0; this.crossTgt = 0.5;
    this.rings = [];
    this.lissAB = 0;
    this.lissT = 0;
    this.ballRays = null;
    this.specks = [];

    this.t = 0;
    this.lastNow = 0;
    this.ms = 0;
  }

  // ---- THE CAP. Every full-field luminance event comes through here. ------
  firePulse(now, strength) {
    if (now - this._lastPulse < PULSE_MIN_MS) { this.pulseDenied++; return false; }
    this._lastPulse = now;
    this.pulse = Math.max(this.pulse, Math.min(1, strength));
    this.pulseFires++;
    return true;
  }

  analyze(dt, now) {
    const f = this.freq;
    const g = this.gate.update(f, dt);
    const band = (lo, hi) => {
      let s = 0;
      for (let i = lo; i < hi; i++) s += f[i];
      return Math.max(0, s / ((hi - lo) * 255) - g.sub);
    };
    const rawBass = band(1, 6);
    const rawTreb = band(92, 372);
    const rawLoud = g.loud;
    if (g.open) {
      const dk = 1 - dt * 0.05;
      this._loudPeak = Math.max(this._loudPeak * dk, rawLoud, 0.04);
      this._bassPeak = Math.max(this._bassPeak * dk, rawBass, 0.04);
      this._trebPeak = Math.max(this._trebPeak * dk, rawTreb, 0.03);
    }
    this.energy += (g.gate * Math.min(1, rawLoud / this._loudPeak) - this.energy) * Math.min(1, dt * 2.2);
    this.treble += (g.gate * Math.min(1, rawTreb / this._trebPeak) - this.treble) * Math.min(1, dt * 6);
    // contrast stretch (see murmuration.js for the measurements behind this).
    // Learn only while the gate is FULLY open: as a song starts, `energy` is
    // still ramping up through its smoother, and snapping eLo to those ramp
    // values records a quiet passage that never happened — the span then
    // starts ~5x too wide and the rig sits dim until it converges.
    if (g.gate > 0.8) {
      const e = this.energy;
      // 0.05/s relax (~20s time constant): at 0.02 the stretcher took 100+s
      // to converge onto a compressed master's real range, and until then it
      // divided by a span ~5x too wide — dim, static rig for two minutes
      if (e < this._eLo) this._eLo = e; else this._eLo += (e - this._eLo) * Math.min(1, dt * 0.05);
      if (e > this._eHi) this._eHi = e; else this._eHi += (e - this._eHi) * Math.min(1, dt * 0.05);
    }
    const span = this._eHi - this._eLo;
    const stretched = span > 0.02 ? Math.max(0, Math.min(1, (this.energy - this._eLo) / span)) : 0.5;
    const conf = Math.min(1, span / 0.12);
    this.visE += ((stretched * conf + this.energy * (1 - conf)) * g.gate - this.visE) * Math.min(1, dt * 3);

    // kick -> cue advance; big accent -> section cut
    const fluxN = g.open ? Math.max(0, rawBass - this._prevBass) / Math.max(0.04, this._bassPeak) : 0;
    this._prevBass = rawBass;
    this._fluxAvg += (fluxN - this._fluxAvg) * Math.min(1, dt * 1.5);
    if (g.open && fluxN > Math.max(0.05, this._fluxAvg * 2.1)) {
      if (this.beat < 0.6) this.onBeat(now);
      this.beat = 1;
    }
    this.beat = Math.max(0, this.beat - dt * 4);
    if (g.open && fluxN > Math.max(0.14, this._fluxAvg * 4.2) && now - this._lastSection > 9000) {
      this._lastSection = now;
      this.nextPattern(now, true);
    }
    // a new song after silence hard-cuts too — fresh song, fresh look
    const wasResting = this.resting;
    this.resting = g.gate < 0.15;
    if (wasResting && !this.resting) this.nextPattern(now, true);
  }

  onBeat(now) {
    this.cueSteps++;
    this.beatsInPattern++;
    const p = PATTERNS[this.patternIdx];
    if (p === "fan") this.sweepDir = -this.sweepDir;
    else if (p === "scissors") this.crossTgt = this.crossTgt > 0 ? -0.55 : 0.55;
    else if (p === "tunnel") this.rings.push({ r: 0.04, a: 1 });
    else if (p === "lissajous") this.lissAB = (this.lissAB + 1) % 4;
    else if (p === "mirrorball") this.firePulse(now, 0.5); // capped, by design
    if (this.beatsInPattern >= PATTERN_BEATS) this.nextPattern(now, false);
  }

  nextPattern(now, hardCut) {
    this.patternIdx = (this.patternIdx + 1) % PATTERNS.length;
    this.beatsInPattern = 0;
    this.patternChanges++;
    this.colorShift++;
    this.rings.length = 0;
    if (hardCut) this.firePulse(now, 0.8); // the section slam — capped like everything
  }

  // ---- beams ---------------------------------------------------------------
  // Three additive passes per beam — wide soft scatter, tight halo, hot core.
  // Two passes read as thin CAD lines in a dark room (verified by eye); the
  // wide pass is what sells "light travelling through haze".
  beam(ctx, x, y, ang, len, col, coreA, haloA, coreW = 2) {
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    const [r, g, b] = col;
    ctx.strokeStyle = `rgba(${r},${g},${b},${haloA})`;
    ctx.lineWidth = coreW * 14;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = `rgba(${r},${g},${b},${haloA * 2.6})`;
    ctx.lineWidth = coreW * 4.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = `rgba(${Math.min(255, r + 120)},${Math.min(255, g + 120)},${Math.min(255, b + 120)},${coreA})`;
    ctx.lineWidth = coreW;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    // scatter bloom where the beam dies in the haze
    ctx.fillStyle = `rgba(${r},${g},${b},${coreA * 0.5})`;
    ctx.beginPath(); ctx.arc(ex, ey, coreW * 2.2, 0, TAU); ctx.fill();
  }

  colorOf(pal, i) {
    return pal.colors[(i + this.colorShift) % pal.colors.length];
  }

  // Beams RAKE ACROSS the panel, not up out of it. On a 4:1 bar the drama is
  // horizontal: fans from the corner emitters sweep low over the audience and
  // CROSS mid-panel. The first version aimed them near-vertical and every
  // beam exited the frame within 480px — a laser show seen through a letterbox.
  drawFan(ctx, w, h, pal, gain) {
    const n = 5 + Math.round(this.visE * 4); // energy adds beams
    this.sweep += this.sweepDir * (0.5 + this.visE * 1.3) * this._dt;
    const lean = Math.sin(this.sweep) * (0.16 + this.visE * 0.1);
    for (const side of [0, 1]) {
      const ex = side ? w * 0.94 : w * 0.06, ey = h * 0.965;
      for (let i = 0; i < n; i++) {
        // spread from near-horizontal (0.06) to a steep diagonal (0.85)
        const f2 = n === 1 ? 0.5 : i / (n - 1);
        const up = 0.06 + f2 * (0.62 + this.visE * 0.22) + lean;
        this.beam(ctx, ex, ey, side ? Math.PI + up : -up, w * 1.05, this.colorOf(pal, i), (0.5 + this.beat * 0.25) * gain, 0.045 * gain);
      }
    }
  }

  drawScissors(ctx, w, h, pal, gain) {
    this.cross += (this.crossTgt - this.cross) * Math.min(1, this._dt * 7);
    const n = 4 + Math.round(this.visE * 2);
    for (const side of [0, 1]) {
      const ex = side ? w * 0.94 : w * 0.06, ey = h * 0.965;
      for (let i = 0; i < n; i++) {
        const f2 = i / (n - 1) - 0.5;
        // a blade of near-parallel beams, raking low across the panel; the
        // two blades shear past each other as `cross` flips sign on beats
        const up = 0.34 + this.cross * 0.35 + f2 * 0.14;
        this.beam(ctx, ex, ey, side ? Math.PI + up : -up, w * 1.05, this.colorOf(pal, i + side), (0.5 + this.beat * 0.25) * gain, 0.05 * gain);
      }
    }
  }

  drawTunnel(ctx, w, h, pal, gain) {
    const cx = w / 2, cy = h * 0.52;
    if (this.rings.length === 0) this.rings.push({ r: 0.04, a: 0.8 });
    for (const ring of this.rings) {
      ring.r += (0.35 + this.visE * 0.75) * this._dt * (0.3 + ring.r); // accelerates outward
      ring.a *= 1 - this._dt * 0.55;
      const rad = ring.r * w * 0.5;
      const [r, g, b] = this.colorOf(pal, Math.round(ring.r * 10));
      ctx.strokeStyle = `rgba(${r},${g},${b},${Math.min(0.7, ring.a) * gain})`;
      ctx.lineWidth = 2 + ring.r * 3;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const a2 = (k / 6) * TAU + this.t * 0.15;
        const px = cx + Math.cos(a2) * rad, py = cy + Math.sin(a2) * rad * 0.42; // squashed for the bar
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    this.rings = this.rings.filter((ring) => ring.a > 0.02 && ring.r < 2.4);
    // spokes anchor the tunnel to the rig
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * TAU + this.t * 0.15 + TAU / 16;
      this.beam(ctx, cx, cy, ang, w * 0.55, this.colorOf(pal, i), 0.16 * gain, 0.03 * gain, 1.5);
    }
  }

  drawLissajous(ctx, w, h, pal, gain) {
    const AB = [[3, 2], [5, 4], [2, 3], [4, 3]][this.lissAB];
    this.lissT += this._dt * (0.7 + this.visE * 1.4);
    const cx = w / 2, cy = h * 0.5;
    const N = 90;
    const [r, g, b] = this.colorOf(pal, this.lissAB);
    for (const pass of [[8, 0.05], [2, 0.5]]) {
      ctx.strokeStyle = pass[0] === 2
        ? `rgba(${Math.min(255, r + 120)},${Math.min(255, g + 120)},${Math.min(255, b + 120)},${pass[1] * gain})`
        : `rgba(${r},${g},${b},${pass[1] * gain})`;
      ctx.lineWidth = pass[0];
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const p = this.lissT + (i / N) * 1.6;
        const px = cx + Math.sin(p * AB[0]) * w * 0.4;
        const py = cy + Math.sin(p * AB[1]) * h * 0.36;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // the scanhead beam pointing at the figure's pen position
    const px = cx + Math.sin((this.lissT + 1.6) * AB[0]) * w * 0.4;
    const py = cy + Math.sin((this.lissT + 1.6) * AB[1]) * h * 0.36;
    const ang = Math.atan2(py - h * 0.99, px - w / 2);
    this.beam(ctx, w / 2, h * 0.99, ang, Math.hypot(px - w / 2, py - h * 0.99), [r, g, b], 0.3 * gain, 0.04 * gain, 1.5);
  }

  drawMirrorball(ctx, w, h, pal, gain) {
    const cx = w / 2, cy = h * 0.14;
    if (!this.ballRays) {
      this.ballRays = [];
      for (let i = 0; i < 34; i++) this.ballRays.push({ a: Math.random() * TAU, l: 0.5 + Math.random() * 0.9 });
      for (let i = 0; i < 40; i++) this.specks.push({ a: Math.random() * TAU, r: 0.15 + Math.random() * 0.8 });
    }
    const bright = (0.1 + this.pulse * 0.35 + this.beat * 0.06) * gain;
    for (let i = 0; i < this.ballRays.length; i++) {
      const ray = this.ballRays[i];
      this.beam(ctx, cx, cy, ray.a + this.t * 0.1, h * ray.l * 1.6, this.colorOf(pal, i), bright, 0.02 * gain, 1.2);
    }
    ctx.fillStyle = `rgba(230,235,255,${(0.6 + this.pulse * 0.3) * gain})`;
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, TAU); ctx.fill();
    // drifting glints on the "walls"
    for (const s of this.specks) {
      s.a += this._dt * 0.12;
      const px = cx + Math.cos(s.a) * w * 0.46 * s.r;
      const py = h * 0.5 + Math.sin(s.a * 1.7) * h * 0.32;
      ctx.fillStyle = `rgba(240,244,255,${(0.25 + this.pulse * 0.4) * gain})`;
      ctx.fillRect(px, py, 2, 2);
    }
  }

  render(ctx, analyser, w, h, now) {
    const t0 = performance.now();
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t += dt;
    this._dt = dt;
    if (analyser) analyser.getByteFrequencyData(this.freq);
    else this.freq.fill(0);
    this.analyze(dt, now);
    this.pulse = Math.max(0, this.pulse - dt * 3);

    const pal = PALETTES[this.cfg.preset] || PALETTES["Club RGB"];

    // the room: darkness + haze that breathes with the low end
    ctx.fillStyle = "#020204";
    ctx.fillRect(0, 0, w, h);
    const [hr, hg, hb] = pal.haze;
    const breathe = 0.09 + this.energy * 0.08 + Math.sin(this.t * 0.4) * 0.018 + this.pulse * 0.1;
    const hz = ctx.createRadialGradient(w / 2, h * 0.9, 0, w / 2, h * 0.9, w * 0.55);
    hz.addColorStop(0, `rgba(${hr},${hg},${hb},${breathe})`);
    hz.addColorStop(1, `rgba(${hr},${hg},${hb},0)`);
    ctx.fillStyle = hz;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (this.resting || this.gate.gate < 0.15) {
      // the rig at rest: one faint static fan, haze breathing, house lights off
      for (let i = 0; i < 5; i++) {
        const ang = -Math.PI / 2 + (i - 2) * 0.3 + Math.sin(this.t * 0.13) * 0.1;
        this.beam(ctx, w / 2, h * 0.99, ang, h * 1.5, this.colorOf(pal, i), 0.1, 0.018, 1.5);
      }
    } else {
      const gain = 0.55 + this.visE * 0.45; // quiet verse = dimmer rig
      const p = PATTERNS[this.patternIdx];
      if (p === "fan") this.drawFan(ctx, w, h, pal, gain);
      else if (p === "scissors") this.drawScissors(ctx, w, h, pal, gain);
      else if (p === "tunnel") this.drawTunnel(ctx, w, h, pal, gain);
      else if (p === "lissajous") this.drawLissajous(ctx, w, h, pal, gain);
      else this.drawMirrorball(ctx, w, h, pal, gain);
    }
    // the capped full-field event (section slams, mirrorball hits)
    if (this.pulse > 0.02) {
      ctx.fillStyle = `rgba(${hr + 60},${hg + 60},${hb + 60},${this.pulse * 0.1})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    // the stage truss: a dark silhouette grounding the rig
    ctx.fillStyle = "#050507";
    ctx.fillRect(0, h * 0.965, w, h * 0.035);
    ctx.fillStyle = "#0a0a10";
    for (const ex of [w * 0.06, w * 0.5, w * 0.94]) {
      ctx.fillRect(ex - 12, h * 0.945, 24, h * 0.03);
    }

    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
}
