// HarmonicRibbon — the "last 30 seconds" of harmony as ONE flowing ribbon.
//
// Replaces the 12-equal-lanes chromagram in the Harmony Wheel. The redesign's
// premise (the user's spec): you don't hear twelve simultaneous strands — you
// hear a DOMINANT harmonic centre with supporting colour around it. So:
//
//   main ribbon   the strongest pitch class at each moment. Its VERTICAL LANE
//                 is the class's circle-of-fifths slot, so a V-I cadence is a
//                 small graceful step while a remote modulation is a visible
//                 leap — vertical distance IS harmonic distance. Thickness =
//                 energy; colour = the class's palette colour, blended along
//                 the ribbon by one x-gradient as the dominant changes.
//   strands       only the top few supporting classes, thin and quiet, hovering
//                 around the main ribbon at offsets proportional to their
//                 fifths-distance from it — near the ribbon when related,
//                 diverging when the harmony spreads. Never all twelve.
//   recency       brightness ramps toward NOW at the right edge; a thin NOW
//                 marker and a small note label sit at the endpoint.
//   silence       the ribbon narrows to a dim hairline and the label hides —
//                 it never freezes or jumps.
//
// Responsibilities are split as the spec asks: push() owns history (and
// decides each sample's dominant, immutably), _derive() owns transformation/
// smoothing into TARGETS at the 20Hz sample rate, _ease() glides the display
// geometry toward those targets every frame, _paint() draws. Targets may step;
// the screen never does. Zero allocations on the hot paths after warm-up.

const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const SLOT_OF = new Array(12);
FIFTHS.forEach((pc, slot) => { SLOT_OF[pc] = slot; });

export const RIB_HZ = 20; // samples per second
export const RIB_SECONDS = 30;
export const RIB_COLS = RIB_HZ * RIB_SECONDS; // the history cap: exactly 30s
const SEG = 100; // control points across the panel
const STEP = RIB_COLS / SEG;
const TAU = Math.PI * 2;

// signed shortest distance around the 12-slot fifths circle: -6..+6
function circDist(a, b) {
  let d = a - b;
  while (d > 6) d -= 12;
  while (d < -6) d += 12;
  return d;
}

export class HarmonicRibbon {
  constructor() {
    this.hist = new Float32Array(12 * RIB_COLS);
    // The dominant is decided ONCE, at push time, and stored — history is
    // immutable, like the audio it represents. The first version re-ran the
    // sticky argmax over the whole window on every repaint, chaining from the
    // left edge; as old samples fell off the ring the chain re-resolved
    // differently and lane assignments MID-RIBBON flipped retroactively —
    // the "odd movements" the user reported. A note that was the strongest
    // at 14:03:07 stays the strongest at 14:03:07 forever.
    this.domRing = new Int8Array(RIB_COLS);
    // The drawn PAST is write-once. v1.0.18 froze the lane CHOICE, but the
    // geometry still deformed retroactively two ways: (1) the y-smoothing was
    // a symmetric spatial filter, so a new chord's influence bled ~2s BACKWARD
    // into drawn history; (2) thickness was normalized by a global rolling
    // max, so one loud hit rescaled the entire past ribbon at once — the
    // "past bounces" the user saw. Now the glide and the thickness are
    // computed CAUSALLY at push time (one-pole smoothers that only ever see
    // older samples) and stored per sample. History translates; it never
    // deforms.
    this.ySmRing = new Float32Array(RIB_COLS); // lane fraction 0..1, smoothed
    this.eSmRing = new Float32Array(RIB_COLS); // normalized energy, smoothed
    this._ySm = -1;
    this._eSm = 0;
    this._lastDom = -1;
    this.idx = 0;
    this.count = 0;
    this._eMax = 0.05; // slow-decaying energy scale (thickness normalizer)

    // derived control-point tracks (preallocated; filled by _derive)
    this._m12 = new Float32Array(12 * SEG); // per-class downsampled weights
    this._tot = new Float32Array(SEG);
    this._eS = new Float32Array(SEG); // per-point normalized energy (immutable source)
    this._dom = new Int8Array(SEG);
    this._y = new Float32Array(SEG); // derived TARGETS
    this._hw = new Float32Array(SEG);
    this._yD = new Float32Array(SEG); // eased DISPLAY geometry (what's drawn)
    this._hwD = new Float32Array(SEG);
    this._tmp = new Float32Array(SEG);
    this._warm = false;
    this._sinceDraw = 0;
    this._dirty = true;
  }

