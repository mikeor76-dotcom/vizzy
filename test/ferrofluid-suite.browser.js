// Ferrofluid analysis bench — how alive is the blob across the musical range?
//
//   window.__Ferro = (await import('/src/ferrofluid.js')).Ferrofluid;
//   const src = await (await fetch('/test/ferrofluid-suite.browser.js')).text();
//   eval(src); await ferroSuite();
//
// (No import in this file: Vite's transform of fetched JS breaks eval.)
//
// Per synthetic song it reports:
//   motion       mean per-frame |Δspike| across slots (temporal aliveness)
//   shape        mean std-dev ACROSS slots (does the silhouette differentiate,
//                or does the whole blob breathe as one lump?)
//   spikeAvg/Max how far spikes extend (visibility)
//   rupturesPerMin  the "wow" events
//   basePulse    std of the body-radius modulation (does the mass thump?)

const SONGS = {
  // level 0..1, kick hardness, hat/treble energy, melodic mid movement
  // silence = a real quiet ROOM: a small noise floor with random per-frame
  // jitter (mic hiss/HVAC) — the exact condition that made the blob pulse
  silence:  { level: 0.0,  bpm: 0,   hard: 0.0,  hat: 0.0,  melody: 0.0, noise: 1 },
  ambient:  { level: 0.14, bpm: 52,  hard: 0.0,  hat: 0.05, melody: 0.30 },
  ballad:   { level: 0.25, bpm: 68,  hard: 0.25, hat: 0.15, melody: 0.60 },
  acoustic: { level: 0.45, bpm: 95,  hard: 0.45, hat: 0.35, melody: 0.70 },
  rock:     { level: 0.75, bpm: 120, hard: 0.75, hat: 0.60, melody: 0.65 },
  edm:      { level: 0.90, bpm: 128, hard: 1.0,  hat: 0.80, melody: 0.50 },
  metal:    { level: 0.95, bpm: 170, hard: 1.0,  hat: 0.70, melody: 0.55 },
  dynamic:  { level: 0.80, bpm: 100, hard: 0.7,  hat: 0.50, melody: 0.60, dyn: 1 },
};

function ferroAnalyser(state) {
  return {
    getByteFrequencyData(a) {
      const s = SONGS[state.song];
      const t = state.t;
      if (s.noise) {
        // realistic quiet-room mic floor: bins ~2-5/255, jittering per frame
        for (let i = 0; i < a.length; i++) a[i] = Math.max(0, Math.round(2 + Math.random() * 3 - (i / a.length) * 1.5));
        return;
      }
      const beatPhase = (t * s.bpm / 60) % 1;
      const kick = Math.exp(-beatPhase * (5 + s.hard * 20)) * s.hard;
      const hatPhase = (t * s.bpm / 30) % 1; // offbeat hats
      const hat = Math.exp(-hatPhase * 26) * s.hat;
      const passage = s.dyn ? (Math.floor(t / 8) % 2 === 0 ? 0.2 : 1.0) : 1.0;
      const L = s.level * passage * 255;
      for (let i = 0; i < a.length; i++) {
        let v = 0;
        if (i < 6) v = L * (0.55 + kick * 0.9); // sub/kick
        else if (i < 26) v = L * (0.4 + kick * 0.5);
        else if (i < 200) {
          // melody: two band-limited humps sweeping slowly over the mids
          const c1 = 60 + Math.sin(t * 0.9) * 30, c2 = 130 + Math.sin(t * 0.6 + 2) * 40;
          const m = Math.exp(-((i - c1) ** 2) / 300) + 0.8 * Math.exp(-((i - c2) ** 2) / 500);
          v = L * (0.12 + s.melody * 0.55 * m);
        } else if (i < 380) v = L * (0.06 + hat * 0.8 * Math.exp(-(i - 200) / 120));
        else v = L * 0.02;
        a[i] = Math.max(0, Math.min(255, Math.round(v)));
      }
    },
  };
}

