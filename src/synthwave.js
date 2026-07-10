// Synthwave — a retro neon sunset that IS the visualizer. The mountain
// silhouette on the horizon is the live spectrum (bass at the edges, treble
// by the sun), the grid floor rides the loudness, the striped sun pulses on
// bass and beats. Direct, obvious audio response first; scenery second.
//
// Palette: near-black purple sky, neon magenta grid and ridges, orange-pink
// sun, sparse cyan accents.

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Synthwave deliberately IGNORES the global sensitivity dial — the scene is
// tuned around one fixed gain (the dial let the wave/grid spike far too hard).
// This is the single knob for its audio response; change it here. The wave now
// masks out a flat keep-out gap over the sun and caps its own height, so the sun
// can never be obscured — which lets this run livelier than the old 0.35.
const FIXED_SENSITIVITY = 0.7;

class Smoother {
  constructor(attack = 0.6, decay = 0.14) {
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

class BeatDetector {
  constructor(floor = 0.12) {
    this.hist = [];
    this.cooldown = 0;
    this.floor = floor;
  }
  update(v, dt) {
    this.hist.push(v);
    if (this.hist.length > 43) this.hist.shift();
    this.cooldown -= dt;
    const avg = this.hist.reduce((a, b) => a + b, 0) / this.hist.length;
    if (this.cooldown <= 0 && v > this.floor && v > avg * 1.22) {
      this.cooldown = 0.15;
      return true;
    }
    return false;
  }
}

export class Synthwave {
  constructor(cfg = {}) {
    this.cfg = { quality: "auto", ...cfg }; // note: no `sensitivity` — see FIXED_SENSITIVITY
    // adaptive quality (same pattern as blackhole/galaxy): when frames run
    // long — e.g. on the Raspberry Pi — autoQuality slides toward 0.3 and the
    // renderer sheds its costliest overdraw. 1 = full glow, high detail.
    this.frameAvg = 16.7;
    this.autoQuality = 1;
    this.q = 1;
    this._reflFrame = 0;
    this.freq = new Uint8Array(1024);
    this.time = new Uint8Array(2048);
    this.bass = new Smoother(0.65, 0.12);
    this.mid = new Smoother(0.55, 0.12);
    this.treble = new Smoother(0.6, 0.16);
    this.loud = new Smoother(0.5, 0.08);
    this.peak = 0.3;
    this.beat = new BeatDetector();
    this.flash = 0;
    this.surge = 0;
    this.gridPhase = 0;
    // tempo tracking: median inter-beat interval -> grid pace
    this.clock = 0;
    this.lastBeatT = -1;
    this.intervals = [];
    this.bps = 0; // beats per second, smoothed
    this.tempoConf = 0; // 1 = locked to the beat, 0 = free-running
    this.lastNow = 0;
    this.t = 0;
    this.ridgePts = null; // grouped, smoothed terrain sections
    this.w = 0;
    this.stars = [];
  }

  quality() {
    return this.cfg.quality === "auto" ? this.autoQuality : this.cfg.quality;
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
    // adaptive gain, same pattern as the other reactive modes
    const rawLoud = band(1, 372);
    this.peak = Math.max(this.peak * (1 - dt * 0.04), rawLoud, 0.06);
    this.gain = Math.min(4, 0.55 / this.peak) * FIXED_SENSITIVITY;
    const rawBass = Math.min(1, band(1, 11) * this.gain);
    this.bass.update(rawBass);
    this.mid.update(Math.min(1, band(11, 92) * this.gain));
    this.treble.update(Math.min(1, band(92, 372) * 1.6 * this.gain));
    this.loud.update(Math.min(1, rawLoud * this.gain));

    this.clock += dt;
    // beat onsets from RAW waveform energy — the analyser's FFT smoothing
    // flattens kick dips, so band-based detection misses steady four-on-
    // the-floor beats entirely; time-domain RMS stays crisp
    let sq = 0;
    for (let i = 0; i < this.time.length; i += 4) {
      const d = (this.time[i] - 128) / 128;
      sq += d * d;
    }
    const rms = Math.sqrt(sq / (this.time.length / 4));
    if (analyser && this.beat.update(Math.min(1.5, rms * 2.6), dt)) {
      this.flash = 1;
      this.surge = Math.min(2, this.surge + 0.9); // grid push
      // tempo estimate: keep plausible inter-beat intervals (30-240 BPM)
      if (this.lastBeatT >= 0) {
        const iv = this.clock - this.lastBeatT;
        if (iv > 0.24 && iv < 2) {
          this.intervals.push(iv);
          if (this.intervals.length > 8) this.intervals.shift();
          const sorted = [...this.intervals].sort((a, b) => a - b);
          let b = 1 / sorted[sorted.length >> 1];
          // octave folding: onsets can fire on kick AND snare, doubling the
          // raw estimate — fold into a plausible song-tempo band
          while (b > 3.2) b /= 2;
          while (b < 0.9) b *= 2;
          this.bps += (b - this.bps) * 0.3;
          this.tempoConf = 1;
        }
      }
      this.lastBeatT = this.clock;
    }
    // lose the lock gradually if the beat goes away
    if (this.lastBeatT >= 0 && this.clock - this.lastBeatT > 2.5) this.tempoConf *= Math.exp(-dt * 1.2);
    this.flash *= Math.exp(-dt * 6);
    this.surge *= Math.exp(-dt * 2.2);
  }

  rebuild(w, h) {
    this.w = w;
    this.h = h;
    this.stars = [];
    const n = Math.round(130 * Math.max(1, w / h / 2));
    // stars fly outward from a vanishing point behind the sun — a subtle
    // starfield warping toward the viewer, not a static twinkling backdrop
    this.starMaxR = Math.hypot(w / 2, h * 0.55);
    for (let i = 0; i < n; i++) {
      this.stars.push({
        angle: -Math.random() * Math.PI, // upper half-circle only: left, up, right
        radius: Math.random() * this.starMaxR, // pre-spread so the field looks continuous from frame 1
        speedMul: 0.6 + Math.random() * 0.9,
        ph: Math.random() * TAU,
        sp: 1 + Math.random() * 4,
      });
    }
  }

  render(ctx, analyser, w, h, now) {
    if (w !== this.w || h !== this.h) this.rebuild(w, h);
    const rawMs = this.lastNow ? now - this.lastNow : 16.7;
    const dt = Math.min(Math.max(rawMs, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t = now / 1000;
    // adaptive quality: shed cost when frames run long (ignore huge gaps from
    // tab-switches / first frame). Settles in the 19–26ms dead band.
    if (rawMs > 0 && rawMs < 500 && this.cfg.quality === "auto") {
      this.frameAvg += (rawMs - this.frameAvg) * 0.04;
      if (this.frameAvg > 26 && this.autoQuality > 0.3) this.autoQuality -= 0.02;
      else if (this.frameAvg < 19 && this.autoQuality < 1) this.autoQuality = Math.min(1, this.autoQuality + 0.004);
    }
    this.q = this.quality();
    this.analyze(analyser, dt);

    // strict, unmoving baseline: the absolute zero-point for the waveform,
    // sky/sun above it, grid below it
    const horizon = h * 0.5;
    const cx = w / 2;

    this.drawSky(ctx, w, h, horizon);
    this.drawStars(ctx, w, horizon, cx, dt);
    this.drawSun(ctx, w, h, cx, horizon);
    this.drawHorizonWave(ctx, w, h, cx, horizon, dt);
    this.drawGridFloor(ctx, w, h, cx, horizon, dt);
  }

  // ------------------------------------------------------------ layers

  drawSky(ctx, w, h, horizon) {
    // deep purple at the top, glowing into hot pink right at the horizon
    const g = ctx.createLinearGradient(0, 0, 0, horizon * 1.05);
    g.addColorStop(0, "#0d0620");
    g.addColorStop(0.55, "#1d0e3a");
    g.addColorStop(0.85, `rgba(110, 30, 90, ${0.9 + this.loud.value * 0.1})`);
    g.addColorStop(1, `rgba(230, 35, 140, ${0.85 + this.flash * 0.15})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, horizon + 2);
    // floor base
    ctx.fillStyle = "#0d0714";
    ctx.fillRect(0, horizon, w, h - horizon);
  }

  drawStars(ctx, w, horizon, cx, dt) {
    const tr = this.treble.value;
    const maxR = this.starMaxR || Math.hypot(w / 2, horizon);
    // update every star (cheap) for a continuous field, but draw only a
    // quality-scaled subset — thins the fill work when the Pi is struggling
    const drawCount = Math.floor(this.stars.length * (0.55 + 0.45 * this.q));
    const bloom = this.q > 0.45;
    for (let si = 0; si < this.stars.length; si++) {
      const s = this.stars[si];
      // radial motion: slow near the vanishing point (behind the sun),
      // accelerating outward — a subtle starfield warping toward the
      // viewer rather than a static twinkling backdrop
      const depth = clamp01(s.radius / maxR);
      s.radius += (16 + depth * 130) * s.speedMul * dt;
      if (s.radius > maxR) {
        s.radius = 0;
        s.angle = -Math.random() * Math.PI;
        s.speedMul = 0.7 + Math.random() * 1.1;
        continue; // reappears next frame; skip drawing this reset instant
      }
      if (si >= drawCount) continue;

      const x = cx + Math.cos(s.angle) * s.radius;
      const y = horizon + Math.sin(s.angle) * s.radius;
      if (y > horizon || x < -4 || x > w + 4) continue; // stays within the sky

      const tw = 0.5 + 0.5 * Math.sin(s.ph + this.t * s.sp);
      // brighter overall, and a warm ember tint rather than pale pink —
      // a more noticeable starfield
      const a = clamp01((0.3 + tw * 0.32 + depth * 0.6) * (0.8 + tr * 1.1));
      if (a < 0.04) continue;
      const size = 1.6 + depth * 2.6;
      // the closer/brighter stars get a soft bloom — a larger faint rect
      // under the core, far cheaper than a per-star shadowBlur pass
      if (bloom && depth > 0.4) {
        const hs = size * 2.6;
        ctx.fillStyle = `rgba(255, 150, 100, ${clamp01(a * 0.5)})`;
        ctx.fillRect(x - (hs - size) / 2, y - (hs - size) / 2, hs, hs);
      }
      ctx.fillStyle = `rgba(255, 180, 130, ${a})`;
      ctx.fillRect(x, y, size, size);
    }
  }

  drawSun(ctx, w, h, cx, horizon) {
    // the sun itself is rock-solid: no pulsing, no audio in its size or glow
    const r = Math.min(w, h) * 0.19;
    this.sunR = r; // the horizon wave reads this to carve its keep-out gap
    const sy = horizon - r * 0.32; // sitting on the horizon

    // the sun proper lives above the horizon...
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, horizon + 2);
    ctx.clip();
    this.paintSun(ctx, cx, sy, r, horizon + 2);
    ctx.restore();

    // ...and below the horizon the SAME circle continues into the water.
    // Its lower portion renders once into an offscreen tile, gets a pink
    // wash, then blits in horizontal slices whose offsets ripple — this is
    // where the music lives: bass and loudness drive the wave size, beats
    // send a surge across the surface.
    const rw = Math.ceil(r * 5.2);
    const rh = Math.ceil(r * 2.1);
    if (!this.reflCanvas) this.reflCanvas = document.createElement("canvas");
    const sizeChanged = this.reflCanvas.width !== rw || this.reflCanvas.height !== rh;
    if (sizeChanged) {
      this.reflCanvas.width = rw;
      this.reflCanvas.height = rh;
    }
    // the tile is near-static (only the sun stripes drift slowly), so repaint
    // it a few times a second rather than every frame — the ripple is applied
    // cheaply at blit time below. Full rate only when quality is high.
    const repaintEvery = this.q > 0.8 ? 1 : this.q > 0.5 ? 3 : 6;
    if (sizeChanged || this._reflFrame % repaintEvery === 0) {
      const rc = this.reflCanvas.getContext("2d");
      rc.clearRect(0, 0, rw, rh);
      rc.save();
      rc.translate(rw / 2 - cx, -(horizon + 2)); // tile y0 = the horizon line
      this.paintSun(rc, cx, sy, r, horizon + 2);
      rc.restore();
      // submerged light reads hot pink
      rc.save();
      rc.globalCompositeOperation = "source-atop";
      rc.fillStyle = "rgba(255, 35, 110, 0.35)";
      rc.fillRect(0, 0, rw, rh);
      rc.restore();
    }
    this._reflFrame++;

    const waterTop = horizon + 2;
    const amp = 1 + this.loud.value * 2.5 + this.bass.value * 3 + this.flash * 3;
    ctx.save();
    ctx.globalAlpha = 0.55 + this.loud.value * 0.15 + this.flash * 0.12;
    let y = 0;
    let k = 0;
    // fewer, taller slices when quality is low — halves the per-slice blits
    const bandBase = this.q > 0.6 ? 2 : 3.5;
    const bandDepth = this.q > 0.6 ? 7 : 9;
    while (y < rh) {
      const depth = y / rh; // 0 at horizon -> 1 near viewer
      const bandH = bandBase + depth * bandDepth; // perspective: wider slices up close
      const off =
        Math.sin(k * 0.9 + this.t * (2 + this.loud.value * 3)) * amp * (0.3 + depth * 1.4) +
        Math.sin(k * 2.3 - this.t * 1.3) * amp * 0.3;
      ctx.drawImage(this.reflCanvas, 0, y, rw, bandH, cx - rw / 2 + off, waterTop + y, rw, bandH);
      y += bandH;
      k++;
    }
    ctx.restore();
    // the reflection sinks away toward the viewer
    const fade = ctx.createLinearGradient(0, horizon, 0, horizon + r * 2);
    fade.addColorStop(0, "rgba(9, 5, 12, 0.05)");
    fade.addColorStop(1, "rgba(9, 5, 12, 0.92)");
    ctx.fillStyle = fade;
    ctx.fillRect(cx - r * 2.8, horizon, r * 5.6, r * 2);
  }

  paintSun(ctx, cx, sy, r, stripeFromY = -Infinity) {
    // steady bloom — the sun never pulses
    const glowA = 0.3;
    const glow = ctx.createRadialGradient(cx, sy, r * 0.4, cx, sy, r * 2.4);
    glow.addColorStop(0, `rgba(255, 110, 60, ${glowA})`);
    glow.addColorStop(0.55, `rgba(255, 50, 100, ${glowA * 0.35})`);
    glow.addColorStop(1, "rgba(255, 50, 100, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - r * 2.5, sy - r * 2.5, r * 5, r * 5);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, sy, r, 0, TAU);
    ctx.clip();
    const disc = ctx.createLinearGradient(0, sy - r, 0, sy + r);
    disc.addColorStop(0, "#ffb347");
    disc.addColorStop(0.45, "#ff6a35");
    disc.addColorStop(1, "#ff1f6e");
    ctx.fillStyle = disc;
    ctx.fillRect(cx - r, sy - r, r * 2, r * 2);
    // retro stripes drift slowly at a constant scenic pace — but only below
    // the waterline (stripeFromY): the disc above the horizon stays solid
    ctx.fillStyle = "rgba(18, 6, 12, 0.92)";
    const drift = this.t * r * 0.05;
    for (let k = 0; k < 8; k++) {
      const fy = k / 8;
      const yy = sy + ((fy * fy * r * 1.02 + drift) % (r * 1.02));
      const th = 1.5 + fy * r * 0.09;
      const y0 = Math.max(yy, stripeFromY);
      if (th - (y0 - yy) > 0) ctx.fillRect(cx - r, y0, r * 2, th - (y0 - yy));
    }
    ctx.restore();
  }

  // Two waveforms that FRAME the sun instead of covering it. Each stays flat on
  // the horizon across the sun's width (a keep-out gap) and only rises into
  // reactive peaks on the flanks — so the sun is never obscured, at any volume.
  // Bass reads on the inner peaks just BESIDE the sun, sweeping into mid/treble
  // toward the screen edges. A taller, hazier purple-grey range sits behind a
  // shorter, vivid sun-matched range. Both return flat in silence.
  drawHorizonWave(ctx, w, h, cx, horizon, dt) {
    const N = 64; // vertices across the width (enough to resolve the gap smoothly)
    if (!this.wavePts || this.wavePts.length !== N) {
      this.wavePts = new Float32Array(N); // front layer
      this.wavePts2 = new Float32Array(N); // back layer
    }

    const half = w / 2;
    const bassMax = Math.floor(this.freq.length * 0.15); // "0 to ~15%" bass region
    const usableMax = Math.floor(this.freq.length * 0.55); // outer ceiling before the empty top end

    // sun keep-out: flat gap across the sun's width, wings ramping up outside it
    const r = this.sunR || Math.min(w, h) * 0.19;
    const gapHalf = r * 1.12; // half-width of the flat zone (sun radius + margin)
    const rampW = r * 1.3; // how far the wings take to rise from the gap edge
    const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

    const sampleLayer = (pts, ampFalloff, smoothing) => {
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const d = Math.abs(x - cx);
        const mask = smoothstep(gapHalf, gapHalf + rampW, d); // 0 over the sun -> 1 outside
        const wing = clamp01((d - gapHalf) / (half - gapHalf)); // 0 by the sun -> 1 at the edge
        // inner wing reads bass, sweeping up into mid/treble toward the edge
        const bin = 1 + Math.floor(wing * wing * (usableMax - bassMax) + wing * bassMax);
        const byteVal = this.freq[Math.min(this.freq.length - 1, bin)] / 255; // 0..255 -> 0..1
        const ampScale = 1 - wing * ampFalloff; // tallest right beside the sun, tapering outward
        const target = clamp01(byteVal * this.gain) * ampScale * mask;
        pts[i] += (target - pts[i]) * (1 - smoothing);
      }
    };
    // back layer: taper less (stays taller toward the edges), reacts slower
    sampleLayer(this.wavePts2, 0.4, 0.9);
    // front layer: vivid, tapers more
    sampleLayer(this.wavePts, 0.6, 0.8);

    const buildPts = (data, maxHeight) => {
      const pts = [];
      for (let i = 0; i < N; i++) pts.push([(i / (N - 1)) * w, horizon - data[i] * maxHeight]);
      return pts;
    };
    const traceFill = (pts) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < N - 1; i++) {
        const xc = (pts[i][0] + pts[i + 1][0]) / 2;
        const yc = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
      }
      ctx.quadraticCurveTo(pts[N - 1][0], pts[N - 1][1], pts[N - 1][0], pts[N - 1][1]);
      ctx.lineTo(w, horizon);
      ctx.lineTo(0, horizon);
      ctx.closePath();
    };

    // the sharp dividing line itself, drawn first so both waveforms sit
    // directly on top of it
    ctx.strokeStyle = "rgba(255, 210, 200, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    ctx.lineTo(w, horizon);
    ctx.stroke();

    // back layer: a gray shadow (contrasting with the front layer's
    // sun-matched color) — a thin, faint rim keeps it readable against the
    // near-black sky without turning it into a second colored wave
    // heights scale with the sun so a full-amplitude wing rises to roughly the
    // sun's top and frames it, rather than a fixed fraction of the screen
    const backHeight = Math.min(h * 0.5, r * 2.0);
    const backPts = buildPts(this.wavePts2, backHeight);
    traceFill(backPts);
    ctx.fillStyle = "rgba(72, 70, 78, 0.75)";
    ctx.fill();
    ctx.strokeStyle = "rgba(200, 90, 170, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(backPts[0][0], backPts[0][1]);
    for (let i = 1; i < N - 1; i++) {
      const xc = (backPts[i][0] + backPts[i + 1][0]) / 2;
      const yc = (backPts[i][1] + backPts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(backPts[i][0], backPts[i][1], xc, yc);
    }
    ctx.stroke();

    // front layer: vivid, matching the sun's own gradient, with a soft bloom
    const maxHeight = Math.min(h * 0.42, r * 1.55);
    const frontPts = buildPts(this.wavePts, maxHeight);
    traceFill(frontPts);
    const waveGrad = ctx.createLinearGradient(0, horizon - maxHeight, 0, horizon);
    waveGrad.addColorStop(0, "#ffb347");
    waveGrad.addColorStop(0.5, "#ff6a35");
    waveGrad.addColorStop(1, "#e6432a");

    ctx.fillStyle = waveGrad;
    ctx.fill();
    // neon crest bloom via cheap overdraw (replaces a full-silhouette
    // shadowBlur that was murder on the Pi): a wide soft stroke over just the
    // top contour, then a bright thin core line.
    if (this.q > 0.4) {
      const traceCrest = () => {
        ctx.beginPath();
        ctx.moveTo(frontPts[0][0], frontPts[0][1]);
        for (let i = 1; i < N - 1; i++) {
          const xc = (frontPts[i][0] + frontPts[i + 1][0]) / 2;
          const yc = (frontPts[i][1] + frontPts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(frontPts[i][0], frontPts[i][1], xc, yc);
        }
      };
      traceCrest();
      ctx.strokeStyle = "rgba(255, 140, 70, 0.28)";
      ctx.lineWidth = 6;
      ctx.stroke();
      traceCrest();
      ctx.strokeStyle = "rgba(255, 205, 140, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  drawGridFloor(ctx, w, h, cx, horizon, dt) {
    const floorH = h - horizon;
    const rows = 15;
    // forward motion: when a tempo is locked, two grid lines pass per beat —
    // the floor rides the music's actual pace. Without a steady beat it
    // free-runs on loudness. Bass surges and beat pushes ride on top.
    const tempoRate = this.bps > 0 ? ((this.bps * 2) / rows) * (0.75 + this.loud.value * 0.45) : 0;
    const freeRate = 0.22 + this.loud.value * 0.9;
    const rate = freeRate * (1 - this.tempoConf) + tempoRate * this.tempoConf;
    this.gridPhase = (this.gridPhase + dt * (rate + this.surge * 0.5)) % 1;
    const shimmer = 0.55 + this.treble.value * 0.25 + this.flash * 0.2;
    // Neon glow on the grid via cheap overdraw — a wide faint halo pass under a
    // bright thin core — instead of shadowBlur, which blurred every full-width
    // row/spoke each frame and was the single worst cost on the Pi. The halo
    // pass is dropped when quality is low; the core alone still reads as a grid.
    const glow = this.q > 0.45;
    const line = (x0, y0, x1, y1, a, lw) => {
      if (glow) {
        ctx.strokeStyle = `rgba(255, 70, 215, ${clamp01(a * 0.3)})`;
        ctx.lineWidth = lw + 4;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.strokeStyle = `rgba(255, 25, 200, ${clamp01(a * (glow ? 1 : 1.2))})`;
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    };
    for (let k = 0; k < rows; k++) {
      const zf = (k / rows + this.gridPhase) % 1;
      const y = horizon + Math.pow(zf, 2.7) * floorH;
      line(0, y, w, y, (0.1 + zf * 0.65) * shimmer, 1 + zf * 2.2);
    }
    // converging verticals
    const spokes = 10;
    for (let i = -spokes; i <= spokes; i++) {
      const f = i / spokes;
      line(cx + f * w * 0.045, horizon + 3, cx + f * w * 1.05, h + 2, (0.16 + Math.abs(f) * 0.3) * shimmer, 1.2);
    }

    // soft hot-pink haze where floor meets horizon, breathing with the music
    const haze = ctx.createLinearGradient(0, horizon, 0, horizon + floorH * 0.35);
    haze.addColorStop(0, `rgba(230, 30, 170, ${0.18 + this.loud.value * 0.2 + this.flash * 0.15})`);
    haze.addColorStop(1, "rgba(230, 30, 170, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon, w, floorH * 0.35);
  }
}