  push(chroma12) {
    let tot = 0, best = 0, bestV = -1;
    for (let pc = 0; pc < 12; pc++) {
      const v = chroma12[pc];
      this.hist[pc * RIB_COLS + this.idx] = v;
      tot += v;
      if (v > bestV) { bestV = v; best = pc; }
    }
    // sticky: the incumbent keeps the lane unless clearly beaten — decided
    // NOW, stored forever (see the constructor note)
    if (this._lastDom >= 0 && chroma12[this._lastDom] >= bestV * 0.9) best = this._lastDom;
    this.domRing[this.idx] = best;
    this._lastDom = best;
    // causal glide + causal energy: each sample's stored value depends only
    // on itself and OLDER samples, so it can never change once written
    this._eMax = Math.max(this._eMax * (1 - 1 / (RIB_HZ * 20)), tot, 0.05);
    const laneFrac = SLOT_OF[best] / 11;
    if (this._ySm < 0) this._ySm = laneFrac;
    this._ySm += (laneFrac - this._ySm) * 0.09; // ~0.55s glide: fast enough to
    // follow a chord change, slow enough that a melody alternating dominants
    // every beat reads as a wave, not a zigzag
    this._eSm += (Math.min(1, tot / this._eMax) - this._eSm) * 0.25;
    this.ySmRing[this.idx] = this._ySm;
    this.eSmRing[this.idx] = this._eSm;
    this.idx = (this.idx + 1) % RIB_COLS; // ring: history never exceeds 30s
    this.count++;
    this._sinceDraw++;
    this._dirty = true;
  }

  // for the bench: what the newest control point says
  status() {
    this._derive(100); // height only scales geometry; any sane value works
    const i = SEG - 1;
    return {
      domPc: this._dom[i],
      domName: PC_NAMES[this._dom[i]],
      energy: this._eS[i],
      halfW: this._hw[i],
    };
  }
  windowSamples() { return RIB_COLS; }

  _smooth(arr, passes) {
    for (let p = 0; p < passes; p++) {
      let prev = arr[0];
      for (let i = 1; i < SEG - 1; i++) {
        const cur = arr[i];
        arr[i] = (prev + cur * 2 + arr[i + 1]) / 4;
        prev = cur;
      }
    }
  }

  _derive(plotH) {
    const m = this._m12;
    // downsample the ring into SEG control points per class
    for (let i = 0; i < SEG; i++) {
      const s0 = Math.floor(i * STEP);
      let tot = 0;
      for (let pc = 0; pc < 12; pc++) {
        let sum = 0;
        const base = pc * RIB_COLS;
        for (let k = 0; k < STEP; k++) sum += this.hist[base + (this.idx + s0 + k) % RIB_COLS];
        const v = sum / STEP;
        m[pc * SEG + i] = v;
        tot += v;
      }
      this._tot[i] = tot;
    }

    // dominant per control point: read from the immutable per-sample ring
    // (the bucket's most recent sample). The window sliding only removes at
    // the left and appends at the right — the middle can never change.
    for (let i = 0; i < SEG; i++) {
      const sEnd = (this.idx + Math.floor(i * STEP) + STEP - 1) % RIB_COLS;
      this._dom[i] = this.domRing[sEnd];
    }

    // geometry from the IMMUTABLE per-sample rings: bucket averages of values
    // that were finalized at push time. No spatial smoothing — a symmetric
    // filter here is exactly what let new chords bend the drawn past. The
    // glide already happened, causally, when the samples were written; the
    // window sliding makes these values TRANSLATE left, never deform.
    const pad = plotH * 0.1;
    const span = plotH - pad * 2;
    for (let i = 0; i < SEG; i++) {
      const s0 = Math.floor(i * STEP);
      let ySum = 0, eSum = 0;
      for (let k = 0; k < STEP; k++) {
        const idx = (this.idx + s0 + k) % RIB_COLS;
        ySum += this.ySmRing[idx];
        eSum += this.eSmRing[idx];
      }
      this._y[i] = pad + (ySum / STEP) * span;
      const e = eSum / STEP;
      this._eS[i] = e;
      this._hw[i] = plotH * (0.012 + 0.16 * e);
    }
  }

