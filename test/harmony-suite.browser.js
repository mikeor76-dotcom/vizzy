// Harmony Wheel bench — is the geometry actually true?
//
//   const src = await (await fetch('/test/harmony-suite.browser.js')).text();
//   eval(src); await harmonySuite();
//
// The mode's whole claim is that a chord becomes a SHAPE and that the shape is
// transposition-invariant — every major triad the same triangle, rotated to its
// root. That is a geometric assertion about the circle-of-fifths layout, so it
// gets tested as one, on real rendered audio.
//
//   fifthsLayout   consonant notes are neighbours; the layout is what it claims
//   triadShape     C, F# and A major produce the SAME figure, rotated
//   majorVsMinor   major and minor triads are distinguishable shapes
//   litPetals      a real song lights its chord tones on the wheel
//   keyHub         the label appears, and dims when the detector is unsure
//   silence        room tone -> "listening...", no key, no polygon
//   perf           cost at 1920x480 (incl. the 8192 chroma)

const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const SLOT_OF = [];
FIFTHS.forEach((pc, slot) => { SLOT_OF[pc] = slot; });

async function harmonySuite() {
  const V = Date.now();
  const { renderSong, SR } = await import(`/test/harness/songbank.js?v=${V}`);
  const { AnalyserSim } = await import(`/test/harness/analysersim.js?v=${V}`);
  const { Harmony } = await import(`/src/harmony.js?v=${V}`);
  const results = {};

  const W = 1920, H = 480;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  // chord of struck tones (harmonics + decay), not naked sines: a real chord's
  // partials are what a chroma has to survive
  const chordPcm = (midis, secs = 6) => {
    const n = Math.round(secs * SR);
    const out = new Float32Array(n);
    const beat = 0.5;
    for (let rep = 0; rep * beat < secs - 1; rep++) {
      for (const m of midis) {
        const f = 440 * Math.pow(2, (m - 69) / 12);
        const at = Math.round(rep * beat * SR);
        const dur = Math.round(beat * 0.95 * SR);
        for (let i = 0; i < dur && at + i < n; i++) {
          const t = i / SR;
          const env = Math.min(1, t * 200) * Math.exp(-t * 2.2) * Math.min(1, (beat * 0.95 - t) / 0.03);
          let s = 0;
          for (let hN = 1; hN <= 6; hN++) s += Math.sin(2 * Math.PI * f * hN * t) * (1 / (hN * hN));
          out[at + i] += s * env * 0.3;
        }
      }
    }
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 0.9);
    return out;
  };

  const run = (pcm, secs, onFrame) => {
    const inst = new Harmony();
    const hi = new AnalyserSim(pcm, { fftSize: 8192, smoothingTimeConstant: 0.35, sampleRate: SR });
    const lo = new AnalyserSim(pcm, { fftSize: 2048, smoothingTimeConstant: 0.55, sampleRate: SR });
    lo.hiRes = hi; // exactly what main.js attaches for `needsChroma` modes
    let now = 1000;
    for (let i = 0; i < Math.round(secs * 60); i++) {
      const t = i / 60;
      hi.seek(t); lo.seek(t);
      now += 1000 / 60;
      inst.render(ctx, lo, W, H, now);
      if (onFrame) onFrame(inst, t);
    }
    return inst;
  };
  // the wheel slots the mode would draw a polygon through (its own threshold)
  const litSlots = (inst) => {
    const out = [];
    for (let slot = 0; slot < 12; slot++) if (inst.chroma.chroma[FIFTHS[slot]] > 0.42) out.push(slot);
    return out;
  };
  // The shape at the LOUDEST moment, not at whatever instant the loop happens
  // to stop. Sampling the final frame read every chord as empty: the test tone
  // stops before the run does, and by then the chroma has correctly decayed to
  // nothing. The claim is about the chord while it SOUNDS.
  const peakShapeRun = (pcm, secs) => {
    let best = -1, bestSlots = [];
    const inst = run(pcm, secs, (i2) => {
      let sum = 0;
      for (const v of i2.chroma.chroma) sum += v;
      if (sum > best) { best = sum; bestSlots = litSlots(i2); }
    });
    return { inst, slots: bestSlots };
  };
  // a shape, normalized to its lowest slot = the transposition-invariant form
  const shapeOf = (slots) => {
    if (!slots.length) return "";
    const norm = slots.map((s) => (s - slots[0] + 12) % 12).sort((a, b) => a - b);
    return norm.join(",");
  };

  // --- 1. the layout is really circle-of-fifths
  {
    let ok = true;
    for (let slot = 0; slot < 12; slot++) {
      // adjacent slots must be a perfect fifth apart (7 semitones)
      const a = FIFTHS[slot], b = FIFTHS[(slot + 1) % 12];
      if ((b - a + 12) % 12 !== 7) ok = false;
    }
    results.fifthsLayout = {
      pass: ok && new Set(FIFTHS).size === 12,
      order: FIFTHS.map((pc) => ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][pc]).join(" "),
      note: "neighbours are a fifth apart, so consonance is adjacency",
    };
  }

  // --- 2. THE CLAIM: a major triad is the same triangle wherever it starts
  {
    const rows = [];
    for (const [name, root] of [["C major", 60], ["F# major", 66], ["A major", 69]]) {
      const { slots } = peakShapeRun(chordPcm([root, root + 4, root + 7]), 6);
      rows.push({ chord: name, slots, shape: shapeOf(slots), n: slots.length });
    }
    const shapes = new Set(rows.map((r) => r.shape));
    // A struck triad lights FIVE petals, not three, and that is correct: the
    // 3rd partial of G is a D and the 3rd of E is a B, so the audio really
    // contains them — the ear hears them too. Theory said "triangle"; the
    // recording says pentagon. What actually matters is unchanged and is what
    // gets asserted: the figure is IDENTICAL for every major triad and only
    // rotates (C -> [0,1,2,4,5], F# -> [6,7,8,10,11], A -> [3,4,5,7,8]), and
    // it stays COMPACT — which is the entire payoff of a fifths layout, since
    // an arbitrary 5-note set would sprawl across the wheel.
    const span = (sl) => (sl.length ? Math.max(...sl.map((x) => (x - sl[0] + 12) % 12)) : 12);
    results.triadShape = {
      pass: shapes.size === 1 && rows.every((r) => r.n >= 3 && span(r.slots) <= 6),
      shapes: [...shapes],
      arcSpan: rows.map((r) => span(r.slots)),
      detail: rows,
      note: "every major triad = the same figure, rotated to its root, and compact",
    };
  }

  // --- 3. major and minor must be DIFFERENT shapes, or the wheel says nothing
  {
    const maj = peakShapeRun(chordPcm([60, 64, 67]), 6).slots; // C E G
    const min = peakShapeRun(chordPcm([60, 63, 67]), 6).slots; // C Eb G
    results.majorVsMinor = {
      pass: shapeOf(maj) !== shapeOf(min) && maj.length >= 3 && min.length >= 3,
      major: shapeOf(maj), minor: shapeOf(min),
      note: "C major and C minor lean opposite ways around the fifths circle",
    };
  }

  // --- 4. on a real song, the wheel lights the sounding chord
  {
    const { pcm, truth } = renderSong("ballad-g-major");
    const inst = new Harmony();
    const hi = new AnalyserSim(pcm, { fftSize: 8192, smoothingTimeConstant: 0.35, sampleRate: SR });
    const lo = new AnalyserSim(pcm, { fftSize: 2048, smoothingTimeConstant: 0.55, sampleRate: SR });
    lo.hiRes = hi;
    let now = 1000, checks = 0, hits = 0;
    for (let i = 0; i < 20 * 60; i++) {
      const t = i / 60;
      hi.seek(t); lo.seek(t);
      now += 1000 / 60;
      inst.render(ctx, lo, W, H, now);
      if (t < 6) continue;
      const cur = [...truth.chords].reverse().find((c) => c.t <= t);
      const next = truth.chords.find((c) => c.t > cur.t);
      if (!next || t < next.t - 0.35 || t > next.t - 0.3) continue;
      checks++;
      const pcs = new Set(cur.notes.map((m) => ((m % 12) + 12) % 12));
      const lit = litSlots(inst).map((s) => FIFTHS[s]);
      // most of what's lit belongs to the chord
      const inChord = lit.filter((pc) => pcs.has(pc)).length;
      if (lit.length && inChord / lit.length >= 0.6) hits++;
    }
    results.litPetals = {
      pass: checks > 4 && hits / checks >= 0.7,
      checks, hits, pct: +((hits / Math.max(1, checks)) * 100).toFixed(0),
      note: ">=60% of the lit petals belong to the sounding chord, >=70% of the time",
    };
  }

  // --- 5. the hub reports a key, with confidence, and logs history
  {
    const inst = run(renderSong("ballad-g-major").pcm, 20);
    results.keyHub = {
      pass: inst.chroma.key === "G" && inst.chroma.keyConfidence > 0.1 && inst.keyHistory.length >= 1,
      key: inst.chroma.keyLabel(),
      conf: +inst.chroma.keyConfidence.toFixed(2),
      history: inst.keyHistory.map((k) => k.label),
    };
  }

  // --- 6. silence: no key, no polygon, no invented harmony
  {
    const inst = run(renderSong("room-tone").pcm, 10);
    let sum = 0;
    for (const v of inst.chroma.chroma) sum += v;
    results.silence = {
      pass: inst.chroma.key === null && litSlots(inst).length === 0 && sum < 0.2,
      key: inst.chroma.key, litPetals: litSlots(inst).length, chromaSum: +sum.toFixed(3),
    };
  }

  // --- 6b. the Harmonic Ribbon module (the user-spec'd 30s panel):
  // history trimming, dominant selection with stickiness, silence behaviour,
  // and that the component actually puts light in its panel.
  {
    const { HarmonicRibbon, RIB_COLS } = await import(`/src/harmonicribbon.js?v=${V}`);
    const style = {
      id: "t", dim: [90, 105, 140], ink: [225, 232, 248],
      pcRGB: (pc) => [200, 180 - pc * 5, 120 + pc * 8],
    };
    const rb = new HarmonicRibbon();
    // trimming: push 900 samples (45s) — the window must stay capped at 30s
    const gShaped = new Float32Array(12);
    gShaped[7] = 1; gShaped[2] = 0.6; gShaped[11] = 0.5; gShaped[4] = 0.25; // G D B E
    for (let i = 0; i < 900; i++) rb.push(gShaped);
    const trimOk = rb.windowSamples() === RIB_COLS && rb.hist.length === 12 * RIB_COLS;
    // dominant selection: newest point must say G, and stay G under a
    // near-tie flicker (the stickiness contract)
    const domA = rb.status().domName;
    const flicker = Float32Array.from(gShaped);
    for (let i = 0; i < 80; i++) {
      flicker[2] = 0.95 + (i % 2) * 0.06; // D flickers just around G's level
      rb.push(flicker);
    }
    const domB = rb.status().domName;
    // silence: energy and thickness collapse gracefully, never freeze
    const zero = new Float32Array(12);
    for (let i = 0; i < 240; i++) rb.push(zero); // 12s of room
    const sil = rb.status();
    // rendering: the component lights its panel with music, and goes near-dark
    // in silence (measured by pixels, colour not alpha)
    const rcv = document.createElement("canvas");
    rcv.width = 700; rcv.height = 360;
    const rctx = rcv.getContext("2d", { willReadFrequently: true });
    const lit = () => {
      const d = rctx.getImageData(0, 0, 700, 330).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 40) if (d[i] + d[i + 1] + d[i + 2] > 40) n++;
      return n / (d.length / 40);
    };
    const rb2 = new HarmonicRibbon();
    for (let i = 0; i < 600; i++) rb2.push(gShaped);
    rctx.fillStyle = "#000"; rctx.fillRect(0, 0, 700, 360);
    rb2.draw(rctx, { x: 8, y: 8, w: 660, h: 320 }, style);
    const litMusic = lit();
    for (let i = 0; i < 600; i++) rb2.push(zero);
    rctx.fillStyle = "#000"; rctx.fillRect(0, 0, 700, 360);
    rb2.draw(rctx, { x: 8, y: 8, w: 660, h: 320 }, style);
    const litSilence = lit();
    results.ribbon = {
      pass: trimOk && domA === "G" && domB === "G" && sil.energy < 0.05 && sil.halfW < 8 &&
        litMusic > 0.01 && litSilence < litMusic * 0.25,
      trimOk, dominant: domA, dominantUnderFlicker: domB,
      silenceEnergy: +sil.energy.toFixed(3), silenceHalfW: +sil.halfW.toFixed(1),
      litMusic: +litMusic.toFixed(4), litSilence: +litSilence.toFixed(4),
      note: "30s cap, sticky dominant, graceful silence, and it actually paints",
    };
  }

  // --- 7. perf
  {
    const { pcm } = renderSong("rock-e-minor");
    const inst = new Harmony();
    const hi = new AnalyserSim(pcm, { fftSize: 8192, smoothingTimeConstant: 0.35, sampleRate: SR });
    const lo = new AnalyserSim(pcm, { fftSize: 2048, smoothingTimeConstant: 0.55, sampleRate: SR });
    lo.hiRes = hi;
    let now = 1000;
    for (let i = 0; i < 180; i++) { hi.seek(i / 60); lo.seek(i / 60); now += 16.7; inst.render(ctx, lo, W, H, now); }
    const N = 180;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) { hi.seek(3 + i / 60); lo.seek(3 + i / 60); now += 16.7; inst.render(ctx, lo, W, H, now); }
    const total = (performance.now() - t0) / N;
    // subtract the sim's FFTs — in the app those are the AnalyserNodes' job
    const t1 = performance.now();
    for (let i = 0; i < N; i++) { hi.seek(3 + i / 60); lo.seek(3 + i / 60); }
    const simOnly = (performance.now() - t1) / N;
    results.perf = { msPerFrame: +(total - simOnly).toFixed(3), at: "1920x480, incl. chroma" };
  }

  results.pass = Object.values(results).every((r) => r.pass !== false);
  console.log(results);
  return results;
}
window.harmonySuite = harmonySuite;
