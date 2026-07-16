// City Skyline bench — is the city actually a meter, and does it sleep?
//
//   window.__Sky = (await import('/src/skyline.js')).Skyline;
//   const src = await (await fetch('/test/skyline-suite.browser.js')).text();
//   eval(src); await skySuite();
//
// (No import in this file: Vite's transform of fetched JS breaks eval.)
//
// Ground truth is inst.litF (lit floors per building), not pixels — the
// palette can't fool it. The tests:
//   mapping     a tone at band k lights EXACTLY the mirrored building pair
//               (27-k, 28+k), neighbours dark — downtown bass, suburb treble
//   monotonic   lit floors track level (a meter that saturates lies)
//   sleep       silence = only the night owls; zero meter windows, no traffic
//   beat+tempo  kicks fire the sky pulse; traffic speed follows the bpm
//   legibility  COMPRESSED real music still dances (the Murmuration lesson:
//               4x synthetic swings prove nothing about real masters)

function skyAnalyser(state) {
  return {
    getByteFrequencyData(a) {
      const s = state.spec;
      if (s.silence) {
        for (let i = 0; i < a.length; i++) a[i] = Math.max(0, Math.round(2 + Math.random() * 3 - (i / a.length) * 1.5));
        return;
      }
      if (s.tone != null) {
        a.fill(0);
        for (let d = -3; d <= 3; d++) {
          const i = s.tone + d;
          if (i >= 0 && i < a.length) a[i] = Math.round(255 * s.level * Math.exp(-(d * d) / 2));
        }
        return;
      }
      const t = state.t;
      const kick = Math.exp(-((t * s.bpm / 60) % 1) * 16) * (s.hard ?? 0.7);
      const L = s.level + (s.wobble ? Math.sin(t * 0.35) * s.wobble : 0);
      for (let i = 0; i < a.length; i++) {
        let v;
        if (i < 6) v = L * (0.5 + kick * 0.5);
        else if (i < 26) v = L * (0.4 + kick * 0.3);
        else if (i < 200) {
          const c1 = 60 + Math.sin(t * 0.9) * 30, c2 = 130 + Math.sin(t * 0.6 + 2) * 40;
          v = L * (0.12 + 0.5 * (Math.exp(-((i - c1) ** 2) / 300) + 0.8 * Math.exp(-((i - c2) ** 2) / 500)));
        } else if (i < 380) v = L * 0.2;
        else v = L * 0.04;
        a[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    },
  };
}

async function skySuite() {
  const Skyline = window.__Sky;
  if (!Skyline) throw new Error("pre-load: window.__Sky = (await import('/src/skyline.js')).Skyline");
  const cv = document.createElement("canvas");
  cv.width = 1920; cv.height = 480;
  const ctx = cv.getContext("2d");
  const results = {};
  const B = 28;

  const mk = () => {
    const inst = new Skyline();
    inst.cfg.sensitivity = 1.25;
    const state = { t: 0, spec: { silence: 1 } };
    return { inst, state, an: skyAnalyser(state), now: 1000 };
  };
  const run = (r, secs) => {
    for (let i = 0; i < Math.round(secs * 60); i++) {
      r.state.t += 1 / 60; r.now += 1000 / 60;
      r.inst.render(ctx, r.an, 1920, 480, r.now);
    }
  };

  // --- 1. mapping: tone at band k lights the mirrored pair, neighbours dark
  const probe = new Skyline();
  const mapRows = [];
  let mapPass = true;
  for (const k of [0, 6, 14, 24]) {
    const r = mk();
    r.state.spec = { tone: Math.round((probe.bandLo[k] + probe.bandHi[k]) / 2), level: 0.85 };
    run(r, 3);
    const litOf = (bi) => r.inst.litF[bi] / r.inst.buildings[bi].floors;
    const left = litOf(B - 1 - k), right = litOf(B + k);
    // brightest OTHER building (excluding the pair and its band-leak neighbours)
    let worst = 0;
    for (let i = 0; i < B * 2; i++) {
      const bk = r.inst.bandOf(i);
      if (Math.abs(bk - k) <= 1) continue;
      worst = Math.max(worst, litOf(i));
    }
    const ok = left > 0.25 && right > 0.25 && worst < Math.min(left, right) * 0.5;
    if (!ok) mapPass = false;
    mapRows.push({ band: k, left: +left.toFixed(2), right: +right.toFixed(2), worstOther: +worst.toFixed(2), ok });
  }
  results.mapping = { pass: mapPass, detail: mapRows };

  // --- 2. monotonic: lit floors track level
  const heights = [];
  for (const L of [0.25, 0.45, 0.7, 0.95]) {
    const r = mk();
    r.state.spec = { tone: Math.round((probe.bandLo[6] + probe.bandHi[6]) / 2), level: L };
    run(r, 3);
    heights.push(+(r.inst.litF[B - 1 - 6] / r.inst.buildings[B - 1 - 6].floors).toFixed(2));
  }
  let mono = true;
  for (let i = 1; i < heights.length; i++) if (heights[i] <= heights[i - 1]) mono = false;
  results.monotonic = { pass: mono, heights, dynRange: +(heights[3] / Math.max(0.01, heights[0])).toFixed(2) };

  // --- 3. the city SLEEPS: silence = night owls only, empty highway
  const r3 = mk();
  r3.state.spec = { level: 0.75, bpm: 120 };
  run(r3, 6); // wake it first
  r3.state.spec = { silence: 1 };
  run(r3, 12);
  let meterWin = 0;
  for (let i = 0; i < B * 2; i++) meterWin += r3.inst.litF[i];
  results.sleep = {
    pass: meterWin === 0 && r3.inst.cars.length <= 2,
    meterFloorsLit: meterWin, cars: r3.inst.cars.length,
    note: "zero meter floors; the only lights left are the night owls",
  };

  // --- 4. beats fire the sky pulse; tempo drives the traffic speed
  const beatCount = (bpm, secs = 10) => {
    const r = mk();
    r.state.spec = { level: 0.8, bpm, hard: 0.9 };
    run(r, 4);
    let beats = 0, last = r.inst.beat;
    for (let i = 0; i < secs * 60; i++) {
      run(r, 1 / 60);
      if (r.inst.beat > 0.9 && last <= 0.9) beats++;
      last = r.inst.beat;
    }
    return { perMin: (beats / secs) * 60, inst: r.inst };
  };
  const slow = beatCount(70), fast = beatCount(140);
  const bpmOf = (i2) => 60000 / i2.beatInt;
  results.beatTempo = {
    pass: Math.abs(slow.perMin - 70) < 14 && Math.abs(fast.perMin - 140) < 25 &&
      bpmOf(fast.inst) > bpmOf(slow.inst) * 1.5,
    beatsPerMin: { at70: +slow.perMin.toFixed(0), at140: +fast.perMin.toFixed(0) },
    trackedBpm: { at70: +bpmOf(slow.inst).toFixed(0), at140: +bpmOf(fast.inst).toFixed(0) },
    note: "sky pulses on the kicks; traffic knows the tempo",
  };

  // --- 5. legibility on COMPRESSED music (the Murmuration lesson): the lit
  // pattern must keep dancing when the master never leaves the top of its range
  const r5 = mk();
  r5.state.spec = { level: 0.72, wobble: 0.1, bpm: 120 };
  run(r5, 6);
  let motion = 0, frames = 0, pulses = 0, lastB2 = 0;
  const prev = new Int16Array(B * 2);
  prev.set(r5.inst.litF);
  for (let i = 0; i < 12 * 60; i++) {
    run(r5, 1 / 60);
    let d = 0;
    for (let j = 0; j < B * 2; j++) { d += Math.abs(r5.inst.litF[j] - prev[j]); prev[j] = r5.inst.litF[j]; }
    motion += d; frames++;
    if (r5.inst.beat > 0.9 && lastB2 <= 0.9) pulses++;
    lastB2 = r5.inst.beat;
  }
  results.legibility = {
    pass: motion / frames > 0.8 && pulses > 12,
    floorsChangedPerFrame: +(motion / frames).toFixed(2),
    skyPulses: pulses,
    note: "windows keep moving + sky keeps pulsing on a compressed master",
  };

  // --- 6. perf at panel size
  const r6 = mk();
  r6.state.spec = { level: 0.8, bpm: 128, hard: 0.9 };
  run(r6, 3);
  const t0 = performance.now();
  run(r6, 4);
  results.perf = { msPerFrame: +((performance.now() - t0) / 240).toFixed(3), at: "1920x480" };

  console.log(results);
  return results;
}
window.skySuite = skySuite;
