// Shared analysis + motion helpers for the Hi-Fi visualizer modes.
//
// The app has a single mono AnalyserNode fed by the mic, so true stereo
// left/right data is NOT available. HifiAudio derives a tasteful
// pseudo-stereo pair (left/right/spread) from band balance plus very slow
// decorrelation wobble — good enough to make dual meters feel alive
// without lying wildly about the signal.

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// attack/release follower: fast up, slow down = musical metering
export const follow = (cur, target, attack, release) =>
  cur + (target - cur) * (target > cur ? attack : release);

// linear level (0..1) -> perceptual 0..1 meter position via dB
export function dbNorm(v, floor = -48) {
  const db = 20 * Math.log10(Math.max(v, 1e-5));
  return clamp01((db - floor) / -floor);
}

export function bandAvg(freq, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += freq[i];
  return sum / ((to - from) * 255);
}

export class HifiAudio {
  constructor() {
    this.freq = new Uint8Array(1024);
    this.time = new Uint8Array(2048);
    this.time.fill(128);
    this.rms = 0;
    this.bass = 0;
    this.mid = 0;
    this.high = 0;
    this.left = 0;
    this.right = 0;
    this.spread = 0; // 0 = mono/centered, 1 = wide
    this.live = false;
  }

  update(analyser, sensitivity = 1.25, now = performance.now()) {
    let rms = 0,
      bass = 0,
      mid = 0,
      high = 0;
    if (analyser) {
      analyser.getByteFrequencyData(this.freq);
      analyser.getByteTimeDomainData(this.time);
      let sum = 0;
      for (let i = 0; i < this.time.length; i += 4) {
        const s = (this.time[i] - 128) / 128;
        sum += s * s;
      }
      rms = clamp01(Math.sqrt(sum / (this.time.length / 4)) * 1.7 * sensitivity);
      bass = clamp01(bandAvg(this.freq, 2, 26) * 1.25 * sensitivity);
      mid = clamp01(bandAvg(this.freq, 26, 220) * 1.5 * sensitivity);
      high = clamp01(bandAvg(this.freq, 220, 620) * 2.2 * sensitivity);
    } else if (this.live) {
      this.time.fill(128);
      this.freq.fill(0);
    }
    this.live = !!analyser;

    this.rms = follow(this.rms, rms, 0.32, 0.07);
    this.bass = follow(this.bass, bass, 0.4, 0.09);
    this.mid = follow(this.mid, mid, 0.35, 0.09);
    this.high = follow(this.high, high, 0.45, 0.12);

    // pseudo-stereo: slow wobble + spectral tilt so L/R breathe independently
    const wob = Math.sin(now / 830) * 0.6 + Math.sin(now / 2137) * 0.4;
    const tilt = (this.mid - this.high) * 0.3;
    this.left = follow(this.left, clamp01(this.rms * (1 + 0.14 * wob) + tilt * 0.06), 0.3, 0.07);
    this.right = follow(this.right, clamp01(this.rms * (1 - 0.14 * wob) - tilt * 0.06), 0.3, 0.07);
    const spreadTarget = this.live
      ? clamp01(this.high * 1.4 + 0.18 + 0.12 * Math.sin(now / 3070))
      : 0;
    this.spread = follow(this.spread, spreadTarget, 0.06, 0.03);
    return this;
  }
}

// spring/damper needle — mechanical mass, gentle overshoot, physical stops
export class Needle {
  constructor(stiffness = 120, damping = 14) {
    this.k = stiffness;
    this.d = damping;
    this.pos = 0;
    this.vel = 0;
    this._t = 0;
  }
  update(target, now) {
    const dt = Math.min(0.05, this._t ? (now - this._t) / 1000 : 0.016);
    this._t = now;
    this.vel += ((target - this.pos) * this.k - this.vel * this.d) * dt;
    this.pos += this.vel * dt;
    if (this.pos < -0.015) {
      this.pos = -0.015;
      this.vel *= -0.3;
    }
    if (this.pos > 1.03) {
      this.pos = 1.03;
      this.vel *= -0.3;
    }
    return this.pos;
  }
}

export class PeakHold {
  constructor(holdMs = 1100, fallPerSec = 0.4) {
    this.holdMs = holdMs;
    this.fall = fallPerSec;
    this.value = 0;
    this.until = 0;
    this._t = 0;
  }
  update(v, now) {
    const dt = Math.min(0.05, this._t ? (now - this._t) / 1000 : 0.016);
    this._t = now;
    if (v >= this.value) {
      this.value = v;
      this.until = now + this.holdMs;
    } else if (now > this.until) {
      this.value = Math.max(v, this.value - this.fall * dt);
    }
    return this.value;
  }
}

export const pickPalette = (palettes, preset) => palettes[preset] || Object.values(palettes)[0];

// offscreen cache for static artwork (meter faces, grids, deck plates) so the
// per-frame cost is a single drawImage — Raspberry Pi friendly
export function makeCache() {
  return { key: "", canvas: null };
}
export function withCache(cache, key, w, h, draw) {
  const dpr = window.devicePixelRatio || 1;
  const fullKey = `${key}|${w}x${h}|${dpr}`;
  if (cache.key !== fullKey) {
    cache.canvas = document.createElement("canvas");
    cache.canvas.width = Math.max(1, Math.round(w * dpr));
    cache.canvas.height = Math.max(1, Math.round(h * dpr));
    const c = cache.canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(c, w, h);
    cache.key = fullKey;
  }
  return cache.canvas;
}
