// Waveform analysis bench — Wave + Oscilloscope across the musical range.
//
//   window.__WaveMods = { Wave: (await import('/src/wave.js')).Wave,
//                         Oscilloscope: (await import('/src/hifi/oscilloscope.js')).Oscilloscope };
//   const src = await (await fetch('/test/waveform-suite.browser.js')).text();
//   eval(src); await waveformSuite();
//
// (No import in this file: Vite's transform of fetched JS injects a static
// import helper for dynamic imports, which breaks eval.)
//
// Measures, per synthetic song:
//   fillAvg/Min/Max  the trace's on-screen height as % of panel — is it visible?
//   pumpPct          how much the auto-range gain WOBBLES while the music is
//                    steady. This is the "breathing/pumping" artifact: high =
//                    the picture is re-scaling itself constantly.
//   dynRangeX        loud passage fill / quiet passage fill WITHIN one song.
//                    1.0 = every passage looks identical (dynamics destroyed);
//                    the ear hears a quiet verse, so the eye should too.
//   gainMin/Max      what the normalizer is actually doing.

// ---- synthetic songs: level, transient hardness, and dynamics ---------------
// exc = peak excursion of the waveform (what a time-domain display shows).
// Real music at mic level: a whisper-quiet passage ~0.01-0.03, a loud
// mastered chorus ~0.3-0.6.
const SONGS = {
  // super soft + slow: sparse piano, long decays, almost no transient
  ambient:   { exc: 0.02, bpm: 52,  hard: 0.15, tone: 3,  dyn: 0 },
  ballad:    { exc: 0.06, bpm: 68,  hard: 0.3,  tone: 5,  dyn: 0 },
  acoustic:  { exc: 0.14, bpm: 95,  hard: 0.5,  tone: 7,  dyn: 0 },
  rock:      { exc: 0.30, bpm: 120, hard: 0.8,  tone: 9,  dyn: 0 },
  // fast + pounding: hard kick transients, heavily compressed
  edm:       { exc: 0.45, bpm: 128, hard: 1.0,  tone: 6,  dyn: 0 },
  metal:     { exc: 0.55, bpm: 170, hard: 1.0,  tone: 12, dyn: 0 },
  // DYNAMIC: quiet verse -> loud chorus every 8s. The key test: does the
  // display preserve the difference the ear hears?
  dynamic:   { exc: 0.40, bpm: 100, hard: 0.7,  tone: 6,  dyn: 1 },
};

function makeAnalyser(state) {
  return {
    getFloatTimeDomainData(a) {
      const s = SONGS[state.song];
      const t = state.t;
      const beatHz = s.bpm / 60;
      const beatPhase = (t * beatHz) % 1;
      // hard kick transient: sharp attack, exponential decay
      const kick = Math.exp(-beatPhase * (4 + s.hard * 22)) * s.hard;
      // dynamic songs swing between a quiet verse and a loud chorus
      const passage = s.dyn ? (Math.floor(t / 8) % 2 === 0 ? 0.18 : 1.0) : 1.0;
      const amp = s.exc * passage * state.vol;
      for (let i = 0; i < a.length; i++) {
        const ph = (i / a.length) * Math.PI * 2;
        const body = Math.sin(ph * s.tone + t * 3) * 0.5 + Math.sin(ph * s.tone * 2.1 + t * 5) * 0.22;
        a[i] = (body * (0.45 + kick * 0.55) + kick * Math.sin(ph * 2) * 0.5) * amp;
      }
    },
    getByteFrequencyData(a) {
      const s = SONGS[state.song];
      const beatPhase = (state.t * (s.bpm / 60)) % 1;
      const kick = Math.exp(-beatPhase * (4 + s.hard * 22)) * s.hard;
      const passage = s.dyn ? (Math.floor(state.t / 8) % 2 === 0 ? 0.18 : 1.0) : 1.0;
      const lvl = s.exc * passage * state.vol * 255 * 2.2;
      for (let i = 0; i < a.length; i++) {
        a[i] = Math.min(255, Math.round((i < 26 ? lvl * (0.6 + kick) : i < 200 ? lvl * 0.5 : lvl * 0.2)));
      }
    },
    getByteTimeDomainData(a) {
      const f = new Float32Array(a.length);
      this.getFloatTimeDomainData(f);
      for (let i = 0; i < a.length; i++) a[i] = Math.max(0, Math.min(255, Math.round(128 + f[i] * 128)));
    },
  };
}

async function waveformSuite({ seconds = 20, vol = 1, only = null, sampleEvery = 10 } = {}) {
  const { Wave, Oscilloscope } = window.__WaveMods;
  // half-scale panel (same 4:1 aspect): every amplitude scales with h, so
  // fill% is identical to 1920x480 while getImageData costs 4x less
  const W = 960, H = 240;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });

  // trace height as % of panel, measured from painted pixels
  const fillOf = (isScope) => {
    const d = ctx.getImageData(0, 0, W, H).data;
    let minY = H, maxY = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x += 6) {
        const o = (y * W + x) * 4;
        // measure by COLOR, not alpha — the bench clears to OPAQUE black so
        // every pixel has alpha 255. scope: bright green trace only (dim grid);
        // wave: the purple/pink line lifts luminance well above near-black.
        const lit = isScope ? d[o + 1] > 150 : d[o] + d[o + 1] + d[o + 2] > 70;
        if (lit) { if (y < minY) minY = y; if (y > maxY) maxY = y; break; }
      }
    }
    return maxY < 0 ? 0 : ((maxY - minY) / H) * 100;
  };

  const results = {};
  const modes = [["Wave", Wave], ["Scope", Oscilloscope]].filter(([n]) => !only || n === only);
  for (const [name, Cls] of modes) {
    for (const song of Object.keys(SONGS)) {
      const inst = new Cls();
      const state = { t: 0, song, vol };
      const an = makeAnalyser(state);
      let now = 1000;
      const fills = [], gains = [], quiet = [], loud = [];
      const dt = 1000 / 60;
      for (let i = 0; i < seconds * 60; i++) {
        state.t += dt / 1000;
        now += dt;
        inst.render(ctx, an, W, H, now); // fade-based trails handled by mode/main; clear not needed for measurement of current frame
        if (i < 300) continue; // let the SLOW auto-range settle (5s)
        gains.push(Math.min(26, 0.6 / Math.max(0.012, inst.level)));
        if (i % sampleEvery === 0) { // pixel-read only every Nth frame (expensive)
          ctx.fillStyle = "rgba(0,0,0,1)"; ctx.fillRect(0, 0, W, H);
          inst.render(ctx, an, W, H, now); // clean single-frame draw to measure
          const f = fillOf(name === "Scope");
          fills.push(f);
          if (SONGS[song].dyn) (Math.floor(state.t / 8) % 2 === 0 ? quiet : loud).push(f);
        }
      }
      const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
      const gAvg = avg(gains);
      const gStd = Math.sqrt(avg(gains.map((g) => (g - gAvg) ** 2)));
      results[`${name} · ${song}`] = {
        fillAvg: +avg(fills).toFixed(1),
        fillMin: +Math.min(...fills).toFixed(1),
        fillMax: +Math.max(...fills).toFixed(1),
        pumpPct: +((gStd / Math.max(0.01, gAvg)) * 100).toFixed(1),
        gainMin: +Math.min(...gains).toFixed(1),
        gainMax: +Math.max(...gains).toFixed(1),
        dynRangeX: SONGS[song].dyn ? +(avg(loud) / Math.max(0.1, avg(quiet))).toFixed(2) : "-",
      };
    }
  }
  console.table(results);
  return results;
}
window.waveformSuite = waveformSuite;
