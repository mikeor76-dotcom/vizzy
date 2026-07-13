// Aurora — a full-wall northern-lights sky. Curtains of light hang across the
// whole 4:1 display, their silhouette sculpted by a log-spread FFT and their
// colour banded crown→body→hem like the real thing; they drift, ripple, and
// flare with the music, mirrored on a dark water line below. Big-gesture, no
// fine print — reads from across the room on the little 8.8" panel.
//
// Pi-friendly: each curtain is ONE vertical gradient clipped to a jagged path
// (one fill, not per-column), plus sparse additive "rays". No shadowBlur.

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

// crown = upper ray tips, body = the luminous ribbon, hem = bright lower edge
const PALETTES = {
  "Aurora Green": { crown: [150, 90, 255], body: [70, 200, 190], hem: [140, 255, 150] },
  "Solar Violet": { crown: [255, 90, 200], body: [150, 90, 255], hem: [90, 170, 255] },
  "Ice Blue": { crown: [120, 150, 255], body: [90, 210, 240], hem: [190, 240, 255] },
  Ember: { crown: [255, 110, 60], body: [255, 180, 80], hem: [255, 232, 150] },
};

export class Aurora {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Aurora Green" };
    this.freq = new Uint8Array(1024);
    this.time = new Uint8Array(2048);
    this.time.fill(128);
    this.bands = new Float32Array(24);
    this.loud = new Smoother(0.4, 0.05);
    this.flux = new Smoother(0.6, 0.12); // spectral flux → shooting-star trigger
    this._prevLoud = 0;
    this.peak = 0.3;
    this.t = 0;
    this.lastNow = 0;
    this.stars = null;
    this.starKey = "";
    this.shoots = [];
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
    const gain = Math.min(6, (0.55 / this.peak) * s);
    // 24 log-spread bands, fast attack / slow release: ribbons leap then settle
    const B = this.bands.length;
    for (let i = 0; i < B; i++) {
      const lo = Math.round(2 + Math.pow(i / B, 1.6) * 340);
      const hi = Math.max(lo + 1, Math.round(2 + Math.pow((i + 1) / B, 1.6) * 340));
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += this.freq[k];
      const v = Math.min(1, (sum / ((hi - lo) * 255)) * gain * 1.25);
      this.bands[i] += (v - this.bands[i]) * Math.min(1, dt * (v > this.bands[i] ? 10 : 2.2));
    }
    const loud = Math.min(1, rawLoud * gain);
    this.loud.update(loud);
    this.flux.update(Math.max(0, loud - this._prevLoud) * 6);
    this._prevLoud = loud;
  }

  initStars(w, h) {
    const n = Math.round((w * h) / 9000);
    this.stars = [];
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: Math.random() * w,
        y: Math.random() * h * 0.7,
        r: Math.random() < 0.85 ? 0.7 : 1.4,
        tw: Math.random() * TAU,
        sp: 0.6 + Math.random() * 2.4,
        base: 0.25 + Math.random() * 0.5,
      });
    }
    this.starKey = `${w}x${h}`;
  }

  // curtain silhouette height 0..1 at horizontal position u (0..1), for a given
  // drifting layer — smoothstep between bands + a slow traveling undulation
  curtainH(u, phase, squeeze) {
    const B = this.bands.length;
    const p = (((u * squeeze + phase) % 1) + 1) % 1;
    const x = p * (B - 1);
    const i0 = Math.min(B - 2, Math.floor(x));
    const f = x - i0;
    const sm = f * f * (3 - 2 * f);
    const bandV = this.bands[i0] + (this.bands[i0 + 1] - this.bands[i0]) * sm;
    const wob = 0.72 + 0.28 * Math.sin(u * 9.2 + this.t * 1.1 + phase * 6);
    return Math.min(1, bandV * wob * 1.12);
  }

  // one curtain sheet: a jagged-topped band filled with a vertical crown→hem
  // gradient (single fill), then sparse bright rays where the band burns hot
  drawSheet(ctx, w, h, ribbonY, pal, phase, squeeze, rise, alpha, idle) {
    const drop = rise * 0.28; // green hem hangs a little below the ribbon
    const top = ribbonY - rise;
    const g = ctx.createLinearGradient(0, top, 0, ribbonY + drop);
    const [cr, cg, cb] = pal.crown, [br, bg, bb] = pal.body, [hr, hg, hb] = pal.hem;
    g.addColorStop(0.0, `rgba(${cr},${cg},${cb},0)`);
    g.addColorStop(0.22, `rgba(${cr},${cg},${cb},${0.28 * alpha})`);
    g.addColorStop(0.62, `rgba(${br},${bg},${bb},${0.5 * alpha})`);
    g.addColorStop(0.86, `rgba(${hr},${hg},${hb},${0.62 * alpha})`);
    g.addColorStop(1.0, `rgba(${hr},${hg},${hb},0)`);

    const step = Math.max(3, Math.round(w / 320));
    ctx.beginPath();
    ctx.moveTo(0, ribbonY + drop);
    for (let x = 0; x <= w; x += step) {
      const v = idle
        ? 0.35 + 0.25 * Math.sin(x * 0.012 + this.t * 0.6 + phase * 6)
        : this.curtainH(x / w, phase, squeeze);
      ctx.lineTo(x, ribbonY - v * rise);
    }
    ctx.lineTo(w, ribbonY + drop);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();

    // rays: thin bright vertical streaks at hot columns (the aurora's texture)
    const rayStep = Math.max(9, Math.round(w / 150));
    for (let x = 0; x <= w; x += rayStep) {
      const v = idle
        ? 0.35 + 0.25 * Math.sin(x * 0.012 + this.t * 0.6 + phase * 6)
        : this.curtainH(x / w, phase, squeeze);
      if (v < 0.42) continue;
      const rg = ctx.createLinearGradient(0, ribbonY - v * rise, 0, ribbonY + drop * 0.5);
      rg.addColorStop(0, `rgba(${pal.crown[0]},${pal.crown[1]},${pal.crown[2]},0)`);
      rg.addColorStop(0.7, `rgba(${pal.body[0]},${pal.body[1]},${pal.body[2]},${0.34 * alpha * v})`);
      rg.addColorStop(1, `rgba(${pal.hem[0]},${pal.hem[1]},${pal.hem[2]},0)`);
      ctx.fillStyle = rg;
      ctx.fillRect(x, ribbonY - v * rise, 1.5, v * rise + drop * 0.5);
    }
  }

  render(ctx, analyser, w, h, now) {
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t += dt;
    this.analyze(analyser, dt);
    if (!this.stars || this.starKey !== `${w}x${h}`) this.initStars(w, h);

    const pal = PALETTES[this.cfg.preset] || PALETTES["Aurora Green"];
    const live = !!analyser;
    const loud = this.loud.value;
    const idle = !live;

    // night sky
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#01030c");
    sky.addColorStop(0.55, "#03071a");
    sky.addColorStop(1, "#050c22");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // stars, twinkling
    for (const s of this.stars) {
      const a = s.base * (0.6 + 0.4 * Math.sin(s.tw + this.t * s.sp));
      ctx.fillStyle = `rgba(220,230,255,${a})`;
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }

    const ribbonY = h * 0.6;
    const baseVis = idle ? 0.5 : 0.35 + loud * 0.9;
    // three sheets at different drift / squeeze / height / hue-shift = depth
    const layers = [
      { phase: this.t * 0.012, squeeze: 1.0, rise: h * 0.5, a: 0.9, dy: 0 },
      { phase: this.t * 0.019 + 0.4, squeeze: 1.5, rise: h * 0.36, a: 0.7, dy: -h * 0.05 },
      { phase: -this.t * 0.009 + 0.7, squeeze: 0.7, rise: h * 0.62, a: 0.55, dy: h * 0.04 },
    ];

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // reflection on the water below: same curtains, mirrored + squashed + dim
    const waterY = h * 0.82;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, waterY, w, h - waterY);
    ctx.clip();
    ctx.translate(0, waterY * 2);
    ctx.scale(1, -0.5);
    ctx.globalAlpha = 0.3;
    for (const L of layers) this.drawSheet(ctx, w, h, ribbonY + L.dy, pal, L.phase, L.squeeze, L.rise, baseVis * L.a, idle);
    ctx.restore();

    // the curtains themselves
    for (const L of layers) this.drawSheet(ctx, w, h, ribbonY + L.dy, pal, L.phase, L.squeeze, L.rise, baseVis * L.a, idle);

    // shooting stars, born on strong spectral-flux hits
    if (live && this.flux.value > 0.6 && this.shoots.length < 3 && Math.random() < 0.15) {
      this.shoots.push({
        x: Math.random() * w, y: Math.random() * h * 0.35,
        vx: (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 180),
        vy: 60 + Math.random() * 90, age: 0, life: 0.7 + Math.random() * 0.4,
      });
    }
    for (const s of this.shoots) {
      s.age += dt; s.x += s.vx * dt; s.y += s.vy * dt;
      const env = Math.max(0, 1 - s.age / s.life);
      ctx.strokeStyle = `rgba(230,240,255,${env * 0.8})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.05, s.y - s.vy * 0.05);
      ctx.stroke();
    }
    this.shoots = this.shoots.filter((s) => s.age < s.life);
    ctx.restore();

    // water sheen: a dark reflective sheet that swallows the reflection's base
    const wsh = ctx.createLinearGradient(0, waterY, 0, h);
    wsh.addColorStop(0, "rgba(3,7,20,0.15)");
    wsh.addColorStop(1, "rgba(2,4,12,0.75)");
    ctx.fillStyle = wsh;
    ctx.fillRect(0, waterY, w, h - waterY);
    // horizon line glow
    ctx.fillStyle = `rgba(${pal.hem[0]},${pal.hem[1]},${pal.hem[2]},${0.06 + loud * 0.1})`;
    ctx.fillRect(0, waterY - 1, w, 2);
  }
}
