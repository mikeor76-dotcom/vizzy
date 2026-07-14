// Spectrum — a cinematic multi-color spectrum analyzer: neon rainbow bars
// with bloom, falling peak caps, rising sparks, and a dark reflective floor.

export class Spectrum {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Default" }; // driven by AutoGain
    this.freq = new Uint8Array(1024);
    this.smooth = new Float32Array(200);
    this.peaks = new Float32Array(200);
    this.peakVel = new Float32Array(200);
    this.particles = [];
    this.lastNow = 0;
    this.hueShift = 0;
  }

  render(ctx, analyser, w, h, now) {
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    analyser.getByteFrequencyData(this.freq);

    const floor = h * 0.8;
    const count = Math.max(48, Math.min(180, Math.floor(w / 11)));
    const gap = 2;
    const barW = w / count - gap;
    this.hueShift = (this.hueShift + dt * 6) % 360;

    // ---- bars with bloom, reflections, peak caps
    for (let i = 0; i < count; i++) {
      // log-ish bin mapping spreads the highs out
      const bin = Math.floor(Math.pow(i / count, 1.55) * 0.7 * this.freq.length);
      const v = Math.min(1, (this.freq[bin] / 255) * this.cfg.sensitivity);
      // fast attack, slow decay keeps motion lively but not jittery
      this.smooth[i] = v > this.smooth[i] ? v : Math.max(0, this.smooth[i] - dt * 1.6);
      const sv = this.smooth[i];
      const bh = Math.max(2, sv * floor * 0.9);
      const x = i * (barW + gap) + gap / 2;
      const hue = (i / count) * 330 + this.hueShift;

      // falling peak caps
      if (sv >= this.peaks[i]) {
        this.peaks[i] = sv;
        this.peakVel[i] = 0;
      } else {
        this.peakVel[i] += dt * 0.9;
        this.peaks[i] = Math.max(sv, this.peaks[i] - this.peakVel[i] * dt);
      }

      // bloom pass + core + hot tip
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `hsla(${hue} 90% 55% / 0.12)`;
      ctx.fillRect(x - barW * 0.9, floor - bh, barW * 2.8, bh);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `hsl(${hue} 92% ${48 + sv * 22}%)`;
      ctx.fillRect(x, floor - bh, barW, bh);
      if (sv > 0.25) {
        ctx.fillStyle = `hsl(${hue} 100% ${72 + sv * 18}%)`;
        ctx.fillRect(x, floor - bh, barW, Math.min(6, bh));
      }

      // peak cap dot
      const py = floor - this.peaks[i] * floor * 0.9 - 4;
      ctx.fillStyle = `hsla(${hue} 100% 78% / 0.9)`;
      ctx.fillRect(x + barW * 0.2, py, barW * 0.6, 2.5);

      // reflection on the floor
      ctx.fillStyle = `hsla(${hue} 90% 55% / ${0.05 + sv * 0.13})`;
      ctx.fillRect(x, floor + 2, barW, bh * 0.3);

      // strong hits launch a rising spark
      if (sv > 0.55 && Math.random() < sv * 0.06 && this.particles.length < 130) {
        this.particles.push({
          x: x + barW / 2,
          y: floor - bh,
          vy: -(28 + Math.random() * 70),
          vx: (Math.random() - 0.5) * 8,
          hue,
          life: 1,
        });
      }
    }

    // ---- rising sparks
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      p.life -= dt * 0.55;
      if (p.life <= 0) continue;
      ctx.fillStyle = `hsla(${p.hue} 100% 75% / ${p.life * 0.85})`;
      ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
      ctx.fillStyle = `hsla(${p.hue} 100% 65% / ${p.life * 0.2})`;
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    ctx.globalCompositeOperation = "source-over";

    // floor line glow
    const fl = ctx.createLinearGradient(0, 0, w, 0);
    for (let s = 0; s <= 4; s++) fl.addColorStop(s / 4, `hsla(${(this.hueShift + s * 66) % 360} 90% 60% / 0.5)`);
    ctx.fillStyle = fl;
    ctx.fillRect(0, floor, w, 1.5);
  }
}
