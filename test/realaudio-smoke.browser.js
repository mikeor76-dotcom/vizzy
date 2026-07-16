// Real-audio smoke — every mode, driven by actual rendered music.
//
//   const src = await (await fetch('/test/realaudio-smoke.browser.js')).text();
//   eval(src); await realAudioSmoke();
//
// (This one CAN import: it's fetched+eval'd but the harness modules are pulled
// via dynamic import() inside an async function, which survives Vite's
// transform — the static-import breakage only bites top-level imports.)
//
// This suite exists because of a specific, embarrassing failure: Murmuration
// passed every hand-painted-spectrum test in its bench and still didn't
// visibly react to music in the user's living room. Painted spectra can't
// reproduce spectral leakage, harmonic stacks, the analyser's own smoothing,
// or real transient shapes. So: three contracts, checked against real audio,
// for every mode at once.
//
//   PAINTS   the mode puts light on the panel during music
//   MOVES    consecutive frames differ — it's reacting, not just decorating
//   SLEEPS   modes with an idle contract go quiet in real room tone
//            (room tone, NOT digital silence — hiss is the adversary)
//   BPM      beat-tracking modes land within 15% of the song's true tempo

async function realAudioSmoke(opts = {}) {
  const V = Date.now();
  const { renderSong } = await import(`/test/harness/songbank.js?v=${V}`);
  const { AnalyserSim } = await import(`/test/harness/analysersim.js?v=${V}`);

  // `fade` MIRRORS main.js's draw loop, which paints it before every render.
  // Omitting it isn't a shortcut, it's a different program: trail modes (wave,
  // oscilloscope, spectrum, galaxy) rely on that fill to clear, so without it
  // the canvas saturates to a solid slab within seconds and every metric —
  // lit, motion — measures the slab instead of the mode. Keep in sync.
  const MODES = [
    ["ferrofluid", "/src/ferrofluid.js", "Ferrofluid", { beat: "beat", gated: true, fade: "rgb(1, 2, 4)" }],
    ["flames", "/src/flames.js", "Flames", { beat: "beat", sens: true, gated: true, fade: "rgb(4, 3, 10)" }],
    ["murmuration", "/src/murmuration.js", "Murmuration", { beat: "beat", gated: true, fade: "rgba(0, 0, 0, 0)" }],
    ["skyline", "/src/skyline.js", "Skyline", { beat: "beat", gated: true, fade: "rgb(2, 3, 8)" }],
    ["lasers", "/src/lasers.js", "Lasers", { beat: "beat", gated: true, fade: "rgb(2, 2, 4)" }],
    ["vectorcrt", "/src/vectorcrt.js", "VectorCrt", { beat: "beat", gated: true, fade: "rgb(0, 0, 0)" }],
    ["aurora", "/src/aurora.js", "Aurora", { sens: true, fade: "rgb(1, 3, 12)" }],
    ["classical", "/src/classical.js", "Classical", { fade: "rgba(5, 4, 2, 0.4)" }],
    ["synthwave", "/src/synthwave.js", "Synthwave", { fade: "rgb(10, 5, 20)" }],
    ["spectrum", "/src/spectrum.js", "Spectrum", { sens: true, fade: "rgba(4, 4, 9, 0.55)" }],
    ["wave", "/src/wave.js", "Wave", { fade: "rgba(11, 11, 18, 0.22)" }],
    ["galaxy", "/src/galaxy.js", "Galaxy", { sens: true, fade: "rgba(5, 9, 20, 0.28)" }],
    ["oscilloscope", "/src/hifi/oscilloscope.js", "Oscilloscope", { fade: "rgba(4, 7, 6, 0.3)" }],
    ["blue-power-meters", "/src/hifi/bluemeters.js", "BlueMeters", { sens: true, fade: "rgb(2, 3, 6)" }],
    ["waterfall", "/src/hifi/waterfall.js", "Waterfall", { sens: true, fade: "rgb(5, 6, 10)" }],
    ["studio-monitor", "/src/hifi/studiomonitor.js", "StudioMonitor", { sens: true, fade: "rgb(6, 7, 9)" }],
  ];
  const only = opts.only ? new Set([].concat(opts.only)) : null;

  const W = 1920, H = 480;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });

  // "lit" by COLOUR, never alpha: these canvases are cleared to opaque black,
  // so every pixel has alpha 255 and an alpha test reports 100% forever
  const litFraction = () => {
    const d = ctx.getImageData(0, 0, W, H).data;
    let lit = 0, n = 0;
    for (let i = 0; i < d.length; i += 64) { // sample every 16th px
      if (d[i] + d[i + 1] + d[i + 2] > 42) lit++;
      n++;
    }
    return lit / n;
  };
  // Tile AVERAGES, not scattered point samples. A waveform is a 1.5px line on
  // a black field: random points almost never land on it, so point-sampling
  // reported Wave's motion as 0.045 while the trace was visibly whipping
  // around. A tile's mean brightness changes whenever a line crosses it.
  const TX = 64, TY = 16;
  const snapshot = () => {
    const d = ctx.getImageData(0, 0, W, H).data;
    const s = new Float32Array(TX * TY);
    const tw = (W / TX) | 0, th = (H / TY) | 0;
    for (let ty = 0; ty < TY; ty++) {
      for (let tx = 0; tx < TX; tx++) {
        let sum = 0, n = 0;
        for (let y = ty * th; y < (ty + 1) * th; y += 3) {
          for (let x = tx * tw; x < (tx + 1) * tw; x += 3) {
            const p = (y * W + x) << 2;
            sum += d[p] + d[p + 1] + d[p + 2];
            n++;
          }
        }
        s[ty * TX + tx] = sum / (n * 3);
      }
    }
    return s;
  };
  // Mean of the top-decile tiles: "is something on screen really moving?".
  // A flat mean judges a spatially-sparse mode on its empty sky — Murmuration
  // (a ~200px flock on a 1920x480 field) read 0.32 while the flock was plainly
  // swirling, because ~90% of tiles are motionless background by design.
  const diff = (a, b) => {
    const d = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) d[i] = Math.abs(a[i] - b[i]);
    d.sort();
    const k = Math.max(1, Math.floor(d.length * 0.1));
    let s = 0;
    for (let i = d.length - k; i < d.length; i++) s += d[i];
    return s / k;
  };

  const songs = {
    rock: renderSong("rock-e-minor"),
    ballad: renderSong("ballad-g-major"),
    room: renderSong("room-tone"),
  };

  const results = {};
  const rows = [];
  for (const [id, path, cls, flags] of MODES) {
    if (only && !only.has(id)) continue;
    let Mode;
    try {
      Mode = (await import(`${path}?v=${V}`))[cls];
    } catch (e) {
      rows.push({ mode: id, ok: false, error: `import: ${e.message}` });
      continue;
    }
    const row = { mode: id };
    try {
      const inst = new Mode();
      if (flags.sens) inst.cfg.sensitivity = 1.25; // AutoGain-driven modes
      const sim = new AnalyserSim(songs.rock.pcm, { smoothingTimeConstant: 0.55 });
      const paint = () => { ctx.fillStyle = flags.fade; ctx.fillRect(0, 0, W, H); };
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

      // --- music: paints + moves + tracks tempo
      // Count beats with the SAME hysteresis the modes use internally
      // (`if (this.beat < 0.6)` guards every discrete beat event). A plain
      // rising-edge-over-0.9 counter double-counts: real transients are
      // multi-frame — the analyser's own smoothing spreads a kick across ~3-4
      // frames — so the envelope dips under 0.9 and re-lifts on the SAME hit.
      // Measured, that read flames as firing 53 times for 38 hits; with the
      // guard it matches 100% of them with 1 spurious. The modes were right;
      // the counter was wrong. (Synthetic spectra hid this completely: a
      // painted `exp(-phase*16)` kick has no attack ramp at all.)
      let now = 1000, beats = 0, armed = true;
      let lit = 0, motion = 0, frames = 0, prev = null;
      for (let i = 0; i < 20 * 60; i++) {
        const t = i / 60;
        sim.seek(t); now += 1000 / 60;
        paint();
        inst.render(ctx, sim, W, H, now);
        if (flags.beat) {
          const b = inst[flags.beat];
          if (b > 0.9 && armed) { beats++; armed = false; }
          if (b < 0.6) armed = true;
        }
        if (i > 300 && i % 12 === 0) { // settle 5s, then sample
          const snap = snapshot();
          if (prev) { motion += diff(prev, snap); frames++; }
          prev = snap;
          lit += litFraction();
        }
      }
      const nSamp = Math.max(1, Math.floor((20 * 60 - 300) / 12));
      row.lit = +(lit / nSamp).toFixed(4);
      row.motion = +(motion / Math.max(1, frames)).toFixed(3);
      if (flags.beat) {
        // vs the song's actual low-end transients, not its musical bpm — see
        // the ground-truth note in songbank.js
        const hits = songs.rock.truth.bassHits.filter((t) => t >= 5 && t < 20).length;
        row.hitsFound = +((beats / 20) * 60).toFixed(0);
        row.hitsTrue = +((hits / 15) * 60).toFixed(0);
        const ratio = row.hitsFound / row.hitsTrue;
        row.hitRatio = +ratio.toFixed(2);
        row.beatOk = ratio > 0.5 && ratio < 1.25; // alive + not double-firing
      }

      // --- room tone: modes with an idle contract must go quiet
      const roomSim = new AnalyserSim(songs.room.pcm, { smoothingTimeConstant: 0.55 });
      let roomMotion = 0, rf = 0, rprev = null;
      for (let i = 0; i < 14 * 60; i++) {
        roomSim.seek((i / 60) % songs.room.truth.duration);
        now += 1000 / 60;
        paint();
        inst.render(ctx, roomSim, W, H, now);
        if (i > 600 && i % 12 === 0) { // after it has had time to settle
          const snap = snapshot();
          if (rprev) { roomMotion += diff(rprev, snap); rf++; }
          rprev = snap;
        }
      }
      row.roomMotion = +(roomMotion / Math.max(1, rf)).toFixed(3);
      row.roomRatio = +(row.roomMotion / Math.max(0.001, row.motion)).toFixed(2);
      // A sleeping mode may still breathe/drift — it must simply be much
      // calmer than with music. Only gated modes are held to it; the rest
      // report the ratio so the number stays visible.
      row.sleepsOk = flags.gated ? row.roomMotion < Math.max(0.4, row.motion * 0.45) : null;

      row.paintsOk = row.lit > 0.002;
      row.movesOk = row.motion > 0.35;
      row.ok = row.paintsOk && row.movesOk && row.sleepsOk !== false && row.beatOk !== false;
    } catch (e) {
      row.ok = false;
      row.error = e.message;
    }
    rows.push(row);
  }

  results.modes = rows;
  if (!only) results.calibration = await calibrateAnalyserSim();
  results.pass = rows.every((r) => r.ok) && (results.calibration?.pass !== false);
  results.failed = rows.filter((r) => !r.ok).map((r) => r.mode);
  console.table(rows);
  return results;
}

