// Wave — the clean waveform, but actually alive. Three fixes over the old
// one-line raw draw:
//
// 1. SELF-NORMALIZING. Raw time-domain music sits at ±5-15% of full scale, so
//    an honest waveform is a wiggle. AutoGain couldn't help: Wave was flagged
//    "linear", which solves gain against the loudest FREQUENCY BIN — a totally
//    different scale from time-domain excursion (a hot bass bin reads ~0.85
//    while the waveform is at 0.15), so it concluded "signal is hot" and left
//    the wave tiny. Wave now tracks its OWN excursion peak (fast attack, slow
//    release) and is registered `auto: null` — self-governing, like the scenes.
// 2. SOFT-KNEE EXPANSION. |x|^0.7 lifts mid-level passages far more than peaks,
//    so the 90% of music between the drops reads big instead of flat.
// 3. OSCILLOSCOPE TRIGGER. The old draw started at a free-running sample index,
//    so periodic content jittered randomly every frame. Anchoring each frame at
//    a rising zero-crossing makes bass lines and vocals stand still and MORPH.
//
// Plus a glow (wide faint stroke under a thin bright core — additive, no
// shadowBlur) and a kick accent that thickens the line. Pi-cheap: one path,
// two strokes.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Wave {
  constructor() {
    this.cfg = { preset: "Default" }; // no sensitivity: this mode self-governs
    // FLOAT time-domain data, not byte: we amplify heavily, and getByteTime-
    // DomainData's 256 levels turn into a visible staircase once a quiet song's
    // ~20 occupied levels get stretched over 400px. Floats have no such steps.
    this.time = new Float32Array(2048);
    this.byte = new Uint8Array(2048); // fallback for analysers without the float API
    this.freq = new Uint8Array(1024);
    this.peak = 0.05; // recent excursion peak — what the wave actually displays
    this.beat = 0;
    this._prevBass = 0;
    this.lastNow = 0;
  }

  render(ctx, analyser, w, h, now) {
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    if (!analyser) return; // registry idle:false — only draws with the mic live
    if (analyser.getFloatTimeDomainData) analyser.getFloatTimeDomainData(this.time);
    else {
      analyser.getByteTimeDomainData(this.byte);
      for (let i = 0; i < this.byte.length; i++) this.time[i] = (this.byte[i] - 128) / 128;
    }
    analyser.getByteFrequencyData(this.freq);
    const N = this.time.length;

    // ---- normalize on the EXCURSION, not the spectrum ---------------------
    let maxExc = 0;
    for (let i = 0; i < N; i += 2) {
      const e = Math.abs(this.time[i]);
      if (e > maxExc) maxExc = e;
    }
    // fast attack so a transient shows instantly; slow release so the wave
    // doesn't pump between beats
    this.peak = maxExc > this.peak ? this.peak + (maxExc - this.peak) * 0.35 : Math.max(0.015, this.peak * (1 - dt * 0.22));
    const gain = Math.min(30, 0.8 / Math.max(0.015, this.peak));

    // ---- kick accent -------------------------------------------------------
    let b = 0;
    for (let i = 1; i < 12; i++) b += this.freq[i];
    b /= 11 * 255;
    const flux = Math.max(0, b - this._prevBass);
    this._prevBass = b;
    if (flux > 0.05 && b > 0.22) this.beat = 1;
    this.beat = Math.max(0, this.beat - dt * 3.5);

    // ---- trigger: anchor at a rising zero-crossing so the wave holds still --
    let start = 0;
    const scan = 900;
    for (let i = 1; i < scan; i++) {
      if (this.time[i - 1] < 0 && this.time[i] >= 0) {
        start = i;
        break;
      }
    }

    // ---- build the path once: normalized, soft-knee expanded --------------
    const span = 1024; // start(<900) + span stays inside the 2048 buffer
    const amp = h * 0.42;
    const mid = h / 2;
    const step = Math.max(1, Math.round(span / Math.max(240, w / 3))); // ~1 pt per 3px
    ctx.beginPath();
    for (let i = 0; i < span; i += step) {
      const e = clamp(this.time[start + i] * gain, -1, 1);
      const shaped = Math.sign(e) * Math.pow(Math.abs(e), 0.7); // lift the mids
      const x = (i / span) * w;
      const y = mid - shaped * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // ---- two strokes: a wide faint halo under a bright core ---------------
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#7c5cff");
    grad.addColorStop(1, "#ff5c8a");
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = grad;
    ctx.globalAlpha = 0.1 + this.beat * 0.06;
    ctx.lineWidth = 9 + this.beat * 5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.2 + this.beat * 1.6;
    ctx.stroke();
    ctx.restore();
  }
}
