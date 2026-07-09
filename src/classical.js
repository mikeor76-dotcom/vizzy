// Classical — elegance in motion: intertwined golden silk ribbons made of
// fine luminous strands, golden dust rising off the crests, and a dark
// reflective floor. Palette: deep black, amber, gold, champagne white.

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

export class Classical {
  constructor() {
    this.freq = new Uint8Array(1024);
    this.time = new Uint8Array(2048);
    this.bass = new Smoother(0.5, 0.06);
    this.mid = new Smoother(0.5, 0.08);
    this.treble = new Smoother(0.55, 0.1);
    this.loud = new Smoother(0.4, 0.05);
    this.peak = 0.3;
    this.phase = [Math.random() * 9, Math.random() * 9, Math.random() * 9];
    this.particles = [];
    this.lastNow = 0;
  }

  analyze(analyser, dt) {
    if (analyser) {
      analyser.getByteFrequencyData(this.freq);
      analyser.getByteTimeDomainData(this.time);
    } else {
      this.freq.fill(0);
      this.time.fill(128);
    }
    const band = (lo, hi) => {
      let s = 0;
      for (let i = lo; i < hi; i++) s += this.freq[i];
      return s / ((hi - lo) * 255);
    };
    // adaptive gain, same idea as the other cinematic modes
    const rawLoud = band(1, 372);
    this.peak = Math.max(this.peak * (1 - dt * 0.04), rawLoud, 0.06);
    const gain = Math.min(4, 0.55 / this.peak);
    this.bass.update(Math.min(1, band(1, 11) * gain));
    this.mid.update(Math.min(1, band(11, 92) * gain));
    this.treble.update(Math.min(1, band(92, 372) * 1.6 * gain));
    this.loud.update(Math.min(1, rawLoud * gain));
  }

  // carrier shape: 2-3 graceful crests across the width — enough curvature
  // that an ultrawide display never flattens it into diagonal stripes
  strandY(u, cy, amp, ph, wig) {
    const c = Math.sin(u * TAU * 1.35 + ph) * Math.sin(u * TAU * 0.55 - ph * 0.53 + 1.2);
    return cy + amp * c + wig * Math.sin(u * TAU * 3.1 + ph * 1.7);
  }

  drawRibbon(ctx, w, cy, amp, ph, hue, lum, strands, bright) {
    // soft under-glow first, then the fine strands
    for (let pass = 0; pass < 2; pass++) {
      const n = pass === 0 ? 3 : strands;
      for (let f = 0; f < n; f++) {
        const center = (f - (n - 1) / 2) / Math.max(1, n - 1); // -0.5..0.5
        const off = center * amp * 0.34;
        const core = 1 - Math.abs(center) * 2; // 1 at ribbon center, 0 at edge
        const a = pass === 0 ? 0.07 * bright : (0.18 + 0.42 * core) * bright;
        ctx.strokeStyle = `hsla(${hue} ${pass === 0 ? 70 : 88}% ${
          pass === 0 ? lum : lum + core * 26
        }% / ${a})`;
        ctx.lineWidth = pass === 0 ? 14 : core > 0.75 ? 1.5 : 1.1;
        ctx.beginPath();
        for (let px = 0; px <= w; px += 10) {
          const u = px / w;
          const wig = amp * 0.1 * ((this.time[Math.floor(u * 2047)] - 128) / 128);
          const y = this.strandY(u, cy + off, amp * (1 - Math.abs(center) * 0.25), ph + f * 0.022, wig);
          if (px === 0) ctx.moveTo(px, y);
          else ctx.lineTo(px, y);
        }
        ctx.stroke();
      }
    }
  }

  render(ctx, analyser, w, h, now) {
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.analyze(analyser, dt);

    const bass = this.bass.value;
    const mid = this.mid.value;
    const treble = this.treble.value;
    const loud = this.loud.value;
    const bright = 0.55 + loud * 0.75;
    const cy = h * 0.5;
    const floor = h * 0.86;

    // faint warm hall light behind everything
    const halo = ctx.createRadialGradient(w * 0.5, cy, 0, w * 0.5, cy, Math.max(w, h) * 0.55);
    halo.addColorStop(0, `rgba(120, 85, 40, ${0.05 + loud * 0.05})`);
    halo.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    // ribbon motion: stately by default, swelling with the music
    this.phase[0] += dt * (0.22 + bass * 0.5);
    this.phase[1] += dt * (0.3 + mid * 0.7);
    this.phase[2] += dt * (0.42 + treble * 0.8);

    const ribbons = [
      { amp: h * (0.1 + bass * 0.15), ph: this.phase[0], hue: 33, lum: 42, strands: 12 }, // deep amber
      { amp: h * (0.13 + mid * 0.17), ph: this.phase[1] + 2.1, hue: 43, lum: 55, strands: 14 }, // gold
      { amp: h * (0.07 + treble * 0.12), ph: this.phase[2] + 4.4, hue: 48, lum: 68, strands: 9 }, // champagne
    ];

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // floor reflection: the same ribbons mirrored, squashed and dimmed
    ctx.save();
    ctx.translate(0, floor);
    ctx.scale(1, -0.32);
    ctx.translate(0, -floor);
    ctx.globalAlpha = 0.32;
    for (const r of ribbons) this.drawRibbon(ctx, w, cy, r.amp, r.ph, r.hue, r.lum - 12, Math.min(6, r.strands), bright);
    ctx.restore();

    for (const r of ribbons) this.drawRibbon(ctx, w, cy, r.amp, r.ph, r.hue, r.lum, r.strands, bright);

    // golden dust: spawned off the gold ribbon, drifting upward, twinkling
    const spawnRate = 1 + treble * 5 + loud * 2;
    if (this.particles.length < 220 && Math.random() < spawnRate * dt * 22) {
      const u = Math.random();
      const r = ribbons[Math.random() < 0.6 ? 1 : 2];
      this.particles.push({
        x: u * w,
        y: this.strandY(u, cy, r.amp, r.ph, 0),
        vy: -(4 + Math.random() * 16),
        vx: (Math.random() - 0.5) * 5,
        tw: Math.random() * TAU,
        twSp: 2 + Math.random() * 5,
        life: 2.5 + Math.random() * 2.5,
        age: 0,
        big: Math.random() < 0.12,
      });
    }
    for (const p of this.particles) {
      p.age += dt;
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      const env = Math.min(1, p.age * 2) * Math.max(0, 1 - p.age / p.life);
      const tw = 0.55 + 0.45 * Math.sin(p.tw + p.age * p.twSp);
      const a = env * tw * (0.35 + loud * 0.5);
      ctx.fillStyle = `hsla(45 95% 75% / ${a})`;
      const s = p.big ? 2.2 : 1.3;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      if (p.big) {
        ctx.fillStyle = `hsla(45 95% 82% / ${a * 0.5})`;
        ctx.fillRect(p.x - 3.5, p.y - 0.4, 7, 0.8);
        ctx.fillRect(p.x - 0.4, p.y - 3.5, 0.8, 7);
      }
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    ctx.restore();

    // the floor itself: a dark sheen that swallows the reflection
    const fg = ctx.createLinearGradient(0, floor, 0, h);
    fg.addColorStop(0, "rgba(4, 3, 2, 0.25)");
    fg.addColorStop(1, "rgba(2, 1, 1, 0.85)");
    ctx.fillStyle = fg;
    ctx.fillRect(0, floor, w, h - floor);
  }
}
