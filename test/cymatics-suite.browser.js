// Cymatics bench — does the pattern actually FORM?
//
//   const src = await (await fetch('/test/cymatics-suite.browser.js')).text();
//   eval(src); await cymaticsSuite();
//
// The mode's claim is real cymatics: grains jitter off antinodes and settle
// on nodal lines, so a held tone must ASSEMBLE its figure (measured as node
// density vs off-node density, against the mode's own field), pitch changes
// must re-sculpt it exactly as often as the hysteresis allows, drums must
// never re-sculpt it, a drop must re-scatter it, and silence must be a
// museum: zero retargets, zero motion.
//
//   patternForms   held A4 -> nodal density >= 3x off-node within 4s,
//                  plus formation HALF-LIFE (the settle-feel tuning dial)
//   hysteresis     6-step rung walk -> exactly 6 retargets; 80ms flutter -> 0
//   drums          drums-only: taps fire, retargets NEVER (broadband != pitch)
//   rupture        edm build->drop: a rupture lands in the drop window
//   silence        room tone: no retargets/taps/ruptures, grains motionless
//   perf           cost at 1920x480 with 10k grains (incl. retargets)

async function cymaticsSuite() {
  const V = Date.now();
  const { renderSong, SR } = await import(`/test/harness/songbank.js?v=${V}`);
  const { AnalyserSim } = await import(`/test/harness/analysersim.js?v=${V}`);
  const { Cymatics, rungOfMidi } = await import(`/src/cymatics.js?v=${V}`);
  const results = {};

  const W = 1920, H = 480;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // held tone with mild harmonics (a synth note, not a naked sine — though the
  // tonality gate means a naked sine would also drive the plate)
  const toneInto = (out, at, freq, secs) => {
    const n = Math.round(secs * SR);
    for (let i = 0; i < n && at + i < out.length; i++) {
      const t = i / SR;
      const env = Math.min(1, t * 100) * Math.min(1, (secs - t) / 0.03);
      out[at + i] += (Math.sin(2 * Math.PI * freq * t) +
        0.3 * Math.sin(2 * Math.PI * freq * 2 * t) +
        0.15 * Math.sin(2 * Math.PI * freq * 3 * t)) * env * 0.4;
    }
  };
  const tonePcm = (freq, secs) => {
    const out = new Float32Array(Math.round(secs * SR));
    toneInto(out, 0, freq, secs);
    return out;
  };
  const walkPcm = (freqs, segSecs) => {
    const out = new Float32Array(Math.round(freqs.length * segSecs * SR));
    freqs.forEach((f, i) => toneInto(out, Math.round(i * segSecs * SR), f, segSecs));
    return out;
  };

  const run = (pcm, secs, onFrame) => {
    const inst = new Cymatics();
    const hi = new AnalyserSim(pcm, { fftSize: 8192, smoothingTimeConstant: 0.35, sampleRate: SR });
    const lo = new AnalyserSim(pcm, { fftSize: 2048, smoothingTimeConstant: 0.55, sampleRate: SR });
    lo.hiRes = hi;
    let now = 1000;
    for (let i = 0; i < Math.round(secs * 60); i++) {
      const t = i / 60;
      hi.seek(t); lo.seek(t);
      now += 1000 / 60;
      inst.render(ctx, lo, W, H, now);
      if (onFrame) onFrame(inst, t, i);
    }
    return inst;
  };

  // node density vs off-node density, judged against the inst's OWN field
  const ratioOf = (inst) => {
    const NGRID = inst.fld.length;
    let nodeA = 0, offA = 0;
    for (let i = 0; i < NGRID; i++) {
      if (inst.fld[i] < 0.2) nodeA++;
      else if (inst.fld[i] > 0.5) offA++;
    }
    let nodeG = 0, offG = 0;
    for (let i = 0; i < inst._act; i++) {
      const f = inst.sampleF(inst.px[i], inst.py[i], W, H);
      if (f < 0.2) nodeG++;
      else if (f > 0.5) offG++;
    }
    if (!nodeA || !offA) return 1;
    if (!offG) return 999;
    return (nodeG / nodeA) / (offG / offA);
  };

  // --- 1. THE CLAIM: a held tone assembles its Chladni figure
  {
    const samples = [];
    const inst = run(tonePcm(440, 6), 6, (i2, t, fr) => {
      if (fr % 15 === 0 && t > 0.3) samples.push({ t: +t.toFixed(2), ratio: +ratioOf(i2).toFixed(2) });
    });
    const at4 = samples.filter((s) => s.t <= 4).pop();
    const half = samples.find((s) => s.ratio >= 3);
    results.patternForms = {
      pass: inst.retargets >= 1 && at4 && at4.ratio >= 3,
      ratioAt4s: at4 ? at4.ratio : 0,
      finalRatio: samples[samples.length - 1].ratio,
      halfLifeSecs: half ? half.t : null, // the settle-feel dial: ~1-2s is right
      retargets: inst.retargets,
    };
  }

  // --- 2. perf on a full mix. Runs EARLY: a full suite pegs the CPU for ~60s
  // and turbo droop makes later groups measure the machine's thermals, not
  // the mode (same code measured 0.88ms and 3.8ms in back-to-back suite
  // runs). MEDIAN frame, not the lifetime EMA, so stray GC pauses don't
  // count either. (The EMA stays in the app: the Pi's auto-quality SHOULD
  // react to real environmental slowness there.)
  {
    const { pcm } = renderSong("rock-e-minor");
    const costs = [];
    let last = performance.now();
    const inst = run(pcm, 10, () => {
      const n2 = performance.now();
      costs.push(n2 - last);
      last = n2;
    });
    costs.sort((a, b) => a - b);
    const median = costs[costs.length >> 1];
    // throttle-proof fallback: the browser pane can deprioritize this tab ~4x
    // (measured: the same code benched 0.8ms and 3.9ms back to back). A fixed
    // reference loop measured in the same breath scales with the same
    // throttle, so the RATIO is the honest machine-independent budget.
    const arr = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) arr[i] = Math.random();
    const refs = [];
    for (let r = 0; r < 25; r++) {
      const s0 = performance.now();
      let s = 0;
      for (let i = 0; i < 600000; i++) s += arr[i & 1023] * 0.5;
      refs.push(performance.now() - s0 + (s > 1e12 ? 1 : 0));
    }
    refs.sort((a, b) => a - b);
    const ref = refs[12];
    results.perf = {
      pass: median < 2.5 || median / ref < 5,
      msMedian: +median.toFixed(2),
      msP90: +costs[(costs.length * 0.9) | 0].toFixed(2),
      refMs: +ref.toFixed(2),
      xRef: +(median / ref).toFixed(2), // render vs 600k mult-adds; budget 5x
      grains: inst._act,
      retargets: inst.retargets,
    };
  }

  // --- 3. hysteresis: rung-center walk retargets exactly once per step,
  // and 80ms flutter between two rungs retargets never
  {
    const rungs = [6, 8, 10, 12, 14, 15];
    const freqs = rungs.map((r) => mtof(33 + r * 4)); // rung CENTERS: robust to interp error
    const inst = run(walkPcm(freqs, 1.2), rungs.length * 1.2, null);
    const expected = rungs.length; // first lock + 5 changes
    const flutter = run(walkPcm(
      Array.from({ length: 38 }, (_, i) => mtof(33 + (i % 2 ? 8 : 6) * 4)), 0.08
    ), 3, null);
    results.hysteresis = {
      pass: inst.retargets === expected && flutter.retargets === 0,
      walkRetargets: inst.retargets, expected,
      flutterRetargets: flutter.retargets,
    };
  }

  // --- 4. drums tap the plate but NEVER re-sculpt it
  {
    const { pcm, truth } = renderSong("drums-only");
    const inst = run(pcm, Math.min(truth.duration, pcm.length / SR), null);
    results.drums = {
      pass: inst.taps >= 8 && inst.retargets === 0 && inst.ruptures <= 1,
      taps: inst.taps, retargets: inst.retargets, ruptures: inst.ruptures,
    };
  }

  // --- 5. the money shot: the drop re-scatters the plate
  {
    const { pcm } = renderSong("edm-c-drop");
    const rupAt = [];
    let seen = 0;
    run(pcm, 12, (i2, t) => {
      if (i2.ruptures > seen) { seen = i2.ruptures; rupAt.push(+t.toFixed(2)); }
    });
    // the drop is at bar 4 = 7.5s (bars 0-3 build at 0.45 gain, then full)
    const hit = rupAt.find((t) => t >= 7.3 && t <= 10);
    results.rupture = { pass: !!hit, rupturesAt: rupAt, dropAt: 7.5 };
  }

  // --- 6. silence is a museum
  {
    const { pcm } = renderSong("room-tone");
    let snap = null;
    const inst = run(pcm, 8, (i2, t, fr) => {
      if (fr === 60 * 5) snap = i2.px.slice(0, 64);
    });
    let drift = 0;
    for (let i = 0; i < 64; i++) drift += Math.abs(inst.px[i] - snap[i]);
    drift /= 64;
    results.silence = {
      pass: inst.retargets === 0 && inst.taps === 0 && inst.ruptures === 0 &&
        inst.agitation < 0.02 && drift < 0.5,
      retargets: inst.retargets, taps: inst.taps, ruptures: inst.ruptures,
      agitation: +inst.agitation.toFixed(3), meanDriftPx: +drift.toFixed(3),
    };
  }

  const all = Object.values(results).every((r) => r.pass);
  console.log(`CYMATICS SUITE: ${all ? "ALL PASS" : "FAILURES"}`);
  for (const [k, v] of Object.entries(results)) console.log(k, v.pass ? "PASS" : "FAIL", v);
  return { all, results };
}