  // Ease the display geometry toward the derived targets. Targets step at
  // the 20Hz sample rate; the SCREEN must not. Each frame the drawn curve
  // glides a fraction toward the target, so a chord change is a 60fps sweep
  // into the new lane instead of a 20Hz lurch. When samples arrive in bulk
  // with no draws between (benches, a backgrounded tab), easing would lag by
  // seconds — snap instead.
  _ease(dt) {
    if (!this._warm || this._sinceDraw > 10) {
      this._yD.set(this._y);
      this._hwD.set(this._hw);
      this._warm = true;
    } else {
      const k = Math.min(1, dt * 9);
      for (let i = 0; i < SEG; i++) {
        this._yD[i] += (this._y[i] - this._yD[i]) * k;
        this._hwD[i] += (this._hw[i] - this._hwD[i]) * k;
      }
    }
    this._sinceDraw = 0;
  }

  _paint(c, w, h, style) {
    const xs = this._tmp;
    for (let i = 0; i < SEG; i++) xs[i] = (i / (SEG - 1)) * w;
    const recency = (i) => 0.42 + 0.58 * Math.pow(i / (SEG - 1), 1.6);
    const yD = this._yD, hwD = this._hwD;

    c.globalCompositeOperation = "lighter";

    // ---- supporting strands first (under the main ribbon). Only classes
    // that matter: at each point a strand is visible only while in the top 5
    // and not the dominant — its alpha stops go to zero elsewhere, so weak
    // strands FADE rather than clutter.
    for (let pc = 0; pc < 12; pc++) {
      const row = this._m12.subarray(pc * SEG, pc * SEG + SEG);
      let maxW = 0;
      for (let i = 0; i < SEG; i++) if (row[i] > maxW) maxW = row[i];
      if (maxW < 0.06) continue;
      const [r, g, b] = style.pcRGB(pc);
      const grad = c.createLinearGradient(0, 0, w, 0);
      let any = false;
      for (let i = 0; i < SEG; i += 5) {
        let stronger = 0;
        for (let q = 0; q < 12; q++) if (this._m12[q * SEG + i] > row[i]) stronger++;
        const on = stronger < 5 && this._dom[i] !== pc && row[i] > 0.05;
        const a = on ? Math.min(0.34, row[i] * 0.4) * recency(i) : 0;
        if (a > 0.01) any = true;
        grad.addColorStop(i / (SEG - 1), `rgba(${r},${g},${b},${a.toFixed(3)})`);
      }
      if (!any) continue;
      c.beginPath();
      for (let i = 0; i < SEG; i++) {
        const off = (circDist(SLOT_OF[pc], SLOT_OF[this._dom[i]]) / 6) * h * 0.3;
        const py = yD[i] + off;
        const px = xs[i];
        if (i === 0) c.moveTo(px, py);
        else {
          const offP = (circDist(SLOT_OF[pc], SLOT_OF[this._dom[i - 1]]) / 6) * h * 0.3;
          c.quadraticCurveTo(xs[i - 1], yD[i - 1] + offP, (xs[i - 1] + px) / 2, (yD[i - 1] + offP + py) / 2);
        }
      }
      c.strokeStyle = grad;
      c.lineWidth = 1.2;
      c.stroke();
    }

    // ---- the main ribbon: colour follows the dominant class, blended by the
    // gradient; brightness ramps toward NOW; thickness carries energy
    const mainGrad = (aScale) => {
      const gr = c.createLinearGradient(0, 0, w, 0);
      for (let i = 0; i < SEG; i += 5) {
        const [r, g, b] = style.pcRGB(this._dom[i]);
        const e = this._eS[i]; // immutable: brightness of the past never re-scales
        gr.addColorStop(i / (SEG - 1), `rgba(${r},${g},${b},${((0.1 + e * 0.8) * recency(i) * aScale).toFixed(3)})`);
      }
      return gr;
    };
    c.beginPath();
    c.moveTo(xs[0], yD[0] - hwD[0]);
    for (let i = 1; i < SEG; i++) {
      const mx = (xs[i - 1] + xs[i]) / 2;
      const my = (yD[i - 1] - hwD[i - 1] + yD[i] - hwD[i]) / 2;
      c.quadraticCurveTo(xs[i - 1], yD[i - 1] - hwD[i - 1], mx, my);
    }
    c.lineTo(xs[SEG - 1], yD[SEG - 1] - hwD[SEG - 1]);
    c.lineTo(xs[SEG - 1], yD[SEG - 1] + hwD[SEG - 1]);
    for (let i = SEG - 2; i >= 0; i--) {
      const mx = (xs[i + 1] + xs[i]) / 2;
      const my = (yD[i + 1] + hwD[i + 1] + yD[i] + hwD[i]) / 2;
      c.quadraticCurveTo(xs[i + 1], yD[i + 1] + hwD[i + 1], mx, my);
    }
    c.lineTo(xs[0], yD[0] + hwD[0]);
    c.closePath();
    c.fillStyle = mainGrad(0.6);
    c.fill();
    const line = (off, width, aScale) => {
      c.beginPath();
      c.moveTo(xs[0], yD[0] + off(0));
      for (let i = 1; i < SEG; i++) {
        const mx = (xs[i - 1] + xs[i]) / 2;
        const my = (yD[i - 1] + off(i - 1) + yD[i] + off(i)) / 2;
        c.quadraticCurveTo(xs[i - 1], yD[i - 1] + off(i - 1), mx, my);
      }
      c.strokeStyle = mainGrad(aScale);
      c.lineWidth = width;
      c.stroke();
    };
    line(() => 0, 2.4, 1.0);
    line((i) => -hwD[i] * 0.8, 1, 0.55);
    c.globalCompositeOperation = "source-over";
  }

