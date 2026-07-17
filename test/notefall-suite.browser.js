// Note-Fall bench — is the transcription actually true?
//
//   const src = await (await fetch('/test/notefall-suite.browser.js')).text();
//   eval(src); await notefallSuite();
//
// The mode's claim is a piano roll of what was REALLY played: right notes at
// the right keys, drums as texture and never as notes, silence as an empty
// roll, and a past that cannot change once written. Each of those is asserted
// against the song bank's declared MIDI ground truth — not eyeballed.
//
//   rowMapping    pitch -> row geometry is monotone and bounded
//   melody        solo-piano-melody: onset precision/recall vs exact MIDI truth
//   sustain       a held note's bar length == hold time x scroll speed
//   drums         drums-only: ZERO note bars, shimmer present
//   silence       room tone: empty roll, breathing keyboard, no shimmer snow
//   immutability  scroll N columns -> every past pixel translates EXACTLY N
//   perf          cost at 1920x480 (incl. the 8192 chroma)

async function notefallSuite() {
  const V = Date.now();
  const { renderSong, SR } = await import(`/test/harness/songbank.js?v=${V}`);
  const { AnalyserSim } = await import(`/test/harness/analysersim.js?v=${V}`);
  const { NoteFall } = await import(`/src/notefall.js?v=${V}`);
  const results = {};

  const W = 1920, H = 480;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  const run = (pcm, secs, onFrame) => {
    const inst = new NoteFall();
    const hi = new AnalyserSim(pcm, { fftSize: 8192, smoothingTimeConstant: 0.35, sampleRate: SR });
    const lo = new AnalyserSim(pcm, { fftSize: 2048, smoothingTimeConstant: 0.55, sampleRate: SR });
    lo.hiRes = hi; // exactly what main.js attaches for `needsChroma` modes
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

  // a SUSTAINED harmonic tone (the song bank's voices are all struck/decaying;
  // the sustain test needs a note that holds at level until told to stop)
  const sustainPcm = (midi, holdSecs, totalSecs) => {
    const n = Math.round(totalSecs * SR);
    const out = new Float32Array(n);
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const at = Math.round(0.5 * SR), dur = Math.round(holdSecs * SR);
    for (let i = 0; i < dur && at + i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, t * 100) * Math.min(1, (holdSecs - t) / 0.03);
      let s = 0;
      for (let hN = 1; hN <= 5; hN++) s += Math.sin(2 * Math.PI * f * hN * t) * (1 / (hN * hN));
      out[at + i] = Math.tanh(s * env * 0.5);
    }
    return out;
  };

  // longest lit run of pixels along one roll row (probing the bitmap itself)
  const litRunInRow = (inst, row) => {
    const c = inst.roll.getContext("2d");
    const rw = inst.roll.width, rh = inst.roll.height;
    const rowH = rh / 52;
    const y = Math.min(rh - 1, Math.round(row * rowH + rowH / 2));
    const d = c.getImageData(0, y, rw, 1).data;
    let best = 0, cur = 0;
    for (let x = 0; x < rw; x++) {
      const lit = d[x * 4] + d[x * 4 + 1] + d[x * 4 + 2] > 90; // clearly above bg
      cur = lit ? cur + 1 : 0;
      if (cur > best) best = cur;
    }
    return best;
  };

  // --- 1. geometry: higher pitch = higher on screen, window is A2..C7
  {
    const inst = new NoteFall();
    let mono = true;
    for (let m = 46; m <= 96; m++) if (inst.rowOf(m) >= inst.rowOf(m - 1)) mono = false;
    results.rowMapping = {
      pass: mono && inst.rowOf(96) === 0 && inst.rowOf(45) === 51 &&
        inst.rowOf(20) === 51 && inst.rowOf(120) === 0, // out-of-range clamps
      top: "C7=row0", bottom: "A2=row51",
    };
  }

  // --- 2. THE CLAIM: the melody it draws is the melody that was played
  {
    const { pcm, truth } = renderSong("solo-piano-melody");
    const inst = run(pcm, Math.min(truth.duration + 1, pcm.length / SR), null);
    const onsets = inst.stats.onsets.slice();
    // greedy match: each truth note claims one drawn onset of the same midi
    // within 0.5s of when it was struck
    let matched = 0;
    const used = new Set();
    for (const nt of truth.notes) {
      let hit = -1;
      for (let i = 0; i < onsets.length; i++) {
        if (used.has(i)) continue;
        if (onsets[i].midi === nt.midi && Math.abs(onsets[i].t - nt.t) < 0.5) { hit = i; break; }
      }
      if (hit >= 0) { used.add(hit); matched++; }
    }
    const recall = matched / truth.notes.length;
    const precision = onsets.length ? matched / onsets.length : 0;
    // and the drawn rows must be the RIGHT rows (placement, not just count)
    let rowsRight = true;
    for (const o of onsets) if (o.row !== inst.rowOf(o.midi)) rowsRight = false;
    results.melody = {
      pass: precision > 0.9 && recall > 0.7 && rowsRight,
      precision: +precision.toFixed(2), recall: +recall.toFixed(2),
      truthNotes: truth.notes.length, drawnOnsets: onsets.length, rowsRight,
    };
  }

  // --- 3. a held note's bar is as long as the note was held (60 px/s)
  {
    const HOLD = 3;
    const inst = run(sustainPcm(69, HOLD, 6), 6, null);
    const bar = litRunInRow(inst, inst.rowOf(69));
    const expect = HOLD * 60;
    // slack: onset latency shortens, the 0.16s release grace lengthens
    results.sustain = {
      pass: bar > expect * 0.8 && bar < expect * 1.25,
      barPx: bar, expectPx: expect, note: "A4 held 3s at 60px/s",
    };
  }

  // --- 4. drums are texture, never notes
  {
    const { pcm, truth } = renderSong("drums-only");
    const inst = run(pcm, Math.min(truth.duration, pcm.length / SR), null);
    results.drums = {
      pass: inst.stats.onsets.length === 0 && inst.stats.shimmerCols > 0,
      fakeNotes: inst.stats.onsets.length, shimmerCols: inst.stats.shimmerCols,
    };
  }

  // --- 5. silence: the roll stays empty — no bars, and no shimmer snow
  // (room tone is spectrally FLAT, so an ungated flatness detector calls it
  // percussive; the mode must not let quiet hiss snow on the record)
  {
    const { pcm } = renderSong("room-tone");
    const inst = run(pcm, 10, null);
    const c = inst.roll.getContext("2d");
    const d = c.getImageData(0, 0, inst.roll.width, inst.roll.height).data;
    let hot = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) hot++;
    // the keyboard still breathes on the main canvas
    const kb = ctx.getImageData(Math.round(W * 0.03), Math.round(H * 0.5), 30, 8).data;
    let kbLit = 0;
    for (let i = 0; i < kb.length; i += 4) if (kb[i] + kb[i + 1] + kb[i + 2] > 24) kbLit++;
    results.silence = {
      pass: inst.stats.onsets.length === 0 && inst.stats.shimmerCols === 0 && hot === 0 && kbLit > 0,
      bars: inst.stats.onsets.length, shimmer: inst.stats.shimmerCols,
      hotRollPixels: hot, keyboardVisible: kbLit > 0,
    };
  }

  // --- 6. WRITE-ONCE: scroll N columns, every past pixel translates EXACTLY N
  {
    const { pcm } = renderSong("solo-piano-melody");
    let snapA = null, scrolledA = 0;
    const inst = run(pcm, 9, (i2, t, frame) => {
      if (frame === 60 * 6) {
        const c = i2.roll.getContext("2d");
        snapA = c.getImageData(0, 0, i2.roll.width, i2.roll.height);
        scrolledA = i2.scrolled;
      }
    });
    const c = inst.roll.getContext("2d");
    const snapB = c.getImageData(0, 0, inst.roll.width, inst.roll.height);
    const shift = inst.scrolled - scrolledA; // the odometer says how far it moved
    const rw = inst.roll.width, rh = inst.roll.height;
    let badBytes = 0, checked = 0;
    for (let y = 0; y < rh; y += 7) {
      for (let x = shift + 4; x < rw - 4; x += 11) {
        const a = (y * rw + x) * 4, b = (y * rw + (x - shift)) * 4;
        for (let k = 0; k < 4; k++) {
          if (snapA.data[a + k] !== snapB.data[b + k]) badBytes++;
          checked++;
        }
      }
    }
    results.immutability = {
      pass: shift > 100 && badBytes === 0,
      shiftPx: shift, bytesChecked: checked, badBytes,
      note: "past pixels are bit-identical after translation",
    };
  }

  // --- 7. perf on a full mix
  {
    const { pcm } = renderSong("rock-e-minor");
    const inst = run(pcm, 10, null);
    results.perf = {
      pass: inst.ms < 3,
      msPerFrame: +inst.ms.toFixed(2),
      note: "includes the 8192-bin chroma update",
    };
  }

  const all = Object.values(results).every((r) => r.pass);
  console.log(`NOTEFALL SUITE: ${all ? "ALL PASS" : "FAILURES"}`);
  for (const [k, v] of Object.entries(results)) console.log(k, v.pass ? "PASS" : "FAIL", v);
  return { all, results };
}
