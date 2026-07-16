// Flame Spectrum — the beloved classic "fire equalizer", done with real fire
// dynamics instead of scaled flame sprites.
//
// The engine is the demoscene fire routine (a heat-field cellular automaton):
// heat is injected along a hearth line, each cell averages the row below it,
// loses a little energy (cooling), and drifts sideways (wind). Palette-map the
// heat and you get fire that CONVECTS — it rolls, licks, and detaches into
// embers on its own. Scaled sprites can't do any of that.
//
// The audio mapping is what makes it a meter rather than a fireplace: 40
// log-spaced bands each own a column of the hearth, bass on the left like a
// real EQ. Per-band character falls out of the physics — bass columns get low
// cooling and wide injection (broad rolling flames), treble columns get high
// cooling and jitter (thin flickering needles). No two bands look alike, and
// nothing is hand-animated.
//
// Pi-friendly: the automaton runs at quarter-res (480x120 = 57.6k cells) into
// one ImageData, blitted upscaled with smoothing. Demoscene fire is famously
// cheap. No shadowBlur; the glow IS the heat field.

// Heat palettes: 256 entries, index = heat. Built once at module load.
// Each is a set of gradient stops [heat 0..1, r, g, b, a].
const PALETTE_STOPS = {
  Inferno: [
    [0.0, 0, 0, 0, 0], [0.12, 46, 4, 2, 0.55], [0.3, 140, 22, 6, 1],
    [0.52, 224, 78, 10, 1], [0.72, 252, 164, 32, 1], [0.88, 255, 226, 138, 1], [1, 255, 255, 236, 1],
  ],
  "Blue Gas": [
    [0.0, 0, 0, 0, 0], [0.12, 4, 12, 46, 0.55], [0.3, 10, 44, 140, 1],
    [0.52, 22, 118, 226, 1], [0.72, 64, 196, 250, 1], [0.88, 168, 236, 255, 1], [1, 240, 253, 255, 1],
  ],
  "Witchfire Green": [
    [0.0, 0, 0, 0, 0], [0.12, 3, 34, 12, 0.55], [0.3, 8, 104, 34, 1],
    [0.52, 26, 190, 66, 1], [0.72, 120, 244, 110, 1], [0.88, 206, 255, 186, 1], [1, 244, 255, 240, 1],
  ],
  "White Heat": [
    [0.0, 0, 0, 0, 0], [0.12, 26, 26, 30, 0.55], [0.3, 84, 84, 92, 1],
    [0.52, 158, 158, 168, 1], [0.72, 216, 216, 224, 1], [0.88, 244, 244, 248, 1], [1, 255, 255, 255, 1],
  ],
};

function buildPalette(stops) {
  const p = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0], b = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) {
      if (t >= stops[k][0] && t <= stops[k + 1][0]) { a = stops[k]; b = stops[k + 1]; break; }
    }
    const span = b[0] - a[0] || 1;
    const f = Math.max(0, Math.min(1, (t - a[0]) / span));
    p[i * 4] = a[1] + (b[1] - a[1]) * f;
    p[i * 4 + 1] = a[2] + (b[2] - a[2]) * f;
    p[i * 4 + 2] = a[3] + (b[3] - a[3]) * f;
    p[i * 4 + 3] = (a[4] + (b[4] - a[4]) * f) * 255;
  }
  return p;
}
const PALETTES = {};
for (const k of Object.keys(PALETTE_STOPS)) PALETTES[k] = buildPalette(PALETTE_STOPS[k]);

const BANDS = 40; // log-spaced columns across the hearth
const GW = 480, GH = 120; // heat grid (quarter of 1920x480; 4:1 aspect preserved)
// Heat climbs RISE rows per frame. At 1 (the textbook fire routine) a flame
// takes a full 2 seconds to cross the panel, and every fluctuation in the
// music smears into a slow horizontal STRIPE scrolling upward — it read as a
// spectrogram, not a fire. At 2 the fire licks, and stripes disperse before
// the eye can lock onto them. It also costs nothing: reading two rows down is
// the same work as one.
const RISE = 2;
const DIE = 0.12; // heat below this is black — the flame's visible tip
const FULL_DRIVE = 1.11; // driveFor(i, 1, 0): a band at full level
const NOISE_CELL = 4; // hearth noise patch width, in cells