  // rect: {x, y, w, h} of the plot area. style: {id, pcRGB(pc)->[r,g,b],
  // dim:[r,g,b], ink:[r,g,b]}. dt: seconds since the caller's last frame.
  draw(ctx, rect, style, dt = 1 / 60) {
    const { x, y, w, h } = rect;
    if (this._dirty) { this._derive(h); this._dirty = false; }
    this._ease(dt);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y - 2, w + 1, h + 4); // strands may wander; never the neighbours
    ctx.clip();
    ctx.translate(x, y);
    this._paint(ctx, w, h, style);
    ctx.restore();

    // axis + dashed gridlines (the reference's), time labels below
    ctx.strokeStyle = `rgba(${style.dim},0.45)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y);
    ctx.lineTo(x + 0.5, y + h);
    ctx.stroke();
    ctx.setLineDash([2, 6]);
    for (let i = 1; i < 3; i++) {
      const gx = Math.round(x + (i / 3) * w) + 0.5;
      ctx.strokeStyle = `rgba(${style.dim},0.3)`;
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i <= 3; i++) {
      const gx = x + (i / 3) * w;
      ctx.textAlign = i === 0 ? "left" : i === 3 ? "right" : "center";
      ctx.fillStyle = `rgba(${style.dim},0.8)`;
      ctx.fillText(i === 3 ? "NOW" : `-${30 - i * 10}s`, gx, y + h + 16);
    }
    // lane letters (the labels the 12-lane version had, back by request):
    // the ribbon's vertical lanes ARE the circle of fifths, so the ladder
    // reads C at the top to F at the bottom, lit by each class's current
    // energy — you can see WHICH note the ribbon is riding
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    {
      const pad = h * 0.1;
      const laneH = (h - pad * 2) / 11;
      for (let slot = 0; slot < 12; slot++) {
        const pc = FIFTHS[slot];
        const v = this.hist[pc * RIB_COLS + (this.idx + RIB_COLS - 1) % RIB_COLS];
        ctx.fillStyle = `rgba(${style.dim},${0.4 + Math.min(0.6, v * 0.6)})`;
        ctx.fillText(PC_NAMES[pc], x - 7, y + pad + slot * laneH);
      }
    }
    // the NOW marker
    ctx.strokeStyle = `rgba(${style.ink},0.22)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w + 0.5, y);
    ctx.lineTo(x + w + 0.5, y + h);
    ctx.stroke();

    // endpoint: brighter, defined, and named — hidden in silence. Uses the
    // EASED geometry so the dot glides with the ribbon it sits on.
    const e = this._eS[SEG - 1];
    if (e > 0.06) {
      const dom = this._dom[SEG - 1];
      const [r, g, b] = style.pcRGB(dom);
      const ey = this._yD[SEG - 1];
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(${r},${g},${b},0.3)`;
      ctx.beginPath();
      ctx.arc(x + w, y + ey, 7 + e * 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.55 + e * 0.4})`;
      ctx.beginPath();
      ctx.arc(x + w, y + ey, 2.4, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.font = "600 13px -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = `rgba(${style.ink},${0.5 + e * 0.45})`;
      ctx.fillText(PC_NAMES[dom], x + w - 8, y + ey - 10);
    }
  }
}
