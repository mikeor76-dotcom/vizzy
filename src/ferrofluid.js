// Ferrofluid — a pure-black liquid mass floating in a glowing geometric void.
// No fluid solver (a real GLSL sim would be Pi-hostile at 1920x480); instead a
// POLAR METABALL model captures the physics look exactly: the blob's radius
// profile is sculpted by the 20-80Hz bins into sharp magnetic spike-cones
// (Rosensweig instability). A heavy bass transient fires a "rupture" — the
// spikes stab out razor-sharp, a shockwave ring blows off the surface, and
// droplets are ejected then magnetically dragged back in.
//
// Pi-friendly: one polygon fill for the body, one rim stroke, a couple of
// additive gradients — no per-pixel work, no shadowBlur. ~0.3ms/frame.

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

// body stays near-black; the palette colours the void, the chrome rim, the
// specular hit, and the under-glow bloom
const PALETTES = {
  "Chrome Cyan": { void: [40, 210, 255], rim: [190, 255, 255], glow: [40, 190, 255], spec: [235, 255, 255] },
  Magma: { void: [255, 90, 40], rim: [255, 205, 130], glow: [255, 110, 40], spec: [255, 238, 200] },
  Violet: { void: [165, 90, 255], rim: [222, 185, 255], glow: [150, 80, 255], spec: [242, 228, 255] },
  Mercury: { void: [150, 172, 205], rim: [238, 246, 255], glow: [120, 150, 195], spec: [255, 255, 255] },
};

const N = 18; // spike slots around the blob (magnetic peaks)
const M = 224; // silhouette sample points

