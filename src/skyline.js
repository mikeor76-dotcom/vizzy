// City Skyline Equalizer — a night city where the LIGHTS are the meter.
//
// The load-bearing design decision: ARCHITECTURE STANDS STILL, ONLY LIGHT
// MOVES. Bouncing buildings are kitsch; windows lighting floor-by-floor with
// the band level read as a living city that happens to be a spectrum
// analyzer. 56 buildings are 28 log bands mirrored like Ferrofluid — bass
// towers downtown at the centre (the skyline literally thumps downtown),
// treble low-rises out in the suburbs.
//
// Everything else is set dressing that the music drives: a penthouse
// peak-hold light that sinks floor by floor, a sky-glow pulse on every kick,
// lightning on genuine accents, highway traffic whose speed follows the
// detected tempo, and window reflections in the river. In silence the city
// SLEEPS — a handful of night owls stay up, traffic disappears.
//
// Pi-friendly: the whole static city (sky, stars, moon, silhouettes, unlit
// grids) is ONE cached offscreen; per frame it's a blit + batched fillRects
// for lit windows. No shadowBlur anywhere.

const B = 28; // bands; each owns a mirrored PAIR of buildings
const NB = B * 2;

// deterministic layout — the bench asserts band->building mapping
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTES = {
  "Midnight Amber": {
    skyTop: [5, 8, 24], skyBot: [26, 35, 64], win: [[255, 190, 110], [255, 214, 150]],
    owl: [200, 150, 90], moon: [235, 235, 220], glow: [90, 130, 220],
    river: [8, 12, 26], bolt: 0.45, silhouette: [10, 12, 22],
  },
  "Cyberpunk Neon": {
    skyTop: [10, 5, 24], skyBot: [38, 16, 64], win: [[90, 230, 255], [255, 80, 200]],
    owl: [120, 100, 200], moon: [220, 200, 255], glow: [255, 60, 180],
    river: [12, 6, 28], bolt: 0.4, silhouette: [14, 8, 26],
  },
  "Blackout Storm": {
    skyTop: [4, 6, 10], skyBot: [13, 18, 22], win: [[170, 195, 215], [210, 225, 235]],
    owl: [110, 125, 140], moon: [180, 190, 200], glow: [140, 170, 200],
    river: [5, 7, 10], bolt: 1.0, silhouette: [7, 9, 12],
  },
  Dawn: {
    skyTop: [42, 42, 85], skyBot: [255, 132, 84], win: [[205, 222, 255], [235, 240, 255]],
    owl: [170, 180, 220], moon: [255, 245, 235], glow: [255, 170, 110],
    river: [40, 30, 45], bolt: 0.3, silhouette: [22, 18, 32],
  },
};

