// Laser Show bench — does the LJ actually listen, and is the strobe SAFE?
//
//   window.__Lasers = (await import('/src/lasers.js')).Lasers;
//   const src = await (await fetch('/test/lasers-suite.browser.js')).text();
//   eval(src); await lasersSuite();
//
// (No import in this file: Vite's transform of fetched JS breaks eval.)
//
// The one test that matters more than all the others: SAFETY. Full-field
// flashes must never exceed 3/s no matter what the music does (WCAG
// photosensitivity guidance), and it's enforced in the engine so no cue can
// break it. The bench hammers the engine with a 190bpm metal signal plus
// direct pulse spam and counts what actually got through.

function laserAnalyser(state) {
  return {
    getByteFrequencyData(a) {
      const s = state.spec;
      if (s.silence) {
        for (let i = 0; i < a.length; i++) a[i] = Math.max(0, Math.round(2 + Math.random() * 3 - (i / a.length) * 1.5));
        return;
      }
      const t = state.t;
      const kick = Math.exp(-((t * s.bpm / 60) % 1) * (5 + (s.hard ?? 0.8) * 20)) * (s.hard ?? 0.8);
      const L = s.level + (s.wobble ? Math.sin(t * 0.35) * s.wobble : 0);
      for (let i = 0; i < a.length; i++) {
        let v;
        if (i < 6) v = L * (0.55 + kick * 0.9);
        else if (i < 26) v = L * (0.4 + kick * 0.5);
        else if (i < 200) v = L * (0.25 + 0.3 * Math.abs(Math.sin(i * 0.05 + t)));
        else if (i < 380) v = L * 0.2;
        else v = L * 0.04;
        a[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    },
  };
}

async function lasersSuite() {
  const Lasers = window.__Lasers;
  if (!Lasers) throw new Error("pre-load: window.__Lasers = (await import('/src/lasers.js')).Lasers");
  const cv = document.createElement("canvas");
  cv.width = 1920; cv.height = 480;
  const ctx = cv.getContext("2d");
  const results = {};

  const mk = () => {
    const inst = new Lasers();
    const state = { t: 0, spec: { silence: 1 } };
    return { inst, state, an: laserAnalyser(state), now: 1000 };
  };
  const run = (r, secs) => {
    for (let i = 0; i < Math.round(secs * 60); i++) {
      r.state.t += 1 / 60; r.now += 1000 / 60;
      r.inst.render(ctx, r.an, 1920, 480, r.now);
    }
  };

  // --- 1. SAFETY: the 3Hz full-field cap survives 190bpm metal + pulse spam
  const r1 = mk();
  r1.state.spec = { level: 0.9, bpm: 190, hard: 1.0 };
  run(r1, 4);
  const fires0 = r1.inst.pulseFires;
  const SECS = 20;
  for (let i = 0; i < SECS * 60; i++) {
    r1.state.t += 1 / 60; r1.now += 1000 / 60;
    // adversarial: on top of the metal, something requests a flash EVERY FRAME
    r1.inst.firePulse(r1.now, 1);
    r1.inst.render(ctx, r1.an, 1920, 480, r1.now);
  }
  const rate = (r1.inst.pulseFires - fires0) / SECS;
  results.safety = {
    pass: rate <= 3.05,
    flashesPerSecond: +rate.toFixed(2),
    denied: r1.inst.pulseDenied,
    note: "60 requests/s + 190bpm metal -> the engine lets through <= 3/s. Non-negotiable.",
  };

  // --- 2. the LJ advances cues on beats
  const r2 = mk();
  r2.state.spec = { level: 0.8, bpm: 120, hard: 0.8 };
  run(r2, 4);
  const c0 = r2.inst.cueSteps;
  run(r2, 10);
  const cuesPerMin = ((r2.inst.cueSteps - c0) / 10) * 60;
  results.cues = {
    pass: Math.abs(cuesPerMin - 120) < 25,
    cuesPerMin: +cuesPerMin.toFixed(0),
    note: "one cue step per kick at 120bpm",
  };

  // --- 3. patterns change: phrase length + section slams both move the show
  const r3 = mk();
  r3.state.spec = { level: 0.75, bpm: 128, hard: 0.9 };
  const p0 = r3.inst.patternChanges;
  run(r3, 40); // 128bpm / 24-beat phrases -> ~3-4 phrase changes + any sections
  results.phrasing = {
    pass: r3.inst.patternChanges - p0 >= 3,
    patternChanges: r3.inst.patternChanges - p0,
    note: "the show moves through its vocabulary — no pattern outstays a phrase",
  };

  // --- 4. silence rests the rig; a new song hard-cuts to a fresh pattern
  const r4 = mk();
  r4.state.spec = { level: 0.8, bpm: 120, hard: 0.8 };
  run(r4, 6);
  r4.state.spec = { silence: 1 };
  run(r4, 12);
  const restingOk = r4.inst.resting && r4.inst.gate.gate < 0.15;
  const pBefore = r4.inst.patternChanges;
  r4.state.spec = { level: 0.85, bpm: 132, hard: 0.9 };
  run(r4, 3);
  results.restWake = {
    pass: restingOk && r4.inst.patternChanges > pBefore && !r4.inst.resting,
    restedInSilence: restingOk,
    hardCutOnNewSong: r4.inst.patternChanges > pBefore,
  };

  // --- 5. legibility on a COMPRESSED master (the Murmuration lesson):
  // cues keep firing and energy still spans the rig's dim<->bright range
  const r5 = mk();
  r5.state.spec = { level: 0.72, wobble: 0.1, bpm: 120, hard: 0.7 };
  run(r5, 26); // the stretcher earns the song's range over ~20s (its time constant)
  const c5 = r5.inst.cueSteps;
  // measure over 20s — a FULL cycle of the test music's 18s level wobble. A
  // 12s window sampled only the crest half of the cycle and read the visE
  // range as 0.15 while the full swing was ~0.4: the window must be at least
  // as long as the dynamics it claims to measure.
  let visLo = 1, visHi = 0;
  for (let i = 0; i < 20 * 60; i++) {
    r5.state.t += 1 / 60; r5.now += 1000 / 60;
    r5.inst.render(ctx, r5.an, 1920, 480, r5.now);
    visLo = Math.min(visLo, r5.inst.visE); visHi = Math.max(visHi, r5.inst.visE);
  }
  results.legibility = {
    pass: r5.inst.cueSteps - c5 > 25 && visHi - visLo > 0.3,
    cueStepsIn20s: r5.inst.cueSteps - c5,
    visERange: +(visHi - visLo).toFixed(2),
  };

  // --- 6. perf at panel size, worst pattern (fan, high energy)
  const r6 = mk();
  r6.state.spec = { level: 0.9, bpm: 128, hard: 0.9 };
  run(r6, 3);
  const t0 = performance.now();
  run(r6, 4);
  results.perf = { msPerFrame: +((performance.now() - t0) / 240).toFixed(3), at: "1920x480" };

  console.log(results);
  return results;
}
window.lasersSuite = lasersSuite;
