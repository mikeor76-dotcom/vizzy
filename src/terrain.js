// Audio Terrain — the song becomes a landscape. Parallax ridges scroll across
// the full width; each new sliver of skyline is extruded from the live audio,
// so the mountains receding behind you ARE the last ~30 seconds of the music.
// Far ridges are slow and bass-shaped (great slow peaks); near ridges are fast
// and treble-shaped (jagged foothills). The sky colour and a low sun/moon
// answer the overall intensity. Built for a 4:1 panel — all horizontal gesture.
//
// Pi-friendly: each ridge is a ring buffer of heights, drawn as ONE filled
// polygon per frame. No per-pixel work, no shadowBlur.

const TAU = Math.PI * 2;

class Smoother {
  constructor(attack = 0.5, decay = 0.12) {
    this.value = 0;
    this.attack = attack;
    this.decay = decay;
  }
  update(target) {
    const k = target > this.value ? this.attack : this.decay;
    this.value += (target - this.value) * k;
    return this.value;
  }
}

// each ridge: which band feeds it, scroll speed (px/s), vertical scale, the
// horizon fraction it sits on, and its colours (near = dark/warm silhouette,
// far = pale/hazy). Ordered far → near so we draw back to front.
// far → near. `smooth` shapes the silhouette: distant ranges are smooth slow
// mountains, near foothills are jagged. `rim` is the moonlit edge brightness
// that separates each ridge from the one behind it.
const RIDGES = [
  { band: [1, 10], speed: 10, amp: 0.32, base: 0.5, colTop: "#38426e", colBot: "#222a52", haze: 0.6, smooth: [0.28, 0.14], rim: 0.16 },
  { band: [4, 22], speed: 20, amp: 0.42, base: 0.63, colTop: "#2a3157", colBot: "#171d3a", haze: 0.4, smooth: [0.34, 0.18], rim: 0.24 },
  { band: [16, 70], speed: 42, amp: 0.52, base: 0.78, colTop: "#1a2038", colBot: "#0a0f1e", haze: 0.2, smooth: [0.48, 0.32], rim: 0.34 },
  { band: [50, 200], speed: 80, amp: 0.62, base: 0.94, colTop: "#0f1220", colBot: "#04060e", haze: 0, smooth: [0.62, 0.46], rim: 0.46 },
];

const PALETTES = {
  Dusk: { top: "#0b1030", mid: "#2a2450", low: "#7a4a5a", sun: "255,150,120", sunUp: false },
  Midnight: { top: "#02030c", mid: "#061024", low: "#123048", sun: "225,235,255", sunUp: true },
  Ember: { top: "#160a14", mid: "#3a1424", low: "#8a3020", sun: "255,140,70", sunUp: false },
  Boreal: { top: "#02060f", mid: "#04121c", low: "#0a3038", sun: "150,240,220", sunUp: true },
};

const COLS = 220; // ring-buffer resolution per ridge (interpolated to width)

