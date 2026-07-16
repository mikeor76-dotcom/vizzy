// Vector CRT bench — is the phosphor real, and does the beam behave?
//
//   window.__Vcrt = (await import('/src/vectorcrt.js')).VectorCrt;
//   const src = await (await fetch('/test/vectorcrt-suite.browser.js')).text();
//   eval(src); await vcrtSuite();
//
// (No import in this file: Vite's transform of fetched JS breaks eval.)
//
// Tests:
//   persistence  a stroke must leave a trail that decays over several frames
//                (measured off the feedback buffer: half-life in 2..14 frames
//                — shorter is no phosphor, longer is smear)
//   governance   quiet and loud songs both land in a sane drawn-amplitude
//                band (the wave.js excursion lesson, re-asserted here)
//   sections     accents rotate the figure; phrases rotate it eventually
//   standby      silence = a parked dot, not frozen geometry (lit area tiny)
//   perf         two full-canvas drawImages + strokes at 1920x480

function vcrtAnalyser(state) {
  const timeBuf = new Float32Array(2048);
  return {
    fftSize: 2048,
    getByteFrequencyData(a) {
      const s = state.spec;
      if (s.silence) {
        for (let i = 0; i < a.length; i++) a[i] = Math.max(0, Math.round(2 + Math.random() * 3 - (i / a.length) * 1.5));
        return;
      }
      const t = state.t;
      const kick = Math.exp(-((t * s.bpm / 60) % 1) * 16) * (s.hard ?? 0.8);
      const L = s.level;
      for (let i = 0; i < a.length; i++) {
        let v;
        if (i < 6) v = L * (0.5 + kick * 0.5);
        else if (i < 26) v = L * (0.4 + kick * 0.3);
        else if (i < 200) v = L * (0.3 + 0.2 * Math.sin(i * 0.05 + t));
        else if (i < 380) v = L * 0.2;
        else v = L * 0.04;
        a[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    },
    getFloatTimeDomainData(a) {
      const s = state.spec;
      if (s.silence) { a.fill(0); return; }
      const f0 = 110, amp = s.exc ?? 0.3;
      for (let i = 0; i < a.length; i++) {
        const p = (state.t + i / 48000) * f0 * TAU_;
        a[i] = amp * (Math.sin(p) * 0.7 + Math.sin(p * 2.3) * 0.3);
      }
    },
  };
}
const TAU_ = Math.PI * 2;

async function vcrtSuite() {
  const VectorCrt = window.__Vcrt;
  if (!VectorCrt) throw new Error("pre-load: window.__Vcrt = (await import('/src/vectorcrt.js')).VectorCrt");
  const cv = document.createElement("canvas");
  cv.width = 1920; cv.height = 480;
  const ctx = cv.getContext("2d");
  const results = {};

  const mk = () => {
    const inst = new VectorCrt();
    const state = { t: 0, spec: { silence: 1 } };
    return { inst, state, an: vcrtAnalyser(state), now: 1000 };
  };
  const run = (r, secs) => {
    for (let i = 0; i < Math.round(secs * 60); i++) {
      r.state.t += 1 / 60; r.now += 1000 / 60;
      r.inst.render(ctx, r.an, 1920, 480, r.now);
    }
  };
  // lit pixels in the CURRENT feedback buffer (colour, not alpha)
  const litArea = (inst) => {
    const c = inst.fbA.getContext("2d");
    const d = c.getImageData(0, 0, 1920, 480, { willReadFrequently: true }).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 16) { // sample every 4th px
      if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    }
    return lit / (d.length / 16);
  };

  // --- 1. persistence: brightness of a burned spot decays with a half-life
  const r1 = mk();
  r1.state.spec = { level: 0.7, bpm: 120, exc: 0.4 };
  run(r1, 6);
  // find the brightest pixel row through the centre, then cut the beam and
  // watch that pixel decay across frames
  const fb = () => r1.inst.fbA.getContext("2d").getImageData(0, 120, 1920, 1).data;
  let px = 0, best = 0;
  const row = fb();
  for (let x = 0; x < 1920; x++) {
    const v = row[x * 4] + row[x * 4 + 1] + row[x * 4 + 2];
    if (v > best) { best = v; px = x; }
  }
  r1.state.spec = { silence: 1 };
  const decay = [best];
  for (let f = 0; f < 30; f++) {
    run(r1, 1 / 60);
    const d2 = fb();
    decay.push(d2[px * 4] + d2[px * 4 + 1] + d2[px * 4 + 2]);
  }
  let half = decay.findIndex((v) => v < best / 2);
  if (half < 0) half = 99;
  results.persistence = {
    pass: half >= 2 && half <= 14,
    halfLifeFrames: half, peak: best,
    note: "phosphor: 2..14 frame half-life (shorter = no trail, longer = smear)",
  };

  // --- 2. excursion governance: drawn amplitude sane for quiet AND loud
  const govern = (exc) => {
    const r = mk();
    r.state.spec = { level: 0.6, bpm: 100, exc };
    run(r, 8);
    // ring content: measure drawn radius modulation via amp()
    let hi = 0;
    for (let i = 0; i < 160; i++) hi = Math.max(hi, Math.abs(r.inst.amp(r.inst.sample(i, 160))));
    return { peakAmp: hi, gain: r.inst.gain };
  };
  const q = govern(0.06), l = govern(0.7);
  results.governance = {
    pass: q.peakAmp > 0.35 && q.peakAmp <= 1 && l.peakAmp > 0.35 && l.peakAmp <= 1 && l.gain < q.gain,
    quiet: { peakAmp: +q.peakAmp.toFixed(2), gain: +q.gain.toFixed(1) },
    loud: { peakAmp: +l.peakAmp.toFixed(2), gain: +l.gain.toFixed(1) },
    note: "a whisper and a wall of sound both draw 35-100% figures",
  };

  // --- 3. sections + phrases rotate the figure
  const r3 = mk();
  r3.state.spec = { level: 0.75, bpm: 128, hard: 0.9 };
  const i0 = r3.inst.contentIdx;
  run(r3, 40);
  const changes = (r3.inst.contentIdx - i0 + 16) % 4; // at least phrase turnover
  results.sections = {
    pass: r3.inst.beatsInContent < 40 && (changes > 0 || r3.inst.contentIdx !== i0),
    contentIdx: r3.inst.contentIdx,
    note: "the figure rotates by phrase/accent like MilkDrop's director",
  };

  // --- 4. standby: silence parks the beam as a dot (tiny lit area)
  const r4 = mk();
  r4.state.spec = { level: 0.7, bpm: 120 };
  run(r4, 5);
  r4.state.spec = { silence: 1 };
  run(r4, 8);
  const area = litArea(r4.inst);
  results.standby = {
    pass: r4.inst.resting === true && area < 0.004,
    litFraction: +area.toFixed(5),
    note: "a drifting dot + ghost, not frozen geometry",
  };

  // --- 5. perf
  const r5 = mk();
  r5.state.spec = { level: 0.8, bpm: 128, hard: 0.9 };
  run(r5, 3);
  const t0 = performance.now();
  run(r5, 4);
  results.perf = { msPerFrame: +((performance.now() - t0) / 240).toFixed(3), at: "1920x480" };

  console.log(results);
  return results;
}
window.vcrtSuite = vcrtSuite;
