// AnalyserSim — a frame-exact AnalyserNode over rendered PCM.
//
// Why not a real AnalyserNode? Because a real one only yields data in real
// time (or through OfflineAudioContext.suspend()'s promise choreography), and
// every bench in this project is a tight synchronous loop:
//     for (...) inst.render(ctx, analyser, w, h, now)
// This sim keeps that shape while feeding modes REAL audio. It follows the
// WebAudio spec's analyser pipeline exactly — Blackman window, FFT, time
// smoothing, dB conversion, byte quantization — so what a mode sees here is
// what it will see on the Pi. `analysersim-calibration` in the smoke suite
// checks that claim against a live AnalyserNode rather than asserting it.
//
//   const { pcm } = renderSong('rock-e-minor');
//   const sim = new AnalyserSim(pcm, { smoothingTimeConstant: 0.55 });
//   sim.seek(t);                       // advance; smoothing accumulates
//   inst.render(ctx, sim, w, h, now);  // sim IS the analyser

const SPEC_A0 = 0.42, SPEC_A1 = 0.5, SPEC_A2 = 0.08; // Blackman, per spec

// iterative radix-2 Cooley-Tukey, in place
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let j = 0; j < half; j++) {
        const ar = re[i + j], ai = im[i + j];
        const br = re[i + j + half], bi = im[i + j + half];
        const vr = br * cwr - bi * cwi, vi = br * cwi + bi * cwr;
        re[i + j] = ar + vr; im[i + j] = ai + vi;
        re[i + j + half] = ar - vr; im[i + j + half] = ai - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

export class AnalyserSim {
  constructor(pcm, opts = {}) {
    this.pcm = pcm;
    this.sampleRate = opts.sampleRate ?? 48000;
    this.fftSize = opts.fftSize ?? 2048;
    // 0.55 mirrors main.js — NOT the WebAudio default of 0.8. A bench that
    // smooths differently than the app is measuring a different instrument.
    this.smoothingTimeConstant = opts.smoothingTimeConstant ?? 0.55;
    this.minDecibels = opts.minDecibels ?? -100;
    this.maxDecibels = opts.maxDecibels ?? -30;
    this.frequencyBinCount = this.fftSize >> 1;

    this._smooth = new Float32Array(this.frequencyBinCount); // |X| history
    this._re = new Float32Array(this.fftSize);
    this._im = new Float32Array(this.fftSize);
    this._time = new Float32Array(this.fftSize);
    this._win = new Float32Array(this.fftSize);
    for (let i = 0; i < this.fftSize; i++) {
      const x = i / this.fftSize;
      this._win[i] = SPEC_A0 - SPEC_A1 * Math.cos(2 * Math.PI * x) + SPEC_A2 * Math.cos(4 * Math.PI * x);
    }
    this.t = 0;
    this._dirty = true;
  }

  // Advance to time t (seconds). The analysis window is the fftSize samples
  // ENDING here, matching a live node's "most recent block".
  seek(t) {
    this.t = t;
    const end = Math.round(t * this.sampleRate);
    const start = end - this.fftSize;
    for (let i = 0; i < this.fftSize; i++) {
      const s = start + i;
      this._time[i] = s >= 0 && s < this.pcm.length ? this.pcm[s] : 0;
    }
    this._dirty = true;
    return this;
  }

  // step by dt seconds — the shape most benches want
  tick(dt) {
    return this.seek(this.t + dt);
  }

  _analyze() {
    if (!this._dirty) return;
    this._dirty = false;
    const N = this.fftSize, bins = this.frequencyBinCount;
    for (let i = 0; i < N; i++) { this._re[i] = this._time[i] * this._win[i]; this._im[i] = 0; }
    fft(this._re, this._im);
    const tau = this.smoothingTimeConstant;
    for (let k = 0; k < bins; k++) {
      // spec: magnitude normalized by fftSize, then smoothed over time
      const mag = Math.hypot(this._re[k], this._im[k]) / N;
      this._smooth[k] = tau * this._smooth[k] + (1 - tau) * mag;
    }
  }

  getByteFrequencyData(out) {
    this._analyze();
    const { minDecibels: lo, maxDecibels: hi } = this;
    const scale = 255 / (hi - lo);
    for (let k = 0; k < out.length; k++) {
      if (k >= this.frequencyBinCount) { out[k] = 0; continue; }
      const m = this._smooth[k];
      const db = m > 0 ? 20 * Math.log10(m) : -Infinity;
      const v = Math.floor(scale * (db - lo));
      out[k] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }

  getFloatFrequencyData(out) {
    this._analyze();
    for (let k = 0; k < out.length; k++) {
      const m = k < this.frequencyBinCount ? this._smooth[k] : 0;
      out[k] = m > 0 ? 20 * Math.log10(m) : -Infinity;
    }
  }

  getFloatTimeDomainData(out) {
    const n = Math.min(out.length, this.fftSize);
    for (let i = 0; i < n; i++) out[i] = this._time[i];
    for (let i = n; i < out.length; i++) out[i] = 0;
  }

  getByteTimeDomainData(out) {
    const n = Math.min(out.length, this.fftSize);
    for (let i = 0; i < n; i++) {
      const v = Math.round(this._time[i] * 128 + 128);
      out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    for (let i = n; i < out.length; i++) out[i] = 128;
  }
}

// Drive a mode through real audio, frame by frame, deterministically.
//   playThrough(inst, pcm, { seconds: 20, onFrame: (i, t) => {} })
export function playThrough(inst, pcm, opts = {}) {
  const {
    seconds = 20, fps = 60, w = 1920, h = 480, ctx = null,
    startAt = 0, sim = null, onFrame = null, smoothingTimeConstant = 0.55,
  } = opts;
  const an = sim || new AnalyserSim(pcm, { smoothingTimeConstant });
  const c = ctx || document.createElement("canvas").getContext("2d");
  if (!ctx) { c.canvas.width = w; c.canvas.height = h; }
  const dt = 1 / fps;
  let now = 1000;
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    const t = startAt + i * dt;
    an.seek(t);
    now += dt * 1000;
    inst.render(c, an, w, h, now);
    if (onFrame) onFrame(i, t, now, an);
  }
  return { analyser: an, ctx: c, endNow: now };
}