export class Terrain {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Midnight" };
    this.freq = new Uint8Array(1024);
    this.time = new Uint8Array(2048);
    this.peak = 0.3;
    this.loud = new Smoother(0.35, 0.03);
    this.bass = new Smoother(0.5, 0.06);
    this.intensity = new Smoother(0.08, 0.02); // slow mood for sky/sun
    this.t = 0;
    this.lastNow = 0;
    // per-ridge ring buffers + fractional scroll accumulators + shapers
    this.buffers = RIDGES.map(() => new Float32Array(COLS + 2).fill(0.15));
    this.acc = RIDGES.map(() => 0);
    this.shaper = RIDGES.map((R) => new Smoother(R.smooth[0], R.smooth[1]));
    this.stars = null;
    this.starKey = "";
  }

  analyze(analyser, dt) {
    if (analyser) {
      analyser.getByteFrequencyData(this.freq);
      analyser.getByteTimeDomainData(this.time);
    } else {
      this.freq.fill(0);
      this.time.fill(128);
    }
    const s = this.cfg.sensitivity;
    const band = (lo, hi) => {
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += this.freq[i];
      return sum / ((hi - lo) * 255);
    };
    const rawLoud = band(1, 372);
    this.peak = Math.max(this.peak * (1 - dt * 0.04), rawLoud, 0.06);
    this.gain = Math.min(6, (0.55 / this.peak) * s);
    this.loud.update(Math.min(1, rawLoud * this.gain));
    this.bass.update(Math.min(1, band(1, 11) * this.gain));
    this.intensity.update(Math.min(1, rawLoud * this.gain));
  }

  // advance a ridge: push new sculpted columns as it scrolls left, so the
  // silhouette encodes the recent history of that ridge's band
  advance(idx, w, dt) {
    const R = RIDGES[idx];
    const buf = this.buffers[idx];
    const colW = w / COLS;
    this.acc[idx] += R.speed * dt;
    let pushes = 0;
    while (this.acc[idx] >= colW && pushes < COLS) {
      this.acc[idx] -= colW;
      buf.copyWithin(0, 1); // shift left
      const raw = this.freq.length
        ? (() => {
            let sum = 0;
            for (let k = R.band[0]; k < R.band[1]; k++) sum += this.freq[k];
            return Math.min(1, (sum / ((R.band[1] - R.band[0]) * 255)) * (this.gain || 1) * 1.3);
          })()
        : 0.15;
      // shape it so peaks are hills, not spikes; a raised floor keeps valleys
      // from collapsing to the horizon between beats (reads as ground, not teeth)
      const shaped = this.shaper[idx].update(0.2 + raw * 0.8);
      buf[buf.length - 1] = shaped;
      pushes++;
    }
  }

  initStars(w, h) {
    const n = Math.round((w * h) / 12000);
    this.stars = [];
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: Math.random() * w, y: Math.random() * h * 0.6,
        r: Math.random() < 0.85 ? 0.7 : 1.3,
        tw: Math.random() * TAU, sp: 0.5 + Math.random() * 2, base: 0.2 + Math.random() * 0.45,
      });
    }
    this.starKey = `${w}x${h}`;
  }

  drawRidge(ctx, idx, w, h) {
    const R = RIDGES[idx];
    const buf = this.buffers[idx];
    const colW = w / COLS;
    const horizon = h * R.base;
    const amp = h * R.amp;
    const frac = this.acc[idx] / colW; // sub-column offset for smooth scroll
    const g = ctx.createLinearGradient(0, horizon - amp, 0, h);
    g.addColorStop(0, R.colTop);
    g.addColorStop(1, R.colBot);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let c = 0; c <= COLS; c++) {
      const v = buf[c] * (1 - frac) + buf[c + 1] * frac;
      const x = c * colW - frac * colW;
      ctx.lineTo(x, horizon - v * amp);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    // moonlit rim on the crest: separates each silhouette from the one behind.
    // Near ridges catch more moonlight (brighter rim); far ridges read as haze.
    ctx.strokeStyle = `rgba(150,175,225,${R.rim * (0.5 + this.loud.value * 0.5)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) {
      const v = buf[c] * (1 - frac) + buf[c + 1] * frac;
      const x = c * colW - frac * colW;
      if (c === 0) ctx.moveTo(x, horizon - v * amp);
      else ctx.lineTo(x, horizon - v * amp);
    }
    ctx.stroke();
  }

  render(ctx, analyser, w, h, now) {
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t += dt;
    this.analyze(analyser, dt);
    if (!this.stars || this.starKey !== `${w}x${h}`) this.initStars(w, h);
    for (let i = 0; i < RIDGES.length; i++) this.advance(i, w, dt);

    const pal = PALETTES[this.cfg.preset] || PALETTES.Midnight;
    const inten = this.intensity.value;

    // sky: darker/cooler when calm, warmer & brighter toward the horizon when
    // the music lifts (the low band slides in on intensity)
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.92);
    sky.addColorStop(0, pal.top);
    sky.addColorStop(0.55, pal.mid);
    sky.addColorStop(1, pal.low);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    if (inten > 0.02) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, inten * 0.6);
      ctx.fillStyle = pal.low;
      ctx.fillRect(0, h * 0.45, w, h * 0.5);
      ctx.restore();
    }

    // stars (fade out as the sky brightens)
    const starA = 1 - inten * 0.6;
    for (const s of this.stars) {
      const a = s.base * starA * (0.6 + 0.4 * Math.sin(s.tw + this.t * s.sp));
      if (a <= 0.02) continue;
      ctx.fillStyle = `rgba(220,230,255,${a})`;
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }

    // sun / moon: low over the horizon, breathing with the beat
    const sunX = w * 0.72, sunY = h * (pal.sunUp ? 0.3 : 0.44);
    const sunR = h * 0.09 * (1 + this.bass.value * 0.12);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3.2);
    halo.addColorStop(0, `rgba(${pal.sun},${0.5 + inten * 0.35})`);
    halo.addColorStop(0.4, `rgba(${pal.sun},${0.14 + inten * 0.12})`);
    halo.addColorStop(1, `rgba(${pal.sun},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(sunX - sunR * 3.2, sunY - sunR * 3.2, sunR * 6.4, sunR * 6.4);
    ctx.fillStyle = `rgba(${pal.sun},0.92)`;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, TAU);
    ctx.fill();
    ctx.restore();

    // ridges, far → near
    for (let i = 0; i < RIDGES.length; i++) this.drawRidge(ctx, i, w, h);
  }
}