export class Flames {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Inferno", quality: "auto" };
    this.freq = new Uint8Array(1024);
    this.heat = new Float32Array(GW * GH); // the field: 0..1, row 0 = TOP
    this.level = new Float32Array(BANDS); // smoothed band levels
    this.peak = new Float32Array(BANDS); // peak-hold (the floating ember)
    this.peakVel = new Float32Array(BANDS);
    this.bandLo = new Int16Array(BANDS);
    this.bandHi = new Int16Array(BANDS);
    this.cool = new Float32Array(BANDS); // derived from reach in calibrate()
    this.reach = new Float32Array(BANDS); // full-level flame height, 0..1
    this.coolKey = "";
    this.wind = new Float32Array(BANDS); // meander amplitude (cells)
    this.sway = new Float32Array(BANDS); // meander speed
    this.jit = new Float32Array(BANDS); // incoherent flicker
    this.phase = new Float32Array(BANDS); // so neighbours don't sway in sync
    // log-spaced bands, bass LEFT — this one is an EQ and should read like one
    for (let i = 0; i < BANDS; i++) {
      this.bandLo[i] = Math.round(1 + Math.pow(i / BANDS, 1.75) * 400);
      this.bandHi[i] = Math.max(this.bandLo[i] + 1, Math.round(1 + Math.pow((i + 1) / BANDS, 1.75) * 400));
      const hi = i / (BANDS - 1); // 0 = bass, 1 = treble
      // How far a FULL-level flame reaches, as a fraction of the panel. This
      // is the taste dial; cooling is derived from it in calibrate() rather
      // than guessed. (Two earlier passes hand-picked a cooling constant and
      // both were badly wrong — heat loss is dominated by DIFFUSION into cold
      // neighbouring columns, not by cooling, so the height that falls out of
      // `drive/cool` arithmetic is off by ~4x. Stating the height you want and
      // solving backwards is the only honest way to tune this.)
      // bass: tall broad rolling flames. treble: thin flickering needles.
      this.reach[i] = 0.96 - hi * 0.4;
      // Turbulence is not decoration — it's what makes fire read as fire.
      // Without it heat marches straight up and every fluctuation in the music
      // paints a horizontal STRIPE across the band as it rises (the first
      // version's kick envelope looked like venetian blinds).
      //
      // But `wind` is a LEAN — cells per row — not a position. Sideways offset
      // ACCUMULATES as heat is copied upward row by row, so a ±1.9-cell
      // meander is a ±1.9-cells-per-row velocity: the flame leant over ~60deg
      // and marched clean out of its own column into cold neighbours within 9
      // rows (measured). Keep it under ~1 cell/row and the column curls
      // instead of blowing sideways.
      this.wind[i] = 0.3 + hi * 0.45; // coherent lean, cells per row
      this.sway[i] = 1.0 + hi * 2.6; // lean speed: treble flickers faster
      this.jit[i] = 0.7 + hi * 0.8; // per-cell random walk = ragged edges
      this.phase[i] = i * 2.399; // golden-angle offsets: no two bands in step
    }
    this.embers = [];
    this.beat = 0;
    this._prevBass = 0;
    this._fluxAvg = 0.03;
    this.img = null;
    this.imgKey = "";
    this.t = 0;
    this.lastNow = 0;
    this.frameAvg = 16;
    this.autoQuality = 1;
  }

  analyze(dt) {
    const f = this.freq;
    for (let i = 0; i < BANDS; i++) {
      let sum = 0;
      for (let k = this.bandLo[i]; k < this.bandHi[i]; k++) sum += f[k];
      const v = Math.min(1, (sum / ((this.bandHi[i] - this.bandLo[i]) * 255)) * this.cfg.sensitivity);
      // fast attack, slow decay: flames leap on a hit and subside naturally
      this.level[i] = v > this.level[i] ? v : Math.max(0, this.level[i] - dt * 1.5);
      // peak-hold as physics: an ember hovering at the recent max, sinking
      if (this.level[i] >= this.peak[i]) { this.peak[i] = this.level[i]; this.peakVel[i] = 0; }
      else { this.peakVel[i] += dt * 0.55; this.peak[i] = Math.max(this.level[i], this.peak[i] - this.peakVel[i] * dt); }
    }
    // kick: raw bass flux vs its own recent average (volume-independent).
    // AutoGain already governs the level, so no silence gate is needed here —
    // in a quiet room the bands die and only the pilot flames remain.
    let bs = 0;
    for (let i = 1; i < 6; i++) bs += f[i];
    const bass = bs / (5 * 255);
    const flux = Math.max(0, bass - this._prevBass);
    this._prevBass = bass;
    this._fluxAvg += (flux - this._fluxAvg) * Math.min(1, dt * 1.5);
    if (bass > 0.04 && flux > Math.max(0.02, this._fluxAvg * 2.2)) this.beat = 1;
    this.beat = Math.max(0, this.beat - dt * 4);
  }

  // Solve cooling from the reach we want: a flame climbs RISE rows per step
  // and loses `cool` per step, so it dies after RISE*(drive-DIE)/cool rows.
  //
  // `reach` is defined for a band whose NEIGHBOURS are also hot, because heat
  // loss here is dominated by sideways diffusion into cold columns and there
  // is no constant that fixes both cases: measured, a wall of full-level bands
  // loses nothing (no gradient, every band hits 1.00) while an isolated tone
  // loses ~75% of its climb to its cold neighbours. That spread is real fire —
  // a lone jet IS shorter than a wall of flame — and real music sits near the
  // correlated end, since adjacent log bands rarely differ wildly. So this
  // calibrates the correlated case and lets a lone tone read shorter.
  calibrate(gh) {
    const key = `${gh}`;
    if (this.coolKey === key) return;
    this.coolKey = key;
    // Measured correction, not derived: with a noisy hearth the visible tip is
    // set by the luckiest hot cells rather than the mean, so flames overshoot
    // the arithmetic — and they overshoot MORE at the treble end, where the
    // tip taper washes the cooling difference out. Calibrated against a
    // full-level wall, which by definition should reach exactly `reach`.
    // Re-measure (see test/flames-suite.browser.js) if the kernel, the hearth
    // noise, RISE, or the tip taper change.
    for (let i = 0; i < BANDS; i++) {
      const survives = 0.62 + (i / (BANDS - 1)) * 0.17;
      this.cool[i] = (RISE * (FULL_DRIVE - DIE) * survives) / (this.reach[i] * gh);
    }
    // Per-CELL band character, interpolated between band centres. Indexing
    // cooling/jitter/lean by `(x/gw*BANDS)|0` makes them step functions, and
    // the steps are visible: neighbouring bands lean in unrelated directions
    // (their phases are golden-angle apart), which seams the fire into hard
    // rectangular blocks every 12 cells. Fire has no band boundaries.
    const gw = GW;
    this._b0x = new Int16Array(gw);
    this._fx = new Float32Array(gw);
    this._coolX = new Float32Array(gw);
    this._jitX = new Float32Array(gw);
    const colW = gw / BANDS;
    for (let x = 0; x < gw; x++) {
      const p = x / colW - 0.5;
      const b0 = Math.max(0, Math.min(BANDS - 1, Math.floor(p)));
      const b1 = Math.min(BANDS - 1, b0 + 1);
      const f = Math.max(0, Math.min(1, p - b0));
      this._b0x[x] = b0;
      this._fx[x] = f;
      this._coolX[x] = this.cool[b0] + (this.cool[b1] - this.cool[b0]) * f;
      this._jitX[x] = this.jit[b0] + (this.jit[b1] - this.jit[b0]) * f;
    }
  }

  // heat injected at the hearth for a band at some level. The pilot flame
  // (0.16) never goes out: in silence the hearth still gutters, which is what
  // makes an idle fire read as alive rather than broken.
  // Capped: the hearth is clamped to heat 1 (white-hot) and a kick on an
  // already-loud bass band used to drive it to 1.6, blowing the whole bass
  // end out into a flat white slab for a third of every beat.
  driveFor(i, level, beat) {
    return Math.min(1.12, 0.16 + level * 0.95 + beat * (i < 8 ? 0.32 : 0.05));
  }

  // Where that flame's tip lands, as a fraction of panel height — the same
  // relationship calibrate() solved, so the peak-hold ember floats exactly at
  // the flame's real reach instead of at a level-derived height that drifts
  // off the (shorter) treble flames.
  heightFor(i, level) {
    const f = (this.driveFor(i, level, 0) - DIE) / (FULL_DRIVE - DIE);
    return Math.max(0, Math.min(1, f * this.reach[i]));
  }

  // inject heat along the hearth (bottom rows) and step the automaton
  step(dt, gw, gh) {
    this.calibrate(gh);
    const heat = this.heat;
    const colW = gw / BANDS;
    // --- injection: each band heats its own stretch of the hearth
    const bottom = (gh - 1) * gw;
    // ONE continuous hearth whose height traces the spectrum envelope: the
    // bands are control points, not walls. Giving each band its own box of
    // heat (with a bell across it) produced exactly what it sounds like — a
    // bar chart on fire, hard-edged bright chunks sitting in a row — because
    // a fire has no idea where a band boundary is. Interpolating between band
    // centres lets neighbouring flames merge and lick into each other the way
    // real ones do, and the meter still reads: the envelope IS the spectrum.
    // Coarse hearth noise: patches ~6 cells wide, fresh every frame. Per-CELL
    // noise is at the Nyquist frequency and the blur halves it every row — it
    // was measured gone within ~10 rows, leaving a smooth striped slab above a
    // pretty hearth. Patches are low-frequency enough to survive the whole
    // climb, and they're what BECOME the tongues.
    // ...and it EVOLVES rather than being re-rolled. Consecutive frames seed
    // consecutive rows, so an uncorrelated hearth writes vertical noise: fire
    // that boils in place. Drifting the lattice (~8 frames of correlation)
    // means neighbouring rows are seeded with similar patterns, and those
    // vertically-coherent patches are exactly what a rising tongue is.
    if (!this._noise) {
      this._noise = new Float32Array(Math.ceil(GW / NOISE_CELL) + 2).fill(1);
    }
    const nl = this._noise;
    const k = Math.min(1, dt * 7);
    for (let i = 0; i < nl.length; i++) nl[i] += (0.3 + Math.random() * 1.4 - nl[i]) * k;
    for (let x = 0; x < gw; x++) {
      const p = x / colW - 0.5; // position in band-centre space
      const b0 = Math.max(0, Math.min(BANDS - 1, Math.floor(p)));
      const b1 = Math.min(BANDS - 1, b0 + 1);
      const f = Math.max(0, Math.min(1, p - b0));
      const d0 = this.driveFor(b0, this.level[b0], this.beat);
      const d1 = this.driveFor(b1, this.level[b1], this.beat);
      const drive = d0 + (d1 - d0) * f;
      // sample the coarse patch lattice (mean 1, +-70%), plus a little
      // per-cell grain for hearth sparkle
      const q = x / NOISE_CELL;
      const q0 = q | 0, qf = q - q0;
      const sm = qf * qf * (3 - 2 * qf); // smoothstep: linear lerp shows the
      // lattice as hard-edged blocks once it's upscaled 4x to the panel
      const s = (nl[q0] + (nl[q0 + 1] - nl[q0]) * sm) * (0.92 + Math.random() * 0.16);
      // seed the rows the propagate loop reads below itself — a thinner
      // hearth leaves a stale dead row under every flame
      // clamp above white (1.0), not at it: on a loud band drive*s would hit
      // the ceiling for over half the hearth cells, flattening the noise into
      // one uniform value — the bass end went back to being a solid slab.
      // Overshoot is invisible in colour (the palette tops out at white) but
      // it keeps the variation that ragged-edges the flame tops.
      for (let r = 0; r <= RISE; r++) {
        heat[bottom - r * gw + x] = Math.max(0, Math.min(1.5, drive * s * (1 - r * 0.04)));
      }
    }
    // --- propagate: every cell averages the three below it, cools, and drifts
    // along a coherent meander (see the turbulence note in the constructor)
    const step60 = dt * 60;
    // the lean depends only on (band, row) — computing it per CELL cost
    // 57.6k sin() a frame (1.75ms). Once per row-band: 4.8k.
    const wob = this._wob || (this._wob = new Float32Array(BANDS));
    for (let y = 0; y < gh - RISE - 1; y++) {
      // below2 is RISE+1 down, deliberately an ODD step from below: sampling
      // RISE and RISE*2 means even rows only ever read even rows, splitting
      // the grid into two decoupled interleaved lattices that render as
      // hairline scan lines across the whole fire.
      const row = y * gw, below = (y + RISE) * gw, below2 = (y + RISE + 1) * gw;
      // taper: heat leaks faster near the tip, so flames narrow as they climb
      const tip = 1 + (1 - y / gh) * 0.4;
      for (let b = 0; b < BANDS; b++) {
        const ph = this.phase[b], sw = this.t * this.sway[b];
        wob[b] = Math.sin(y * 0.05 + sw + ph) * this.wind[b];
      }
      const b0x = this._b0x, fx = this._fx, coolX = this._coolX, jitX = this._jitX;
      for (let x = 0; x < gw; x++) {
        const b = b0x[x], f = fx[x];
        const wb = wob[b] + (wob[Math.min(BANDS - 1, b + 1)] - wob[b]) * f;
        const wnd = Math.round(wb + (Math.random() - 0.5) * 2 * jitX[x]);
        const sx = Math.max(0, Math.min(gw - 1, x + wnd));
        const l = Math.max(0, sx - 1), r = Math.min(gw - 1, sx + 1);
        // Blur BOTH ways (the textbook fire kernel). A horizontal-only blur
        // has no way to smooth in time — each frame's hearth is carried up
        // untouched, so every fluctuation in the music freezes into a
        // permanent horizontal stripe. The `below2` term is what dissolves
        // them. Diffusion also organises the hearth's noise into tongues;
        // height is protected by calibrate(), not by starving the blur.
        const avg = (heat[below + l] + heat[below + sx] + heat[below + r] + heat[below2 + sx]) * 0.25;
        // cooling scales with dt so the fire's speed is frame-rate independent
        heat[row + x] = Math.max(0, avg - coolX[x] * (0.6 + Math.random() * 0.8) * tip * step60);
      }
    }
  }

  render(ctx, analyser, w, h, now) {
    const t0 = performance.now();
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t += dt;
    if (analyser) analyser.getByteFrequencyData(this.freq);
    else this.freq.fill(0);
    this.analyze(dt);

    // auto-quality: the one cheap knob is grid height (cell count)
    const gw = GW, gh = Math.max(64, Math.round(GH * this.autoQuality));
    const key = `${gw}x${gh}`;
    if (!this.img || this.imgKey !== key) {
      this.img = ctx.createImageData(gw, gh);
      this.imgKey = key;
      this.heat.fill(0);
    }
    this.step(dt, gw, gh);

    // --- palette-map the heat field into the ImageData
    const pal = PALETTES[this.cfg.preset] || PALETTES.Inferno;
    const px = this.img.data;
    const heat = this.heat;
    for (let i = 0, n = gw * gh; i < n; i++) {
      const v = heat[i];
      const idx = (v >= 1 ? 255 : (v * 255) | 0) * 4;
      const o = i * 4;
      px[o] = pal[idx]; px[o + 1] = pal[idx + 1]; px[o + 2] = pal[idx + 2]; px[o + 3] = pal[idx + 3];
    }

    // --- compose: dark hearth, fire (upscaled, smoothed = the soft look)
    ctx.fillStyle = "#04030a";
    ctx.fillRect(0, 0, w, h);
    if (!this._buf || this._bufKey !== key) {
      this._buf = document.createElement("canvas");
      this._buf.width = gw; this._buf.height = gh;
      this._bufCtx = this._buf.getContext("2d");
      this._bufKey = key;
    }
    this._bufCtx.putImageData(this.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.save();
    ctx.globalCompositeOperation = "lighter"; // fire is emissive
    ctx.drawImage(this._buf, 0, 0, w, h);
    ctx.restore();

    // --- peak-hold embers: one floating dot per band at its recent max,
    // placed by the same physics that governs the flame it caps
    const floorY = h * 0.97;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < BANDS; i++) {
      if (this.peak[i] < 0.06) continue;
      const x = ((i + 0.5) / BANDS) * w;
      const y = h - this.heightFor(i, this.peak[i]) * h;
      const a = Math.min(1, this.peak[i] * 1.4);
      const bob = Math.sin(this.t * 5 + i * 1.7) * 1.6;
      const c = pal[248 * 4], c2 = pal[248 * 4 + 1], c3 = pal[248 * 4 + 2];
      // wide faint halo under a bright core (never shadowBlur)
      ctx.fillStyle = `rgba(${c},${c2},${c3},${a * 0.16})`;
      ctx.beginPath(); ctx.arc(x, y + bob, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(${c},${c2},${c3},${a * 0.9})`;
      ctx.beginPath(); ctx.arc(x, y + bob, 1.7, 0, Math.PI * 2); ctx.fill();
    }

    // --- rising embers on kicks: detached sparks that drift and die
    if (this.beat > 0.75 && this.embers.length < 90) {
      const n = 3 + ((Math.random() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const b = (Math.random() * 12) | 0; // embers come off the bass end
        this.embers.push({
          x: ((b + Math.random()) / BANDS) * w, y: floorY - Math.random() * h * 0.2,
          vx: (Math.random() - 0.5) * 26, vy: -(40 + Math.random() * 90),
          age: 0, life: 1.4 + Math.random() * 1.6,
        });
      }
    }
    for (const e of this.embers) {
      e.age += dt;
      e.vy += 8 * dt; // buoyancy fading to gravity
      e.vx += (Math.random() - 0.5) * 30 * dt;
      e.x += e.vx * dt; e.y += e.vy * dt;
      const f = 1 - e.age / e.life;
      if (f <= 0) continue;
      const idx = ((160 + f * 90) | 0) * 4;
      ctx.fillStyle = `rgba(${pal[idx]},${pal[idx + 1]},${pal[idx + 2]},${f * 0.85})`;
      ctx.fillRect(e.x, e.y, 1.6, 1.6);
    }
    this.embers = this.embers.filter((e) => e.age < e.life && e.y > -10);
    ctx.restore();

    // --- the hearth: a dark bar grounding the fire + a faint band scale
    const hearth = ctx.createLinearGradient(0, floorY - 4, 0, h);
    hearth.addColorStop(0, "rgba(0,0,0,0)");
    hearth.addColorStop(0.5, "rgba(2,2,6,0.9)");
    hearth.addColorStop(1, "#000");
    ctx.fillStyle = hearth;
    ctx.fillRect(0, floorY - 4, w, h - floorY + 4);

    // auto-quality governor (cheap knob only: grid height)
    const ms = performance.now() - t0;
    this.frameAvg += (ms - this.frameAvg) * 0.04;
    if (this.cfg.quality === "auto") {
      if (this.frameAvg > 26) this.autoQuality = Math.max(0.55, this.autoQuality - 0.02);
      else if (this.frameAvg < 19) this.autoQuality = Math.min(1, this.autoQuality + 0.004);
    }
  }
}