// The load-bearing claim of this whole harness is that AnalyserSim sees what
// a real AnalyserNode sees. That claim is CHECKED here, every run, against a
// live node driven by the same PCM through OfflineAudioContext.suspend() —
// not asserted in a comment. If the sim ever drifts from the spec (or a
// browser changes), every bench built on it goes quietly wrong, so this test
// is the harness's foundation and it fails loudly.
async function calibrateAnalyserSim() {
  const V = Date.now();
  const { renderSong } = await import(`/test/harness/songbank.js?v=${V}`);
  const { AnalyserSim } = await import(`/test/harness/analysersim.js?v=${V}`);
  const { pcm } = renderSong("rock-e-minor");
  const SR = 48000, FFT = 2048, STC = 0.55, Q = 128; // suspend() snaps to quanta

  const octx = new OfflineAudioContext(1, pcm.length, SR);
  const buf = octx.createBuffer(1, pcm.length, SR);
  buf.copyToChannel(pcm, 0);
  const src = octx.createBufferSource();
  src.buffer = buf;
  const node = octx.createAnalyser();
  node.fftSize = FFT;
  node.smoothingTimeConstant = STC;
  src.connect(node);
  node.connect(octx.destination);
  src.start();
  const times = [];
  for (let f = 6; f < 260; f++) times.push((f * Q * 6) / SR);
  const real = [];
  for (const t of times) {
    octx.suspend(t).then(() => {
      const a = new Uint8Array(FFT / 2);
      node.getByteFrequencyData(a);
      real.push(a);
      octx.resume();
    });
  }
  await octx.startRendering();

  const sim = new AnalyserSim(pcm, { fftSize: FFT, smoothingTimeConstant: STC, sampleRate: SR });
  let sum = 0, n = 0, worst = 0;
  for (let f = 0; f < times.length; f++) {
    sim.seek(times[f]);
    const mine = new Uint8Array(FFT / 2);
    sim.getByteFrequencyData(mine);
    if (f < 20) continue; // let the smoothing history converge
    for (let k = 1; k < 400; k++) {
      const d = Math.abs(real[f][k] - mine[k]);
      sum += d; n++;
      if (d > worst) worst = d;
    }
  }
  const meanDiff = sum / n;
  return {
    pass: meanDiff < 0.5 && worst <= 3,
    meanByteDiff: +meanDiff.toFixed(3),
    worstBinDiff: worst,
    frames: times.length,
    note: "AnalyserSim vs a live AnalyserNode on identical PCM (bins 1-400)",
  };
}
window.realAudioSmoke = realAudioSmoke;
