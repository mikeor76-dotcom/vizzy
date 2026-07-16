// City Skyline bench — is the WHOLE city a meter, on EVERY kind of music?
//
//   window.__Sky = (await import('/src/skyline.js')).Skyline;
//   const src = await (await fetch('/test/skyline-suite.browser.js')).text();
//   eval(src); await skySuite();
//
// (No import in this file: Vite's transform of fetched JS breaks eval.)
//
// Ground truth is inst.litF (lit floors per building), not pixels. The tests
// exist because of a user report — "it moves with the music but not
// correctly" — and the measurement that explained it: with one global
// sensitivity the suburbs sat at 0-3% lit on every genre and downtown never
// passed 36%. So the headline test is the GENRE SWEEP: every district must
// participate on every kind of music, silence must sleep the whole city, and
// downtown must pump WITH the kick (correlation, not vibes).

const SKY_SONGS = {
  silence: { silence: 1 },
  ambient: { level: 0.14, bpm: 52, hard: 0, hat: 0.05, melody: 0.3 },
  ballad: { level: 0.25, bpm: 68, hard: 0.25, hat: 0.15, melody: 0.6 },
  rock: { level: 0.75, bpm: 120, hard: 0.75, hat: 0.6, melody: 0.65 },
  edm: { level: 0.9, bpm: 128, hard: 1, hat: 0.8, melody: 0.5 },
  metal: { level: 0.95, bpm: 170, hard: 1, hat: 0.7, melody: 0.55 },
};