async function ferroSuite({ seconds = 25 } = {}) {
  const Ferrofluid = window.__Ferro;
  if (!Ferrofluid) throw new Error("pre-load: window.__Ferro = (await import('/src/ferrofluid.js')).Ferrofluid");
  const cv = document.createElement("canvas");
  cv.width = 960; cv.height = 240;
  const ctx = cv.getContext("2d");

  const results = {};
  for (const song of Object.keys(SONGS)) {
    const inst = new Ferrofluid();
    inst.cfg.sensitivity = 1.25;
    const state = { t: 0, song };
    const an = ferroAnalyser(state);
    let now = 1000;
    const dt = 1000 / 60;
    let prev = null;
    let motion = 0, shape = 0, spikeSum = 0, spikeMax = 0, frames = 0, ruptures = 0, lastRup = 0;
    let beats = 0, lastBeat = 0;
    const bases = [], bassSpike = [], kickEnv = [];
    // slots reading the LOWEST band (the bass lobes) for the coherence metric
    const bassSlots = [];
    for (let k = 0; k < inst.slotBand.length; k++) if (inst.slotBand[k] === 0) bassSlots.push(k);
    for (let i = 0; i < seconds * 60; i++) {
      state.t += dt / 1000; now += dt;
      inst.render(ctx, an, 960, 240, now);
      if (i < 240) { prev = [...inst.spikes]; lastRup = inst.rupture; lastBeat = inst.beat; continue; } // settle 4s
      const sp = inst.spikes;
      let m = 0, mean = 0;
      for (let k = 0; k < sp.length; k++) { m += Math.abs(sp[k] - prev[k]); mean += sp[k]; }
      m /= sp.length; mean /= sp.length;
      let sd = 0;
      for (let k = 0; k < sp.length; k++) sd += (sp[k] - mean) ** 2;
      sd = Math.sqrt(sd / sp.length);
      motion += m; shape += sd; spikeSum += mean;
      spikeMax = Math.max(spikeMax, ...sp);
      if (inst.rupture > 0.85 && lastRup <= 0.85) ruptures++;
      if (inst.beat > 0.9 && lastBeat <= 0.9) beats++;
      lastRup = inst.rupture; lastBeat = inst.beat;
      bases.push(inst.bass?.value ?? 0);
      // kick coherence: do the bass lobes move WITH the kick?
      let bs = 0;
      for (const k of bassSlots) bs += sp[k];
      bassSpike.push(bs / Math.max(1, bassSlots.length));
      const s = SONGS[song];
      kickEnv.push(s.bpm ? Math.exp(-((state.t * s.bpm / 60) % 1) * (5 + s.hard * 20)) * s.hard : 0);
      prev = [...sp];
      frames++;
    }
    const avg = (a) => a.reduce((x, v) => x + v, 0) / Math.max(1, a.length);
    const corr = (a, b) => {
      const ma = avg(a), mb = avg(b);
      let num = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
      return da && db ? num / Math.sqrt(da * db) : 0;
    };
    const bAvg = avg(bases);
    const bStd = Math.sqrt(avg(bases.map((v) => (v - bAvg) ** 2)));
    results[song] = {
      motion: +((motion / frames) * 1000).toFixed(1), // x1000 for readability
      shape: +((shape / frames) * 100).toFixed(1),
      spikeAvg: +(spikeSum / frames).toFixed(2),
      spikeMax: +spikeMax.toFixed(2),
      beatsPerMin: +((beats / (frames / 60)) * 60).toFixed(0),
      rupturesPerMin: +((ruptures / (frames / 60)) * 60).toFixed(1),
      basePulse: +(bStd * 100).toFixed(1),
      kickCorr: SONGS[song].hard > 0 ? +corr(bassSpike, kickEnv).toFixed(2) : "-",
    };
  }
  console.table(results);
  return results;
}
window.ferroSuite = ferroSuite;
