// Pixel Quest GENRE SUITE — the regression gate for PIXELQUEST-ENGAGEMENT-PLAN.md.
//
// Usage: open http://localhost:5173/?mode=pixelquest, paste this whole file into
// the devtools console (or eval via automation), then:
//   await genreSuite()          // all five genres, ~30s, prints a table
//   await genreSuite(["ballad"]) // subset
//
// Each genre is a synthetic analyser driving the REAL pipeline (analyze -> mood
// -> resonance -> render) for 60 simulated seconds. Compare the printed table
// against the acceptance table in the plan.
async function genreSuite(only) {
  const pq = window.pqAdventure && window.pqAdventure.pq;
  if (!pq) throw new Error("Pixel Quest not running (need ?mode=pixelquest)");
  window.requestAnimationFrame = () => 0; // freeze the app loop; we drive frames
  document.getElementById("splash")?.remove();
  const op = window.pixelQuestOpening;
  if (op) { op.setEnabled(false); op.state = "finished"; }
  const cv = document.getElementById("canvas"), ctx = cv.getContext("2d");
  const W = window.innerWidth, H = window.innerHeight;
  let now = performance.now();

  const run = (fake, frames) => {
    const seen = new WeakSet(), noteSeen = new WeakSet(), evCount = {}, moods = {}, secs = {};
    let gateOpen = 0, lock = 0, kicks = 0, snares = 0, mel = 0, prevK = 0, prevS = 0;
    let notes = 0, spSum = 0, spMax = 0, chgMax = 0;
    for (let i = 0; i < frames; i++) {
      pq.render(ctx, fake, W, H, now); now += 16.67;
      if ((pq.gate || 0) > 0.5) gateOpen++;
      if (pq.tempoStable && pq.tempoConf > 0.5) lock++;
      if (pq.kickPulse > prevK) kicks++; prevK = pq.kickPulse;
      if (pq.snarePulse > prevS) snares++; prevS = pq.snarePulse;
      if (pq.melodyHit) mel++;
      chgMax = Math.max(chgMax, pq.adventure.orb.charge || 0);
      for (const p of pq.resonance.stream.parts)
        if (p.type === "note" && !noteSeen.has(p)) { noteSeen.add(p); notes++; }
      if (i % 30 === 0) {
        moods[pq.adventure.mood.state] = (moods[pq.adventure.mood.state] || 0) + 1;
        secs[pq.resonance.section.state] = (secs[pq.resonance.section.state] || 0) + 1;
      }
      for (const st of pq.events.active)
        if (!seen.has(st)) { seen.add(st); evCount[st.def.id] = (evCount[st.def.id] || 0) + 1; }
      spSum += pq.lastSpeed || 0; spMax = Math.max(spMax, pq.lastSpeed || 0);
    }
    const min = frames / 3600;
    return {
      gatePct: Math.round((gateOpen / frames) * 100), lockPct: Math.round((lock / frames) * 100),
      endBPM: Math.round(pq.bps * 60), kicksPerMin: Math.round(kicks / min),
      snaresPerMin: Math.round(snares / min), melodyPerMin: Math.round(mel / min),
      notesSpawned: notes, orbChargeMax: +chgMax.toFixed(2),
      speedAvg: Math.round(spSum / frames), speedMax: Math.round(spMax),
      moods, sections: secs, events: Object.keys(evCount).length,
    };
  };

  const silence = { fftSize: 2048, frequencyBinCount: 1024,
    getByteFrequencyData(a) { a.fill(0); }, getByteTimeDomainData(a) { a.fill(128); } };

  const prng = (n) => { let s = n >>> 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // ---- the five genres (60s each; all frame-counters are per-genre) --------
  const GENRES = {
    // four-on-floor 128 BPM with real structure: intro/build/DROP/breakdown/final
    edm() { let f = 0; return { fftSize: 2048, frequencyBinCount: 1024,
      getByteFrequencyData(a) { f++; const t = f / 60;
        const sec = t < 15 ? "intro" : t < 25 ? "build" : t < 45 ? "drop" : t < 52 ? "break" : "final";
        const kickOn = (sec === "drop" || sec === "final" || sec === "intro") && f % 28 < 3;
        const buildP = sec === "build" ? (t - 15) / 10 : 0;
        const roll = sec === "build" && f % Math.max(4, Math.round(14 - buildP * 10)) < 2;
        const arp = (sec === "drop" || sec === "final") && f % 14 < 9;
        const pad = sec === "break" || sec === "build";
        for (let i = 0; i < a.length; i++) { let v = 6;
          if (i < 12) v = kickOn ? 225 : sec === "drop" ? 70 : 20;
          else if (i < 92) v = arp && Math.abs(i - (30 + (((f / 56) | 0) % 3) * 18)) < 6 ? 210 : pad ? 95 : 25;
          else if (i < 372) v = (sec === "drop" ? 110 : 35) + (roll ? 120 : 0) + buildP * 90;
          a[i] = Math.max(0, Math.min(255, v)); } },
      getByteTimeDomainData(a) { const t = f / 60;
        const sec = t < 15 ? "intro" : t < 25 ? "build" : t < 45 ? "drop" : t < 52 ? "break" : "final";
        const kickOn = (sec === "drop" || sec === "final" || sec === "intro") && f % 28 < 3;
        const amp = (kickOn ? 95 : 38) * (sec === "break" ? 0.5 : 1);
        for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round(amp * Math.sin(i * 0.25 + f * 0.5)); } }; },
    // 70 BPM soft: brushed kick, slow piano phrases, gentle lift 25-45s
    ballad() { let f = 0; return { fftSize: 2048, frequencyBinCount: 1024,
      getByteFrequencyData(a) { f++; const t = f / 60; const lift = t > 25 && t < 45 ? 1.25 : 1;
        const kickOn = f % 51 < 3; const phrase = f % 130; const tone = phrase < 80 && phrase % 26 < 18;
        const c = 26 + 14 * Math.sin(f * 0.011);
        for (let i = 0; i < a.length; i++) { let v = 4;
          if (i < 12) v = kickOn ? 70 * lift : 12;
          else if (i < 92) v = tone && Math.abs(i - c) < 5 ? 120 * lift : 45 * lift;
          else if (i < 372) v = 22 * lift;
          a[i] = Math.max(0, Math.min(255, v)); } },
      getByteTimeDomainData(a) { const t = f / 60; const lift = t > 25 && t < 45 ? 1.25 : 1;
        const amp = (f % 51 < 3 ? 34 : 20) * lift;
        for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round(amp * Math.sin(i * 0.25 + f * 0.5)); } }; },
    // 120 BPM kick + backbeat snare, wall-of-guitar mids, cymbal wash
    rock() { let f = 0; return { fftSize: 2048, frequencyBinCount: 1024,
      getByteFrequencyData(a) { f++; const snareOn = f % 60 >= 30 && f % 60 < 33; const chug = f % 15 < 10;
        for (let i = 0; i < a.length; i++) { let v = 8;
          if (i < 12) v = f % 30 < 3 ? 200 : 60;
          else if (i < 92) v = chug ? 150 + ((i * 7) % 40) : 90;
          else if (i < 372) v = snareOn ? 200 : 95;
          a[i] = Math.max(0, Math.min(255, v)); } },
      getByteTimeDomainData(a) { const hit = f % 30 < 3;
        for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round((hit ? 90 : 45) * Math.sin(i * 0.25 + f * 0.5)); } }; },
    // 88 BPM heavy sparse kick, backbeat snare, vocal phrase bursts, 8th hats
    hiphop() { let f = 0; return { fftSize: 2048, frequencyBinCount: 1024,
      getByteFrequencyData(a) { f++; const bar = f % 164;
        const kickOn = bar < 4 || (bar >= 61 && bar < 65); const snareOn = bar >= 82 && bar < 85;
        const hat = f % 20 < 2; const vs = Math.floor(f / 45);
        const vocalOn = prng(vs) < 0.55 && f % 45 < 28; const vc = 30 + Math.round(prng(vs * 7) * 30);
        for (let i = 0; i < a.length; i++) { let v = 6;
          if (i < 12) v = kickOn ? 235 : 28;
          else if (i < 92) v = vocalOn && Math.abs(i - vc) < 8 ? 170 : 30;
          else if (i < 372) v = (hat ? 150 : 30) + (snareOn ? 140 : 0);
          a[i] = Math.max(0, Math.min(255, v)); } },
      getByteTimeDomainData(a) { const bar = f % 164;
        const hit = bar < 4 || (bar >= 61 && bar < 65) || (bar >= 82 && bar < 85);
        for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round((hit ? 95 : 30) * Math.sin(i * 0.25 + f * 0.5)); } }; },
    // no drums: 60s pp->ff (timpani climax ~40s)->pp, legato beds + lead line
    orchestral() { let f = 0; return { fftSize: 2048, frequencyBinCount: 1024,
      getByteFrequencyData(a) { f++; const t = f / 60;
        const dyn = t < 40 ? 0.25 + 0.75 * (t / 40) : Math.max(0.2, 1 - ((t - 40) / 20) * 0.8);
        const noteLen = 55 + Math.round(20 * Math.sin(f * 0.003)); const phrase = f % (noteLen + 14);
        const toneOn = phrase < noteLen;
        const c = 34 + 22 * Math.sin(f * 0.006) + 8 * Math.sin(f * 0.017);
        const timpani = t > 38 && t < 42 && f % 50 < 4;
        for (let i = 0; i < a.length; i++) { let v = 4;
          if (i < 12) v = timpani ? 190 : 18 * dyn;
          else if (i < 92) v = toneOn && Math.abs(i - c) < 6 ? 190 * dyn : 70 * dyn;
          else if (i < 372) v = 40 * dyn;
          a[i] = Math.max(0, Math.min(255, v)); } },
      getByteTimeDomainData(a) { const t = f / 60;
        const dyn = t < 40 ? 0.25 + 0.75 * (t / 40) : Math.max(0.2, 1 - ((t - 40) / 20) * 0.8);
        for (let i = 0; i < a.length; i++)
          a[i] = 128 + Math.round(70 * dyn * Math.sin(i * 0.25 + f * 0.5) + 8 * dyn * Math.sin(i * 0.9 + f * 1.3)); } }; },
  };

  const names = only || Object.keys(GENRES);
  const results = {};
  for (const name of names) {
    run(silence, 400); // reset tempo/mood between genres
    results[name] = run(GENRES[name](), 3600);
    console.log(name, results[name]);
  }
  console.table(Object.fromEntries(Object.entries(results).map(([k, r]) => [k, {
    BPM: r.endBPM, lock: r.lockPct + "%", "kicks/m": r.kicksPerMin, "snares/m": r.snaresPerMin,
    "melody/m": r.melodyPerMin, notes: r.notesSpawned, spdAvg: r.speedAvg,
    topMood: Object.entries(r.moods).sort((a, b) => b[1] - a[1])[0]?.join(":"),
    topSection: Object.entries(r.sections).sort((a, b) => b[1] - a[1])[0]?.join(":"),
  }])));
  return results;
}
window.genreSuite = genreSuite;