function skyAnalyser(state) {
  return {
    getByteFrequencyData(a) {
      const s = state.spec;
      if (s.silence) {
        for (let i = 0; i < a.length; i++) a[i] = Math.max(0, Math.round(2 + Math.random() * 3 - (i / a.length) * 1.5));
        return;
      }
      const t = state.t;
      if (s.tone != null) {
        // a tone riding on a faint mid bed (a naked sine has no mid/high
        // content at all and the silence gate rightly refuses to call it
        // music — real narrowband content always sits on SOMETHING)
        for (let i = 0; i < a.length; i++) a[i] = i > 10 && i < 372 ? 12 : 0;
        for (let d = -3; d <= 3; d++) {
          const i = s.tone + d;
          if (i >= 0 && i < a.length) a[i] = Math.max(a[i], Math.round(255 * s.level * Math.exp(-(d * d) / 2)));
        }
        return;
      }
      const beatPhase = (t * s.bpm / 60) % 1;
      const kick = Math.exp(-beatPhase * (5 + s.hard * 20)) * s.hard;
      const hat = Math.exp(-((t * s.bpm / 30) % 1) * 26) * s.hat;
      const L = (s.level + (s.wobble ? Math.sin(t * 0.35) * s.wobble : 0)) * 255;
      for (let i = 0; i < a.length; i++) {
        let v;
        if (i < 6) v = L * (0.55 + kick * 0.9);
        else if (i < 26) v = L * (0.4 + kick * 0.5);
        else if (i < 200) {
          const c1 = 60 + Math.sin(t * 0.9) * 30, c2 = 130 + Math.sin(t * 0.6 + 2) * 40;
          v = L * (0.12 + s.melody * 0.55 * (Math.exp(-((i - c1) ** 2) / 300) + 0.8 * Math.exp(-((i - c2) ** 2) / 500)));
        } else if (i < 380) v = L * (0.06 + hat * 0.8 * Math.exp(-(i - 200) / 120));
        else v = L * 0.02;
        a[i] = Math.max(0, Math.min(255, Math.round(v)));
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
    const state = { t: 0, spec: { silence: 1 } };
    return { inst, state, an: skyAnalyser(state), now: 1000 };
  };
  const run = (r, secs) => {
    for (let i = 0; i < Math.round(secs * 60); i++) {
      r.state.t += 1 / 60; r.now += 1000 / 60;
      r.inst.render(ctx, r.an, 1920, 480, r.now);
    }
  };
  const districtOf = (inst, j) => {
    const band = inst.bandOf(j);
    return band < 4 ? "downtown" : band < 18 ? "mid" : "suburbs";
  };

  // --- 1. THE GENRE SWEEP: every district alive on every genre; silence sleeps
  const genreRows = [];
  let genrePass = true;
  for (const [name, spec] of Object.entries(SKY_SONGS)) {
    const r = mk();
    r.state.spec = spec;
    run(r, 6); // settle + learn the song
    const stats = { downtown: [0, 0, 8], mid: [0, 0, 28], suburbs: [0, 0, 20] };
    const prev = new Float32Array(56);
    let frames = 0;
    for (let i = 0; i < 8 * 60; i++) {
      run(r, 1 / 60);
      for (let j = 0; j < 56; j++) {
        const frac = r.inst.litF[j] / r.inst.buildings[j].floors;
        const d = stats[districtOf(r.inst, j)];
        d[0] += frac;
        d[1] += Math.abs(frac - prev[j]);
        prev[j] = frac;
      }
      frames++;
    }
    const row = { genre: name };
    for (const d of ["downtown", "mid", "suburbs"]) {
      row[d] = {
        lit: +(stats[d][0] / frames / stats[d][2]).toFixed(2),
        motion: +((stats[d][1] / frames / stats[d][2]) * 100).toFixed(1),
      };
    }
    if (spec.silence) {
      row.ok = row.downtown.lit === 0 && row.mid.lit === 0 && row.suburbs.lit === 0;
    } else {
      // Alive = meaningfully lit AND moving, not saturated. The suburbs are
      // only held to it when the genre actually HAS treble (hat >= 0.1):
      // ambient pads have nothing up there, and a normalizer that lit the
      // suburbs anyway would be amplifying the noise floor — the exact
      // failure the maxPeak*0.1 bound exists to prevent. Dark suburbs on a
      // pad is honesty.
      // "alive" for sustained content = lit; for TRANSIENT content (a
      // ballad's hats are brief glints) the average lit fraction is honestly
      // low — MOTION is the aliveness signal there. lit>=0.03 guards against
      // a district that's technically twitching but visibly black.
      const must = ["downtown", "mid"];
      if ((spec.hat ?? 0) >= 0.1) must.push("suburbs");
      row.ok = must.every((d) => row[d].lit >= 0.03 && row[d].lit <= 0.9 && row[d].motion >= 0.3);
    }
    if (!row.ok) genrePass = false;
    genreRows.push(row);
  }
  results.genres = { pass: genrePass, detail: genreRows };

  // --- 2. kick coherence: downtown pumps WITH the kick (correlation)
  const r2 = mk();
  r2.state.spec = SKY_SONGS.rock;
  run(r2, 6);
  const dt2 = [], kickEnv = [];
  for (let i = 0; i < 10 * 60; i++) {
    run(r2, 1 / 60);
    let s = 0, n = 0;
    for (let j = 0; j < 56; j++) {
      if (districtOf(r2.inst, j) === "downtown") { s += r2.inst.litF[j] / r2.inst.buildings[j].floors; n++; }
    }
    dt2.push(s / n);
    const bp = (r2.state.t * 120 / 60) % 1;
    kickEnv.push(Math.exp(-bp * (5 + 0.75 * 20)) * 0.75);
  }
  const avg = (a) => a.reduce((x, v) => x + v, 0) / a.length;
  const corr = (a, b) => {
    const ma = avg(a), mb = avg(b);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : 0;
  };
  results.kickPump = {
    pass: corr(dt2, kickEnv) > 0.3,
    downtownKickCorr: +corr(dt2, kickEnv).toFixed(2),
    note: "downtown's lights rise and fall WITH the kick, not near it",
  };

  // --- 3. mapping: a tone still lights exactly its mirrored pair
  const probe = new Skyline();
  const mapRows = [];
  let mapPass = true;
  for (const k of [2, 6, 14, 24]) {
    const r = mk();
    r.state.spec = { tone: Math.round((probe.bandLo[k] + probe.bandHi[k]) / 2), level: 0.85 };
    run(r, 4);
    const litOf = (bi) => r.inst.litF[bi] / r.inst.buildings[bi].floors;
    const left = litOf(B - 1 - k), right = litOf(B + k);
    let worst = 0;
    for (let i = 0; i < B * 2; i++) {
      if (Math.abs(r.inst.bandOf(i) - k) <= 1) continue;
      worst = Math.max(worst, litOf(i));
    }
    const ok = left > 0.3 && right > 0.3 && worst < Math.min(left, right) * 0.55;
    if (!ok) mapPass = false;
    mapRows.push({ band: k, left: +left.toFixed(2), right: +right.toFixed(2), worstOther: +worst.toFixed(2), ok });
  }
  results.mapping = { pass: mapPass, detail: mapRows };

  // --- 4. within-song dynamics: the chorus lights more city than the verse
  // (per-band normalization must NOT erase loud-vs-quiet inside a song)
  const r4 = mk();
  r4.state.spec = { ...SKY_SONGS.rock };
  run(r4, 12); // learn the song's peaks at full level
  const cityLit = (inst) => {
    let s = 0;
    for (let j = 0; j < 56; j++) s += inst.litF[j] / inst.buildings[j].floors;
    return s / 56;
  };
  let chorus = 0;
  for (let i = 0; i < 120; i++) { run(r4, 1 / 60); chorus += cityLit(r4.inst) / 120; }
  r4.state.spec = { ...SKY_SONGS.rock, level: 0.32, hard: 0.3 }; // the quiet verse
  run(r4, 4);
  let verse = 0;
  for (let i = 0; i < 120; i++) { run(r4, 1 / 60); verse += cityLit(r4.inst) / 120; }
  results.dynamics = {
    pass: chorus > verse * 1.25,
    chorusLit: +chorus.toFixed(2), verseLit: +verse.toFixed(2),
    ratio: +(chorus / Math.max(0.01, verse)).toFixed(2),
    note: "the quiet verse visibly dims the city; the chorus relights it",
  };

  // --- 5. sleep + beats + tempo (unchanged behaviours, re-asserted)
  const r5 = mk();
  r5.state.spec = SKY_SONGS.rock;
  run(r5, 6);
  r5.state.spec = { silence: 1 };
  run(r5, 12);
  let meterWin = 0;
  for (let i = 0; i < B * 2; i++) meterWin += r5.inst.litF[i];
  const beatCount = (bpm, secs = 10) => {
    const r = mk();
    r.state.spec = { ...SKY_SONGS.rock, bpm, hard: 0.9 };
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
  results.sleepBeatTempo = {
    pass: meterWin === 0 && r5.inst.cars.length <= 2 &&
      Math.abs(slow.perMin - 70) < 14 && Math.abs(fast.perMin - 140) < 25 &&
      bpmOf(fast.inst) > bpmOf(slow.inst) * 1.5,
    meterFloorsLitInSilence: meterWin, cars: r5.inst.cars.length,
    beatsPerMin: { at70: +slow.perMin.toFixed(0), at140: +fast.perMin.toFixed(0) },
    trackedBpm: { at70: +bpmOf(slow.inst).toFixed(0), at140: +bpmOf(fast.inst).toFixed(0) },
  };

  // --- 6. perf at panel size
  const r6 = mk();
  r6.state.spec = SKY_SONGS.edm;
  run(r6, 3);
  const t0 = performance.now();
  run(r6, 4);
  results.perf = { msPerFrame: +((performance.now() - t0) / 240).toFixed(3), at: "1920x480" };

  console.log(results);
  return results;
}
window.skySuite = skySuite;
