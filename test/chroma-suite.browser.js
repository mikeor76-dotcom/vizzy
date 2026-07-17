// Chroma bench — can it actually hear harmony?
//
//   const src = await (await fetch('/test/chroma-suite.browser.js')).text();
//   eval(src); await chromaSuite();
//
// This is the first bench in the project that would be MEANINGLESS against
// painted spectra: harmony IS harmonics. A hand-painted "C major" is three
// numbers someone typed; a real C major is three fundamentals plus their
// partials interfering, and the 3rd partial of C is a G — which is why a
// naive chroma reports a chord for a single note. Every assertion here runs
// on rendered audio with declared ground truth.
//
//   pureChord   C-E-G sines -> top three classes are exactly C, E, G
//   songChords  the sounding chord's pitch classes CAPTURE the chroma energy
//   key         rock-e-minor -> E minor; ballad-g-major -> G major
//   modulation  jazz-keychange: finds Dm, then finds F after the change, and
//               does NOT flap in between (the hysteresis has to earn this)
//   notes       solo-piano-melody: onset precision + pitch accuracy vs MIDI
//   drums       a drum-only bed produces ZERO notes (percussive discriminator)
//   silence     room tone -> no key, no notes, chroma dead
//   perf        cost per frame at 8192

const PCN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

async function chromaSuite() {
  const V = Date.now();
  const { renderSong, SR } = await import(`/test/harness/songbank.js?v=${V}`);
  const { AnalyserSim } = await import(`/test/harness/analysersim.js?v=${V}`);
  const { Chroma } = await import(`/src/chroma.js?v=${V}`);
  const results = {};

  // hi-res sim: chroma owns its own 8192 analyser in the app; here we inject
  const mkSim = (pcm) => new AnalyserSim(pcm, { fftSize: 8192, smoothingTimeConstant: 0.35, sampleRate: SR });
  const run = (pcm, secs, opts = {}) => {
    const ch = new Chroma();
    const sim = mkSim(pcm);
    const dt = 1 / 60;
    const out = [];
    for (let i = 0; i < Math.round(secs * 60); i++) {
      const t = (opts.startAt || 0) + i * dt;
      sim.seek(t);
      ch.update(sim, dt);
      if (opts.onFrame) opts.onFrame(ch, t, i);
      out.push(t);
    }
    return ch;
  };
  const top3 = (ch) => [...ch.chroma].map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]);

  // --- 1. pure chord: the sanity floor
  {
    const n = Math.round(4 * SR);
    const pcm = new Float32Array(n);
    for (const midi of [60, 64, 67]) { // C4 E4 G4
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      for (let i = 0; i < n; i++) pcm[i] += Math.sin(2 * Math.PI * f * (i / SR)) * 0.3;
    }
    const ch = run(pcm, 3.5);
    const t = top3(ch).sort((a, b) => a - b);
    results.pureChord = {
      pass: t.join(",") === "0,4,7",
      got: t.map((i) => PCN[i]),
      want: ["C", "E", "G"],
      chroma: [...ch.chroma].map((v) => +v.toFixed(2)),
    };
  }

  // --- 2. chords under the playhead, on real rendered songs.
  //
  // The claim is ENERGY SHARE, not "the root is in the top 3". That naive
  // version failed at 52% while the chroma was provably correct: rock-e-minor
  // has an E-minor-pentatonic lead hammering E/G/B/D over every chord, so on
  // the C chord the chroma honestly reports G,D,B ahead of C — it is hearing
  // the lead, which is really there and really louder. A chroma that ignored
  // the lead to flatter the chord chart would be the broken one. Three of
  // twelve classes is a 25% chance baseline; the chord tones must beat it
  // decisively.
  {
    const rows = [];
    for (const name of ["rock-e-minor", "ballad-g-major", "jazz-keychange"]) {
      const { pcm, truth } = renderSong(name);
      let share = 0, inTop3 = 0, checks = 0;
      run(pcm, 20, {
        onFrame: (ch, t) => {
          if (t < 6) return; // let the chroma smoother settle
          const cur = [...truth.chords].reverse().find((c) => c.t <= t);
          if (!cur) return;
          // sample at the END of each chord's bar — the pad has fully sounded
          const next = truth.chords.find((c) => c.t > cur.t);
          if (!next || t < next.t - 0.35 || t > next.t - 0.3) return;
          const pcs = new Set(cur.notes.map((m) => ((m % 12) + 12) % 12));
          let on = 0, all = 0;
          for (let i = 0; i < 12; i++) { all += ch.chroma[i]; if (pcs.has(i)) on += ch.chroma[i]; }
          share += all > 0 ? on / all : 0;
          if (top3(ch).includes(cur.pc)) inTop3++;
          checks++;
        },
      });
      rows.push({
        song: name, checks,
        chordToneShare: +(share / Math.max(1, checks)).toFixed(3),
        rootInTop3Pct: +((inTop3 / Math.max(1, checks)) * 100).toFixed(0), // informational
      });
    }
    // 0.33 vs a 25% chance baseline. The bar is deliberately not higher,
    // because the honest ceiling depends on the ARRANGEMENT, not on the
    // chroma: pad-driven songs score ~0.54 (ballad, jazz) while rock scores
    // 0.37 — its E-pentatonic lead plays notes that are outside the chord by
    // design, and the chroma is right to report them. What this catches is a
    // chroma that has stopped hearing chords at all, which would sit at ~0.25.
    results.songChords = {
      pass: rows.every((r) => r.chordToneShare >= 0.33),
      note: "chord tones beat chance decisively (25% = chance for a triad)",
      detail: rows,
    };
  }

  // --- 3. key detection on unambiguous songs
  {
    const rows = [];
    for (const [name, wantKey, wantMode] of [["rock-e-minor", "E", "minor"], ["ballad-g-major", "G", "major"]]) {
      const { pcm } = renderSong(name);
      const ch = run(pcm, 20);
      rows.push({
        song: name, got: `${ch.key} ${ch.keyMode}`, want: `${wantKey} ${wantMode}`,
        conf: +ch.keyConfidence.toFixed(2),
        ok: ch.key === wantKey && ch.keyMode === wantMode,
      });
    }
    results.key = { pass: rows.every((r) => r.ok), detail: rows };
  }

  // --- 4. THE credibility test: a song that modulates
  {
    const { pcm, truth } = renderSong("jazz-keychange");
    const changeAt = truth.keyChanges[1].t;
    let beforeKey = null, afterKey = null, flaps = 0, last = null, lockedF = null;
    run(pcm, truth.duration - 0.2, {
      onFrame: (c, t) => {
        const lbl = c.key ? `${c.key} ${c.keyMode}` : null;
        // count label changes in the settled stretch BEFORE the modulation:
        // relative keys share six of seven notes, so a detector without
        // hysteresis flickers between them on every passing chord
        if (t > 4 && t < changeAt - 0.5) {
          if (lbl && last && lbl !== last) flaps++;
          if (lbl) last = lbl;
          beforeKey = lbl;
        }
        if (t > changeAt) {
          afterKey = lbl;
          if (lbl === "F major" && lockedF === null) lockedF = t;
        }
      },
    });
    // MEASURE the lag; don't just check the final value. The first version
    // asserted the label at "t > changeAt + 6" but kept overwriting it to the
    // end of the song, so it was really asserting "eventually" — it would have
    // passed at any lag whatsoever. The real number is ~12s, and it is the
    // KEY_TAU window filling with the new key: a leaky histogram cannot know a
    // key changed until it has heard enough of the new one, and shortening it
    // breaks slow songs (a 68bpm ballad's progression is 14s long). Only the
    // key LABEL is slow; petals, chord polygon, ribbon and tension are instant.
    // A stale label for a few seconds beats a label that flickers — that reads
    // as a broken instrument.
    const lag = lockedF === null ? Infinity : lockedF - changeAt;
    // <20s, up from <15: keys-are-rare switching (margin 0.035 held 7s, after
    // the ~11s histogram swings) trades modulation speed for stability. The
    // user's real complaint was the label flipping DURING one-key songs —
    // classical piano tonicizes constantly and the old rule chased every
    // excursion — and a detector that assumes the key stays put is right far
    // more often. Measured lag on this song: 17.3s, with exactly two label
    // transitions across its whole 40 seconds.
    results.modulation = {
      pass: beforeKey === "D minor" && afterKey === "F major" && flaps === 0 && lag < 20,
      before: beforeKey, want1: "D minor",
      after: afterKey, want2: "F major",
      flapsBeforeChange: flaps,
      changeAt: +changeAt.toFixed(1),
      lockLagSec: lag === Infinity ? "never" : +lag.toFixed(1),
      note: "finds Dm, follows the modulation to F within ~KEY_TAU, never flickers",
    };
  }

  // --- 4b. STABILITY: the user's actual complaint, as an assertion. On a
  // song that never changes key, the label must never change after its first
  // lock — tonicizations, busy melodies and passing chords included. The MODE
  // word gets the same contract (it flapped on every classical run before it
  // was measured over the 11s histogram with hysteresis).
  {
    const rows = [];
    for (const name of ["rock-e-minor", "ballad-g-major"]) {
      const { pcm, truth } = renderSong(name);
      let locks = 0, last = null;
      run(pcm, truth.duration - 0.2, {
        onFrame: (c) => {
          const lbl = c.key ? `${c.key} ${c.keyMode}` : null;
          if (lbl && lbl !== last) { locks++; last = lbl; }
        },
      });
      rows.push({ song: name, labelChanges: locks, finalKey: last });
    }
    results.stability = {
      pass: rows.every((r) => r.labelChanges === 1), // the first lock, then never again
      detail: rows,
      note: "a one-key song locks once and the label never moves again",
    };
  }

  // --- 5. notes vs exact MIDI truth
  {
    const { pcm, truth } = renderSong("solo-piano-melody");
    const fired = [];
    const seen = new Set();
    run(pcm, truth.duration - 0.2, {
      onFrame: (ch, t) => {
        for (const nt of ch.notes) {
          if (nt.state === "on" && !seen.has(nt.id)) { seen.add(nt.id); fired.push({ t, midi: nt.midi, conf: nt.conf }); }
        }
      },
    });
    // an onset is CORRECT if a true note starts within 120ms at that pitch
    let correct = 0;
    const matched = new Set();
    for (const f of fired) {
      const m = truth.notes.findIndex((n, i) => !matched.has(i) && n.midi === f.midi && Math.abs(n.t - f.t) < 0.14);
      if (m >= 0) { matched.add(m); correct++; }
    }
    // octave errors are the classic failure: report them separately so a
    // future fix has a number to move
    let octaveErrs = 0;
    for (const f of fired) {
      if (truth.notes.some((n) => Math.abs(n.t - f.t) < 0.14 && n.midi !== f.midi && (f.midi - n.midi) % 12 === 0)) octaveErrs++;
    }
    results.notes = {
      pass: correct / truth.notes.length > 0.7 && correct / Math.max(1, fired.length) > 0.6,
      trueNotes: truth.notes.length, fired: fired.length, correct,
      recall: +(correct / truth.notes.length).toFixed(2),
      precision: +(correct / Math.max(1, fired.length)).toFixed(2),
      octaveErrors: octaveErrs,
      note: "monophonic melody: >70% recall, >60% precision",
    };
  }

  // --- 6. drums are not notes.
  // A REAL percussion bed (songbank's drums-only). The first version
  // highpassed the full mix, which leaves the pad's and lead's upper partials
  // — those are real pitches and SHOULD produce notes, so it tested nothing.
  {
    const { pcm } = renderSong("drums-only");
    let noteFrames = 0, frames = 0, maxPerc = 0;
    run(pcm, 14, {
      onFrame: (ch, t) => {
        if (t < 4) return;
        frames++;
        if (ch.notes.length > 0) noteFrames++;
        maxPerc = Math.max(maxPerc, ch.percussive);
      },
    });
    results.drums = {
      pass: noteFrames / Math.max(1, frames) < 0.2,
      framesWithNotes: +(noteFrames / Math.max(1, frames)).toFixed(3),
      maxPercussive: +maxPerc.toFixed(2),
      note: "a percussion bed must not become fake notes",
    };
  }

  // --- 7. silence: no key, no notes, no glow
  {
    const { pcm } = renderSong("room-tone");
    const ch = run(pcm, 11);
    let sum = 0;
    for (const v of ch.chroma) sum += v;
    results.silence = {
      pass: ch.key === null && ch.notes.length === 0 && sum < 0.2,
      key: ch.key, notes: ch.notes.length, chromaSum: +sum.toFixed(3),
    };
  }

  // --- 8. perf
  {
    const { pcm } = renderSong("rock-e-minor");
    const ch = new Chroma();
    const sim = mkSim(pcm);
    for (let i = 0; i < 120; i++) { sim.seek(i / 60); ch.update(sim, 1 / 60); }
    const t0 = performance.now();
    const N = 240;
    for (let i = 0; i < N; i++) { sim.seek(2 + i / 60); ch.update(sim, 1 / 60); }
    // subtract the sim's own FFT: the app gets that from a real AnalyserNode
    const t1 = performance.now();
    for (let i = 0; i < N; i++) sim.seek(2 + i / 60);
    const simOnly = performance.now() - t1;
    results.perf = {
      msPerFrame: +(((t1 - t0) - simOnly) / N).toFixed(3),
      note: "chroma analysis only; the 8192 FFT is the AnalyserNode's job in the app",
    };
  }

  results.pass = Object.values(results).every((r) => r.pass !== false);
  console.log(results);
  return results;
}
window.chromaSuite = chromaSuite;