export class Ferrofluid {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Chrome Cyan" };
    this.freq = new Uint8Array(1024);
    this.spikes = new Float32Array(N);
    this.slotBin = new Int16Array(N);
    this.slotW = new Float32Array(N);
    this.slotHalf = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // each slot is driven mostly by 20-80Hz (bins ~1-4) with a little reach
      // into the low-mids so the 18 peaks don't all move as one
      this.slotBin[i] = 1 + Math.round((i / N) * 9); // bins 1..10
      // varied per-slot sensitivity + spike width so the array reads as an
      // organic liquid, not a perfectly regular gear
      this.slotW[i] = 0.55 + 0.75 * ((i * 7 + 3) % 5) / 4;
      this.slotHalf[i] = (TAU / N) * (0.5 + 0.28 * ((i * 3 + 1) % 4) / 3);
    }
    this.bass = new Smoother(0.6, 0.08);
    this._prevBass = 0;
    this.treble = new Smoother(0.5, 0.12);
    this.loud = new Smoother(0.4, 0.05);
    this.rupture = 0;
    this.rot = 0;
    this.peak = 0.3;
    this.t = 0;
    this.lastNow = 0;
    this.sats = []; // ejected droplets
    this.rings = []; // shockwaves
    this.field = null; // drifting void particles (magnetic dust)
    this.fieldKey = "";
  }

  analyze(analyser, dt) {
    if (analyser) analyser.getByteFrequencyData(this.freq);
    else this.freq.fill(0);
    const s = this.cfg.sensitivity;
    const band = (lo, hi) => {
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += this.freq[i];
      return sum / ((hi - lo) * 255);
    };
    const rawLoud = band(1, 372);
    this.peak = Math.max(this.peak * (1 - dt * 0.04), rawLoud, 0.06);
    const gain = Math.min(6, (0.55 / this.peak) * s);
    const rawBass = band(1, 4); // ~20-86Hz — the magnetic driver
    const bass = this.bass.update(Math.min(1, rawBass * gain));
    this.treble.update(Math.min(1, band(92, 372) * gain * 1.4));
    this.loud.update(Math.min(1, rawLoud * gain));

    // per-slot spike targets, snap out fast, retract slowly (surface tension)
    for (let i = 0; i < N; i++) {
      const b = this.freq[this.slotBin[i]] / 255;
      const target = Math.min(1.3, b * gain * this.slotW[i]);
      this.spikes[i] += (target - this.spikes[i]) * Math.min(1, dt * (target > this.spikes[i] ? 26 : 7));
    }

    // rupture on a bass TRANSIENT — the rising edge of a kick — so it fires
    // even under a sustained sub (level-vs-baseline would be masked by it)
    const flux = Math.max(0, bass - this._prevBass);
    this._prevBass = bass;
    if (flux > 0.045 && bass > 0.28 && this.rupture < 0.5) {
      this.rupture = 1;
      this.rings.push({ r0: 1, age: 0, life: 0.9 });
      const nEj = 1 + (Math.random() < 0.5 ? 1 : 0);
      for (let k = 0; k < nEj; k++) {
        const a = Math.random() * TAU;
        const sp = 260 + Math.random() * 220;
        this.sats.push({ x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, r: 6 + Math.random() * 8, age: 0 });
      }
    }
    this.rupture = Math.max(0, this.rupture - dt * 2.6);
  }

  initField(w, h) {
    const n = 46;
    this.field = [];
    for (let i = 0; i < n; i++) {
      this.field.push({ x: Math.random() * w, y: Math.random() * h, a: 0.1 + Math.random() * 0.25, sp: 4 + Math.random() * 10 });
    }
    this.fieldKey = `${w}x${h}`;
  }

  // radius of the silhouette at angle th, given the base radius + spike cones
  radiusAt(th, base, spikeScale, sharp, treble, maxR) {
    let sp = 0;
    for (let k = 0; k < N; k++) {
      const ang = (k / N) * TAU + this.rot;
      let d = ((th - ang) % TAU + TAU) % TAU;
      if (d > Math.PI) d = TAU - d;
      const halfW = this.slotHalf[k];
      if (d < halfW) sp += this.spikes[k] * Math.pow(1 - d / halfW, sharp); // sharp cone
    }
    // fine fractal shimmer on the surface (treble), strongest during a rupture
    const shimmer = treble * (0.5 + this.rupture) * 0.05 * Math.sin(th * 11 + this.t * 6);
    const r = base + sp * spikeScale + base * shimmer;
    return maxR ? Math.min(r, maxR) : r; // never stab off the panel
  }

  blobPath(ctx, cx, cy, base, spikeScale, sharp, treble, maxR) {
    ctx.beginPath();
    for (let i = 0; i <= M; i++) {
      const th = (i / M) * TAU;
      const r = this.radiusAt(th, base, spikeScale, sharp, treble, maxR);
      const x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  render(ctx, analyser, w, h, now) {
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t += dt;
    this.analyze(analyser, dt);
    if (!this.field || this.fieldKey !== `${w}x${h}`) this.initField(w, h);

    const pal = PALETTES[this.cfg.preset] || PALETTES["Chrome Cyan"];
    const idle = !analyser;
    const bass = idle ? 0.25 + 0.12 * Math.sin(this.t * 0.8) : this.bass.value;
    const treble = this.treble.value;
    const loud = idle ? 0.3 : this.loud.value;
    if (idle) {
      // gentle breathing spikes when silent
      for (let i = 0; i < N; i++) this.spikes[i] = 0.18 + 0.12 * Math.sin(this.t * 0.7 + i * 1.3);
    }
    this.rot += dt * (0.05 + bass * 0.12);

    const cx = w / 2, cy = h * 0.52;
    const base = h * 0.155 * (1 + bass * 0.22);
    const spikeScale = base * (0.6 + this.rupture * 0.95);
    const sharp = 1.5 + this.rupture * 2.8; // pointier on rupture
    const maxR = h * 0.46; // keep the tallest spike on the panel
    const [vr, vg, vb] = pal.void, [rr, rg, rb] = pal.rim, [gr, gg, gb] = pal.glow;

    // --- the glowing geometric void ------------------------------------
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.62);
    bg.addColorStop(0, `rgba(${vr},${vg},${vb},${0.05 + loud * 0.05})`);
    bg.addColorStop(0.5, "rgba(3,5,10,0.9)");
    bg.addColorStop(1, "#010204");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // magnetic field: concentric rings pulsing with the bass, + a slowly
    // rotating hexagon that fills the wide void with geometry
    for (let k = 0; k < 5; k++) {
      const rr2 = base * (1.5 + k * 0.9) * (1 + bass * 0.14);
      ctx.strokeStyle = `rgba(${vr},${vg},${vb},${(0.05 + bass * 0.06) * (1 - k / 6)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, rr2, 0, TAU);
      ctx.stroke();
    }
    const hexR = Math.min(w * 0.46, h * 1.4);
    ctx.strokeStyle = `rgba(${vr},${vg},${vb},${0.05 + loud * 0.05})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * TAU + this.rot * 0.3;
      const x = cx + Math.cos(a) * hexR, y = cy + Math.sin(a) * hexR * 0.5;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // magnetic dust: particles drifting inward toward the mass
    for (const p of this.field) {
      const dx = cx - p.x, dy = cy - p.y;
      const dl = Math.hypot(dx, dy) || 1;
      p.x += (dx / dl) * p.sp * dt * (0.5 + bass);
      p.y += (dy / dl) * p.sp * dt * (0.5 + bass);
      if (dl < base * 1.1) { p.x = Math.random() * w; p.y = Math.random() * h; }
      ctx.fillStyle = `rgba(${vr},${vg},${vb},${p.a * (0.5 + bass * 0.5)})`;
      ctx.fillRect(p.x, p.y, 1.4, 1.4);
    }

    // shockwave rings from ruptures
    for (const rg2 of this.rings) {
      rg2.age += dt;
      const f = rg2.age / rg2.life;
      const r = base * (1 + f * 2.4);
      ctx.strokeStyle = `rgba(${rr},${rg},${rb},${(1 - f) * 0.5})`;
      ctx.lineWidth = 2 * (1 - f);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    }
    this.rings = this.rings.filter((r) => r.age < r.life);

    // under-glow bloom behind the mass
    const bloom = ctx.createRadialGradient(cx, cy, base * 0.3, cx, cy, base * 2.1);
    bloom.addColorStop(0, `rgba(${gr},${gg},${gb},${0.25 + loud * 0.25 + this.rupture * 0.3})`);
    bloom.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
    ctx.fillStyle = bloom;
    ctx.fillRect(cx - base * 2.1, cy - base * 2.1, base * 4.2, base * 4.2);
    ctx.restore();

    // --- the liquid mass ----------------------------------------------
    // droplets first (behind the rim glow), pulled back magnetically
    for (const s of this.sats) {
      s.age += dt;
      // spring back to center (magnetism)
      s.vx += (cx - (cx + s.x)) * 0 - s.x * 6 * dt;
      s.vy += -s.y * 6 * dt + 30 * dt; // + slight gravity
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.98; s.vy *= 0.98;
      const dl = Math.hypot(s.x, s.y);
      const dx2 = cx + s.x, dy2 = cy + s.y;
      // black droplet + chrome rim
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(dx2, dy2, s.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(${rr},${rg},${rb},0.8)`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      if (dl < base + s.r * 0.5 && s.age > 0.15) s._merge = true; // reabsorbed
    }
    this.sats = this.sats.filter((s) => !s._merge && s.age < 6);

    // the body: pure-black polar polygon
    this.blobPath(ctx, cx, cy, base, spikeScale, sharp, treble, maxR);
    ctx.fillStyle = "#000";
    ctx.fill();

    // chrome rim (additive) traces the whole silhouette; then a brighter
    // specular pass over just the upper-left arc so it reads as wet metal
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    this.blobPath(ctx, cx, cy, base, spikeScale, sharp, treble, maxR);
    ctx.strokeStyle = `rgba(${rr},${rg},${rb},${0.5 + loud * 0.35 + this.rupture * 0.1})`;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    // specular highlight: re-trace only the top-left slice of the silhouette,
    // bright — a light source glinting off the liquid's shoulder
    ctx.beginPath();
    for (let i = 0; i <= M; i++) {
      const th = (i / M) * TAU;
      if (th < Math.PI * 0.95 || th > Math.PI * 1.5) continue;
      const r = this.radiusAt(th, base, spikeScale, sharp, treble, maxR);
      const x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r;
      if (ctx._started) ctx.lineTo(x, y);
      else { ctx.moveTo(x, y); ctx._started = true; }
    }
    ctx._started = false;
    ctx.strokeStyle = `rgba(${pal.spec[0]},${pal.spec[1]},${pal.spec[2]},${0.4 + loud * 0.35})`;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
  }
}
