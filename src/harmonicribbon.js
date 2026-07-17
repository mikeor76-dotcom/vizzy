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
// Responsibilities are split as the spec asks: push() owns history, _derive()
// owns transformation/smoothing, _repaint() owns geometry+drawing into an
// offscreen (at the 20Hz sample rate, not per frame), draw() blits and adds
// the crisp live text. Zero allocations on the hot paths after warm-up.

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
    this.idx = 0;
    this.count = 0;
    this._eMax = 0.05; // slow-decaying energy scale (thickness normalizer)

    // derived control-point tracks (preallocated; filled by _derive)
    this._m12 = new Float32Array(12 * SEG); // per-class downsampled weights
    this._tot = new Float32Array(SEG);
    this._dom = new Int8Array(SEG);
    this._y = new Float32Array(SEG);
    this._hw = new Float32Array(SEG);
    this._tmp = new Float32Array(SEG);

    this.rib = null; // offscreen
    this._key = "";
    this._dirty = true;
  }

  push(chroma12) {
    let tot = 0;
    for (let pc = 0; pc < 12; pc++) {
      const v = chroma12[pc];
      this.hist[pc * RIB_COLS + this.idx] = v;
      tot += v;
    }
    this.idx = (this.idx + 1) % RIB_COLS; // ring: history never exceeds 30s
    this.count++;
    this._eMax = Math.max(this._eMax * (1 - 1 / (RIB_HZ * 20)), tot, 0.05);
    this._dirty = true;
  }

  // for the bench: what the newest control point says
  status() {
    this._derive(100); // height only scales geometry; any sane value works
    const i = SEG - 1;
    return {
      domPc: this._dom[i],
      domName: PC_NAMES[this._dom[i]],
      energy: this._tot[i] / Math.max(0.05, this._eMax),
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
    for (let pc = 0; pc < 12; pc++) this._smooth(m.subarray(pc * SEG, pc * SEG + SEG), 2);

    // dominant per point, STICKY: argmax flickers on near-ties, and a ribbon
    // that trills between two lanes on every tie reads as broken. The
    // incumbent keeps the lane unless a challenger clearly beats it.
    let prev = -1;
    for (let i = 0; i < SEG; i++) {
      let best = 0, bestV = -1;
      for (let pc = 0; pc < 12; pc++) {
        const v = m[pc * SEG + i];
        if (v > bestV) { bestV = v; best = pc; }
      }
      if (prev >= 0 && m[prev * SEG + i] >= bestV * 0.9) best = prev;
      this._dom[i] = best;
      prev = best;
    }

    // lane -> y, then heavy smoothing: chord changes are steps in the data,
    // and the easing turns them into the glide the spec asks for while a real
    // modulation still reads as a decisive move
    const pad = plotH * 0.1;
    const laneH = (plotH - pad * 2) / 11;
    for (let i = 0; i < SEG; i++) this._y[i] = pad + SLOT_OF[this._dom[i]] * laneH;
    this._smooth(this._y, 4);

    // thickness: total energy against the rolling scale — silence thins to a
    // hairline instead of freezing
    for (let i = 0; i < SEG; i++) {
      const e = Math.min(1, this._tot[i] / Math.max(0.05, this._eMax));
      this._hw[i] = plotH * (0.012 + 0.16 * e);
    }
    this._smooth(this._hw, 2);
  }

  _repaint(w, h, style) {
    if (!this._dirty && this.rib && this._key === `${w}x${h}|${style.id}`) return;
    const key = `${w}x${h}|${style.id}`;
    if (!this.rib || this._key !== key) {
      this.rib = document.createElement("canvas");
      this.rib.width = Math.max(2, Math.round(w));
      this.rib.height = Math.max(2, Math.round(h));
      this._key = key;
    }
    this._dirty = false;
    this._derive(h);

    const c = this.rib.getContext("2d");
    c.clearRect(0, 0, w, h); // the panel keeps the mode's dark background
    const xs = this._tmp;
    for (let i = 0; i < SEG; i++) xs[i] = (i / (SEG - 1)) * w;
    const recency = (i) => 0.42 + 0.58 * Math.pow(i / (SEG - 1), 1.6);

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
        // rank this class at point i
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
        // hover around the main ribbon, offset by harmonic distance: close
        // relatives hug it, remote classes sit visibly apart
        const off = (circDist(SLOT_OF[pc], SLOT_OF[this._dom[i]]) / 6) * h * 0.3;
        const py = this._y[i] + off;
        const px = xs[i];
        if (i === 0) c.moveTo(px, py);
        else {
          const offP = (circDist(SLOT_OF[pc], SLOT_OF[this._dom[i - 1]]) / 6) * h * 0.3;
          c.quadraticCurveTo(xs[i - 1], this._y[i - 1] + offP, (xs[i - 1] + px) / 2, (this._y[i - 1] + offP + py) / 2);
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
        const e = Math.min(1, this._tot[i] / Math.max(0.05, this._eMax));
        gr.addColorStop(i / (SEG - 1), `rgba(${r},${g},${b},${((0.1 + e * 0.8) * recency(i) * aScale).toFixed(3)})`);
      }
      return gr;
    };
    const edgePath = (sign) => {
      c.moveTo(xs[0], this._y[0] + sign * this._hw[0]);
      for (let i = 1; i < SEG; i++) {
        const mx = (xs[i - 1] + xs[i]) / 2;
        const my = (this._y[i - 1] + sign * this._hw[i - 1] + this._y[i] + sign * this._hw[i]) / 2;
        c.quadraticCurveTo(xs[i - 1], this._y[i - 1] + sign * this._hw[i - 1], mx, my);
      }
      c.lineTo(xs[SEG - 1], this._y[SEG - 1] + sign * this._hw[SEG - 1]);
    };
    c.beginPath();
    edgePath(-1);
    for (let i = SEG - 2; i >= 0; i--) {
      const mx = (xs[i + 1] + xs[i]) / 2;
      const my = (this._y[i + 1] + this._hw[i + 1] + this._y[i] + this._hw[i]) / 2;
      c.quadraticCurveTo(xs[i + 1], this._y[i + 1] + this._hw[i + 1], mx, my);
    }
    c.lineTo(xs[0], this._y[0] + this._hw[0]);
    c.closePath();
    c.fillStyle = mainGrad(0.6);
    c.fill();
    // hot core + a glinting upper edge — restrained bloom, no shadowBlur
    const line = (off, width, aScale) => {
      c.beginPath();
      c.moveTo(xs[0], this._y[0] + off(0));
      for (let i = 1; i < SEG; i++) {
        const mx = (xs[i - 1] + xs[i]) / 2;
        const my = (this._y[i - 1] + off(i - 1) + this._y[i] + off(i)) / 2;
        c.quadraticCurveTo(xs[i - 1], this._y[i - 1] + off(i - 1), mx, my);
      }
      c.strokeStyle = mainGrad(aScale);
      c.lineWidth = width;
      c.stroke();
    };
    line(() => 0, 2.4, 1.0);
    line((i) => -this._hw[i] * 0.8, 1, 0.55);
    c.globalCompositeOperation = "source-over";
  }

  // rect: {x, y, w, h} of the plot area. style: {id, pcRGB(pc)->[r,g,b],
  // dim:[r,g,b], ink:[r,g,b]}
  draw(ctx, rect, style) {
    const { x, y, w, h } = rect;
    this._repaint(w, h, style);
    ctx.drawImage(this.rib, x, y);

    // restrained time scale: small ticks + labels, no grid
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i <= 3; i++) {
      const gx = x + (i / 3) * w;
      ctx.strokeStyle = `rgba(${style.dim},0.4)`;
      ctx.beginPath();
      ctx.moveTo(gx + 0.5, y + h);
      ctx.lineTo(gx + 0.5, y + h + 4);
      ctx.stroke();
      ctx.textAlign = i === 0 ? "left" : i === 3 ? "right" : "center";
      ctx.fillStyle = `rgba(${style.dim},0.8)`;
      ctx.fillText(i === 3 ? "NOW" : `-${30 - i * 10}s`, gx, y + h + 16);
    }
    // the NOW marker
    ctx.strokeStyle = `rgba(${style.ink},0.22)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w + 0.5, y);
    ctx.lineTo(x + w + 0.5, y + h);
    ctx.stroke();

    // endpoint: brighter, defined, and named — hidden in silence
    const st = { dom: this._dom[SEG - 1], y: this._y[SEG - 1], e: Math.min(1, this._tot[SEG - 1] / Math.max(0.05, this._eMax)) };
    if (st.e > 0.06) {
      const [r, g, b] = style.pcRGB(st.dom);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(${r},${g},${b},0.3)`;
      ctx.beginPath();
      ctx.arc(x + w, y + st.y, 7 + st.e * 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.55 + st.e * 0.4})`;
      ctx.beginPath();
      ctx.arc(x + w, y + st.y, 2.4, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.font = "600 13px -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = `rgba(${style.ink},${0.5 + st.e * 0.45})`;
      // tucked inside the panel so it never clips at the display edge
      ctx.fillText(PC_NAMES[st.dom], x + w - 8, y + st.y - 10);
    }
  }
}