export class Skyline {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Midnight Amber" }; // AutoGain: linear
    this.freq = new Uint8Array(1024);
    this.lvl = new Float32Array(B); // smoothed band levels
    this.litF = new Int16Array(NB); // lit floors per building (bench ground truth)
    this.peakF = new Float32Array(NB); // penthouse peak-hold (floors)
    this.bandLo = new Int16Array(B);
    this.bandHi = new Int16Array(B);
    for (let k = 0; k < B; k++) {
      this.bandLo[k] = Math.round(1 + Math.pow(k / B, 1.6) * 400);
      this.bandHi[k] = Math.max(this.bandLo[k] + 2, Math.round(1 + Math.pow((k + 1) / B, 1.6) * 400));
    }
    this.buildings = null; // laid out per canvas size
    this.bg = null;
    this.bgKey = "";
    // beat / tempo / accents
    this.beat = 0;
    this.bolt = 0;
    this.boltPts = null;
    this._prevBass = 0;
    this._bassPeak = 0.05;
    this._fluxAvg = 0.03;
    this._lastBolt = 0;
    this._lastBeatAt = 0;
    this.beatInt = 500; // ms between kicks (EMA) -> traffic speed
    this.loud = 0; // slow loudness -> traffic density, city wake level
    this.cars = [];
    this.t = 0;
    this.lastNow = 0;
    this.ms = 0;
  }

  // band for building i: mirrored — centre pair (27,28) is band 0 (bass)
  bandOf(i) {
    return i < B ? B - 1 - i : i - B;
  }

  layout(w, h) {
    const rnd = rng32(77); // FIXED seed: the bench asserts against this layout
    const base = h * 0.74;
    const gap = Math.max(2, w * 0.0016);
    // widths: bass towers broad, treble low-rises narrow — normalized to fill w
    const raw = [];
    let sum = 0;
    for (let i = 0; i < NB; i++) {
      const d = Math.abs(i - (NB - 1) / 2) / ((NB - 1) / 2); // 0 centre -> 1 edge
      const width = (1.25 - d * 0.5) * (0.8 + rnd() * 0.4);
      raw.push(width);
      sum += width;
    }
    const bs = [];
    let x = gap / 2;
    for (let i = 0; i < NB; i++) {
      const bw = (raw[i] / sum) * (w - gap * NB);
      const d = Math.abs(i - (NB - 1) / 2) / ((NB - 1) / 2);
      const bh = (h * 0.14 + h * 0.5 * Math.pow(1 - d, 1.55)) * (0.78 + rnd() * 0.44);
      const cols = Math.max(2, Math.floor((bw - 6) / 9));
      const floors = Math.max(3, Math.floor((bh - 10) / 11));
      // per-window occupancy: a building lit to floor N shows ~88% of those
      // windows, so it reads as a building, not a solid LED bar
      const mask = [];
      const owls = [];
      for (let f = 0; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          mask.push(rnd() < 0.88);
          owls.push(rnd() < 0.035); // the night shift — lit even when the city sleeps
        }
      }
      bs.push({
        x, y: base, w: bw, h: bh, cols, floors, mask, owls,
        winTint: rnd() < 0.5 ? 0 : 1, // which palette window colour
        antenna: bh > h * 0.42 && rnd() < 0.6,
        roof: rnd(), // roofline variety in the silhouette
      });
      x += bw + gap;
    }
    this.buildings = bs;
    this.base = base;
    this.riverY = h * 0.795;
    this.hwY = base + (this.riverY - base) * 0.35; // the highway strip
  }

  paintBg(w, h, pal) {
    if (!this.bg) this.bg = document.createElement("canvas");
    this.bg.width = w; this.bg.height = h;
    const c = this.bg.getContext("2d");
    // sky
    const g = c.createLinearGradient(0, 0, 0, this.base);
    g.addColorStop(0, `rgb(${pal.skyTop})`);
    g.addColorStop(1, `rgb(${pal.skyBot})`);
    c.fillStyle = g;
    c.fillRect(0, 0, w, this.base + 2);
    // stars + moon
    const rnd = rng32(99);
    for (let i = 0; i < 150; i++) {
      const sx = rnd() * w, sy = rnd() * this.base * 0.8, a = 0.15 + rnd() * 0.5;
      c.fillStyle = `rgba(255,255,255,${a * 0.5})`;
      c.fillRect(sx, sy, rnd() < 0.12 ? 1.6 : 1, 1);
    }
    const mx = w * 0.82, my = h * 0.16, mr = h * 0.045;
    const mg = c.createRadialGradient(mx, my, 0, mx, my, mr * 5);
    mg.addColorStop(0, `rgba(${pal.moon},0.5)`);
    mg.addColorStop(0.3, `rgba(${pal.moon},0.08)`);
    mg.addColorStop(1, `rgba(${pal.moon},0)`);
    c.fillStyle = mg;
    c.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
    c.fillStyle = `rgba(${pal.moon},0.95)`;
    c.beginPath(); c.arc(mx, my, mr, 0, Math.PI * 2); c.fill();
    // buildings: silhouettes + roofline detail + dim unlit window grid
    const [sr, sg2, sb] = pal.silhouette;
    for (const b of this.buildings) {
      c.fillStyle = `rgb(${sr},${sg2},${sb})`;
      c.fillRect(b.x, b.y - b.h, b.w, b.h);
      // roofline: water tower / stepped parapet / slab
      if (b.roof < 0.3 && b.w > 34) {
        c.fillRect(b.x + b.w * 0.3, b.y - b.h - 8, b.w * 0.18, 8); // tank
        c.fillRect(b.x + b.w * 0.34, b.y - b.h - 12, b.w * 0.1, 4);
      } else if (b.roof < 0.6) {
        c.fillRect(b.x + b.w * 0.18, b.y - b.h - 5, b.w * 0.64, 5);
      }
      if (b.antenna) {
        c.fillRect(b.x + b.w / 2 - 1, b.y - b.h - h * 0.05, 2, h * 0.05);
      }
      // unlit windows: barely-there grid so dark buildings still read
      c.fillStyle = "rgba(120,140,180,0.05)";
      for (let f = 0; f < b.floors; f++) {
        const wy = b.y - 8 - f * 11;
        for (let col = 0; col < b.cols; col++) {
          if (b.mask[f * b.cols + col]) c.fillRect(b.x + 4 + col * 9, wy - 6, 6, 7);
        }
      }
    }
    // river
    const rg = c.createLinearGradient(0, this.riverY, 0, h);
    rg.addColorStop(0, `rgb(${pal.river})`);
    rg.addColorStop(1, "#010203");
    c.fillStyle = rg;
    c.fillRect(0, this.riverY, w, h - this.riverY);
    // highway bed
    c.fillStyle = "rgba(0,0,0,0.5)";
    c.fillRect(0, this.hwY - 4, w, 9);
  }

  analyze(dt, now, sens) {
    const f = this.freq;
    // band levels: fast attack, musical decay (the windows are the meter)
    for (let k = 0; k < B; k++) {
      let s = 0, mx = 0;
      for (let i = this.bandLo[k]; i < this.bandHi[k]; i++) {
        s += f[i];
        if (f[i] > mx) mx = f[i];
      }
      // blend the band MEAN with its PEAK: log bands are 2 bins wide at the
      // bass end and 30+ at the treble end, so a pure tone averaged over a
      // wide band lit 3 floors while the same tone in a bass band lit 30 —
      // the meter under-reported anything narrowband in the suburbs. The
      // peak term restores tones; the mean keeps broadband honest.
      const mean = s / ((this.bandHi[k] - this.bandLo[k]) * 255);
      const raw = Math.max(mean, (mx / 255) * 0.55);
      // the -0.03 floor cut keeps mic hiss from lighting first floors all
      // night: in silence the city must actually sleep
      const v = Math.min(1, Math.max(0, raw * sens - 0.03) * 1.08);
      this.lvl[k] = v > this.lvl[k] ? v : Math.max(0, this.lvl[k] - dt * 1.3);
    }
    let bs = 0;
    for (let i = 1; i < 6; i++) bs += f[i];
    const bass = bs / (5 * 255);
    let all = 0;
    for (let i = 1; i < 380; i += 4) all += f[i];
    const rawLoud = all / (Math.ceil(379 / 4) * 255);
    this.loud += (Math.min(1, rawLoud * 3) - this.loud) * Math.min(1, dt * 0.8);
    // volume-independent kick + tempo (drives the sky pulse and the traffic)
    if (bass > 0.03) this._bassPeak = Math.max(this._bassPeak * (1 - dt * 0.05), bass, 0.04);
    const flux = Math.max(0, bass - this._prevBass) / Math.max(0.04, this._bassPeak);
    this._prevBass = bass;
    this._fluxAvg += (flux - this._fluxAvg) * Math.min(1, dt * 1.5);
    if (bass > 0.035 && flux > Math.max(0.05, this._fluxAvg * 2.1)) {
      if (this.beat < 0.6 && this._lastBeatAt) {
        const int = now - this._lastBeatAt;
        if (int > 240 && int < 2000) this.beatInt += (int - this.beatInt) * 0.25;
      }
      if (this.beat < 0.6) this._lastBeatAt = now;
      this.beat = 1;
    }
    this.beat = Math.max(0, this.beat - dt * 4);
    // lightning: a genuine accent, not every kick
    if (bass > 0.05 && flux > Math.max(0.16, this._fluxAvg * 4.4) && now - this._lastBolt > 8000) {
      this._lastBolt = now;
      this.bolt = 1;
      this.boltPts = null; // regenerate a fresh jag
    }
    this.bolt = Math.max(0, this.bolt - dt * 5);
  }

  drawTraffic(ctx, w, dt) {
    // tempo -> speed: 120bpm feels like city cruise, double-time rushes it
    const bpm = 60000 / this.beatInt;
    const speed = Math.max(60, Math.min(340, 140 * (bpm / 120)));
    const want = Math.round(this.loud * 26); // silence empties the highway
    while (this.cars.length < want) {
      this.cars.push({ x: Math.random() * w, dir: Math.random() < 0.5 ? 1 : -1, v: 0.75 + Math.random() * 0.5 });
    }
    if (this.cars.length > want) this.cars.length = want;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const car of this.cars) {
      car.x += car.dir * speed * car.v * dt;
      if (car.x > w + 10) car.x = -10;
      if (car.x < -10) car.x = w + 10;
      const y = this.hwY + (car.dir > 0 ? 0 : 4);
      ctx.fillStyle = car.dir > 0 ? "rgba(255,235,190,0.85)" : "rgba(255,70,50,0.8)";
      ctx.fillRect(car.x, y, 3.5, 1.6);
      ctx.fillStyle = car.dir > 0 ? "rgba(255,235,190,0.12)" : "rgba(255,70,50,0.1)";
      ctx.fillRect(car.x - 3, y - 1, 10, 4);
    }
    ctx.restore();
  }

  drawBolt(ctx, w, h, pal) {
    if (!this.boltPts) {
      const pts = [];
      let x = w * (0.25 + Math.random() * 0.5), y = 0;
      pts.push([x, y]);
      while (y < this.base * 0.75) {
        y += 14 + Math.random() * 26;
        x += (Math.random() - 0.5) * 56;
        pts.push([x, y]);
      }
      this.boltPts = pts;
    }
    const a = this.bolt * pal.bolt;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // sky flash
    ctx.fillStyle = `rgba(${pal.glow},${a * 0.16})`;
    ctx.fillRect(0, 0, w, this.base);
    ctx.strokeStyle = `rgba(240,246,255,${a * 0.28})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < this.boltPts.length; i++) {
      const [px, py] = this.boltPts[i];
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${a * 0.85})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  render(ctx, analyser, w, h, now) {
    const t0 = performance.now();
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t += dt;
    if (analyser) analyser.getByteFrequencyData(this.freq);
    else this.freq.fill(0);

    const pal = PALETTES[this.cfg.preset] || PALETTES["Midnight Amber"];
    const key = `${w}x${h}|${this.cfg.preset}`;
    if (!this.buildings || this.bgKey !== key) {
      this.layout(w, h);
      this.paintBg(w, h, pal);
      this.bgKey = key;
    }
    this.analyze(dt, now, this.cfg.sensitivity);

    ctx.drawImage(this.bg, 0, 0);

    // drifting clouds (live: they move) — two soft blobs
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 2; i++) {
      const cx = ((this.t * (6 + i * 4) + i * 900) % (w + 600)) - 300;
      const cy = this.base * (0.22 + i * 0.18);
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 190);
      cg.addColorStop(0, `rgba(${pal.glow},0.045)`);
      cg.addColorStop(1, `rgba(${pal.glow},0)`);
      ctx.fillStyle = cg;
      ctx.fillRect(cx - 190, cy - 120, 380, 240);
    }
    // the kick lights the sky behind downtown — the whole city acknowledges it
    if (this.beat > 0.02) {
      const bg2 = ctx.createRadialGradient(w / 2, this.base, 0, w / 2, this.base, w * 0.3);
      bg2.addColorStop(0, `rgba(${pal.glow},${this.beat * 0.12})`);
      bg2.addColorStop(1, `rgba(${pal.glow},0)`);
      ctx.fillStyle = bg2;
      ctx.fillRect(w * 0.2, 0, w * 0.6, this.base);
    }
    ctx.restore();
    if (this.bolt > 0.03) this.drawBolt(ctx, w, h, pal);

    // ---- the lit windows: the actual meter --------------------------------
    const owlBlink = (i, f, c) => (Math.sin(this.t * 0.4 + i * 3.1 + f * 1.7 + c * 5.3) > -0.85);
    for (let i = 0; i < NB; i++) {
      const b = this.buildings[i];
      const lvl = this.lvl[this.bandOf(i)];
      const lit = Math.min(b.floors, Math.round(lvl * b.floors));
      this.litF[i] = lit;
      // penthouse peak-hold: flashes at the peak, then sinks floor by floor
      this.peakF[i] = lit >= this.peakF[i] ? lit : Math.max(lit, this.peakF[i] - dt * 2.6);
      const [wr, wg, wb] = pal.win[b.winTint];
      ctx.fillStyle = `rgba(${wr},${wg},${wb},0.9)`;
      for (let f = 0; f < lit; f++) {
        const wy = b.y - 8 - f * 11;
        const off = f * b.cols;
        for (let c = 0; c < b.cols; c++) {
          if (b.mask[off + c]) ctx.fillRect(b.x + 4 + c * 9, wy - 6, 6, 7);
        }
      }
      // night owls above the lit floors — the city is never fully dead
      ctx.fillStyle = `rgba(${pal.owl},0.5)`;
      for (let f = lit; f < b.floors; f++) {
        const off = f * b.cols;
        for (let c = 0; c < b.cols; c++) {
          if (b.owls[off + c] && owlBlink(i, f, c)) ctx.fillRect(b.x + 4 + c * 9, b.y - 8 - f * 11 - 6, 6, 7);
        }
      }
      const pf = Math.round(this.peakF[i]);
      if (pf > 0 && pf >= lit && pf <= b.floors) {
        const py = b.y - 8 - (pf - 1) * 11;
        ctx.fillStyle = `rgba(255,255,255,${0.55 + this.beat * 0.35})`;
        ctx.fillRect(b.x + 4, py - 6, b.w - 8, 2.5);
      }
      // aircraft-warning beacon on the tall ones
      if (b.antenna && (this.t * 0.7 + i * 0.37) % 1 < 0.1) {
        ctx.fillStyle = "rgba(255,60,50,0.9)";
        ctx.fillRect(b.x + b.w / 2 - 1.5, b.y - b.h - h * 0.05 - 2, 3, 3);
      }
      // river reflection: one soft column per building, brightness = its light
      const glow = lit / b.floors;
      if (glow > 0.02) {
        ctx.fillStyle = `rgba(${wr},${wg},${wb},${glow * 0.1})`;
        ctx.fillRect(b.x + 2, this.riverY + 2, b.w - 4, (h - this.riverY) * (0.3 + glow * 0.5));
      }
    }

    this.drawTraffic(ctx, w, dt);

    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
}
