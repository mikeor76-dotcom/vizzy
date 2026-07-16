// Murmuration bench — does the flock actually FLY the music?
//
//   window.__Murm = (await import('/src/murmuration.js')).Murmuration;
//   const src = await (await fetch('/test/murmuration-suite.browser.js')).text();
//   eval(src); await murmSuite();
//
// (No import in this file: Vite's transform of fetched JS breaks eval.)
//
// The claims worth testing are behavioural, not cosmetic:
//   tightness  loud music must BALL the flock up; quiet must loosen it. Measured
//              as mean distance from the flock centroid — it has to fall as
//              energy rises, monotonically, or the audio isn't really driving it.
//   hawk       a big accent must scatter the flock AND it must reform (a burst
//              that never heals is a bug, not a murmuration).
//   grounded   silence lands the birds: speed ~0, all of them at the reed line.
//   wake       music after silence must get them airborne again.

function murmAnalyser(state) {
  return {
    getByteFrequencyData(a) {
      const s = state.spec;
      if (s.silence) {
        for (let i = 0; i < a.length; i++) a[i] = Math.max(0, Math.round(2 + Math.random() * 3 - (i / a.length) * 1.5));
        return;
      }
      const t = state.t;
      const kick = Math.exp(-((t * s.bpm / 60) % 1) * 16) * (s.hard ?? 1);
      // `wobble` = slow +-level drift, for simulating COMPRESSED real masters
      const L = s.level + (s.wobble ? Math.sin(t * 0.35) * s.wobble : 0);
      for (let i = 0; i < a.length; i++) {
        let v;
        if (i < 6) v = L * (0.5 + kick * 0.5);
        else if (i < 26) v = L * (0.4 + kick * 0.3);
        else if (i < 200) v = L * (0.3 + 0.25 * Math.sin(i * 0.05 + t));
        else if (i < 380) v = L * 0.22;
        else v = L * 0.05;
        a[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    },
  };
}

// mean distance from the centroid = how balled-up the flock is
function spread(inst) {
  let cx = 0, cy = 0;
  for (let i = 0; i < inst.n; i++) { cx += inst.x[i]; cy += inst.y[i]; }
  cx /= inst.n; cy /= inst.n;
  let d = 0;
  for (let i = 0; i < inst.n; i++) d += Math.hypot(inst.x[i] - cx, inst.y[i] - cy);
  return d / inst.n;
}
function meanSpeed(inst) {
  let s = 0;
  for (let i = 0; i < inst.n; i++) s += Math.hypot(inst.vx[i], inst.vy[i]);
  return s / inst.n;
}

// Speed of the fastest tenth of the flock. The hawk only startles the birds it
// reaches, so a flock-wide MEAN dilutes the panic into the cruising majority
// (measured 1.14x while the flock's spread jumped 47% — the burst was plainly
// there, the metric just couldn't see it). "Some birds bolt" is the claim, so
// measure the birds that bolt.
function p90Speed(inst) {
  const s = [];
  for (let i = 0; i < inst.n; i++) s.push(Math.hypot(inst.vx[i], inst.vy[i]));
  s.sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.9)];
}

// Mean nearest-neighbour distance = how densely PACKED the birds are.
// This is what "the flock balls up" actually means, and unlike spread-from-
// centroid it can't be fooled by the flock splitting in two (which reads as a
// huge spread while each half is packed tighter than ever).
function meanNN(inst, W, H) {
  const C = 40, cols = Math.ceil(W / C), rows = Math.ceil(H / C);
  const head = new Int32Array(cols * rows).fill(-1);
  const next = new Int32Array(inst.n);
  const cellOf = (i) => {
    const cx = Math.max(0, Math.min(cols - 1, (inst.x[i] / C) | 0));
    const cy = Math.max(0, Math.min(rows - 1, (inst.y[i] / C) | 0));
    return [cx, cy];
  };
  for (let i = 0; i < inst.n; i++) {
    const [cx, cy] = cellOf(i);
    const c = cy * cols + cx;
    next[i] = head[c]; head[c] = i;
  }
  let sum = 0;
  for (let i = 0; i < inst.n; i++) {
    const [gx, gy] = cellOf(i);
    let best = Infinity;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const rx = gx + ox, ry = gy + oy;
      if (rx < 0 || rx >= cols || ry < 0 || ry >= rows) continue;
      for (let j = head[ry * cols + rx]; j !== -1; j = next[j]) {
        if (j === i) continue;
        const d2 = (inst.x[j] - inst.x[i]) ** 2 + (inst.y[j] - inst.y[i]) ** 2;
        if (d2 < best) best = d2;
      }
    }
    sum += best < Infinity ? Math.sqrt(best) : C * 2;
  }
  return sum / inst.n;
}

async function murmSuite() {
  const Murmuration = window.__Murm;
  if (!Murmuration) throw new Error("pre-load: window.__Murm = (await import('/src/murmuration.js')).Murmuration");
  const cv = document.createElement("canvas");
  cv.width = 1920; cv.height = 480;
  const ctx = cv.getContext("2d");
  const W = 1920, H = 480;
  const results = {};

  const mk = () => {
    const inst = new Murmuration();
    const state = { t: 0, spec: { silence: 1 } };
    const an = murmAnalyser(state);
    return { inst, state, an, now: 1000 };
  };
  const run = (r, secs) => {
    for (let i = 0; i < secs * 60; i++) {
      r.state.t += 1 / 60; r.now += 1000 / 60;
      r.inst.render(ctx, r.an, W, H, r.now);
    }
  };

  // --- 1. tightness vs energy, measured WITHIN one song.
  // Testing steady loud vs steady quiet songs proves nothing here: the mode
  // self-normalizes against its own slow peak (that's the whole point of
  // auto:null), so any sustained level converges to energy ~0.9 and the flock
  // is equally tight. What the audience actually sees is the verse/chorus
  // contrast INSIDE a track, so that's what gets asserted.
  const r1 = mk();
  r1.state.spec = { level: 0.9, bpm: 120, hard: 0.8 };
  run(r1, 16); // establish the song's peak, flock settles
  const loudNN = meanNN(r1.inst, W, H), loudE = r1.inst.energy;
  r1.state.spec = { level: 0.22, bpm: 120, hard: 0.3 }; // drop to a quiet verse
  run(r1, 8);
  const quietNN = meanNN(r1.inst, W, H), quietE = r1.inst.energy;
  r1.state.spec = { level: 0.9, bpm: 120, hard: 0.8 }; // chorus back in
  run(r1, 8);
  const backNN = meanNN(r1.inst, W, H);
  results.tightness = {
    pass: quietNN > loudNN * 1.1 && backNN < quietNN * 0.95,
    note: "within a song: quiet verse loosens the packing, chorus tightens it",
    loudNN: +loudNN.toFixed(1), quietNN: +quietNN.toFixed(1), chorusAgainNN: +backNN.toFixed(1),
    loudEnergy: +loudE.toFixed(2), quietEnergy: +quietE.toFixed(2),
    spreadLoud: +spread(r1.inst).toFixed(0),
  };

  // --- 2. hawk: a predator dive makes the flock BOLT, then it recovers.
  //
  // Measured on flock SPEED, not on spread-from-centroid. Spread looks like
  // the obvious metric and is a trap: the flock breathes 1.0x-1.7x on its own
  // as it roams and follows the wandering target, which is the same size as
  // the hawk's effect, so the assertion was really sampling the phase of that
  // breathing and flapped run to run. Panic is what the hawk actually causes —
  // birds near it sprint — and it's clean, causal, and unambiguous.
  const r2 = mk();
  r2.state.spec = { level: 0.5, bpm: 100, hard: 0.35 };
  run(r2, 26); // the flock needs ~15s to converge from its random seed
  r2.inst._lastHawk = r2.now + 1e6; // no natural dives during the measurement
  r2.inst.hawkOn = 0; r2.inst.turnLeft = 0; // and kill any dive/swerve already in flight
  run(r2, 2); // let its panic drain before taking the baseline
  // Baseline = the MAX p90 over 3s (several beats' worth). Beats deliberately
  // sprint and swerve the flock now, so an average baseline is polluted by
  // them and the honest claim becomes: the hawk makes birds bolt HARDER than
  // any routine beat does.
  let base = 0;
  for (let i = 0; i < 180; i++) { run(r2, 1 / 60); base = Math.max(base, p90Speed(r2.inst)); }
  const calmSpread = spread(r2.inst);
  // fire it the way the mode does; the hawk aims itself at the flock's centre,
  // so there are no coordinates to poke
  r2.inst.hawkOn = 1; r2.inst.hawkT = 0;
  r2.inst.aimHawk();
  let peakSp = 0, peakSpread = 0;
  for (let i = 0; i < 90; i++) {
    run(r2, 1 / 60);
    peakSp = Math.max(peakSp, p90Speed(r2.inst));
    peakSpread = Math.max(peakSpread, spread(r2.inst));
  }
  // "settles back" = the QUIET point after recovery, not one sampled instant —
  // beats now swerve and sprint the flock on purpose, so a single sample can
  // land mid-swerve and read as "never settled"
  let settled = Infinity;
  for (let i = 0; i < 240; i++) { run(r2, 1 / 60); settled = Math.min(settled, p90Speed(r2.inst)); }
  results.hawk = {
    // spreadKick is INFORMATIONAL only: the flock breathes 1.0-1.7x on its own,
    // so a spread ratio against one sampled baseline is noise — asserting on it
    // is the exact flake this test already had once. Panic (p90 vs the max any
    // routine beat produces) is causal and stable; that's the claim.
    pass: peakSp > base * 1.15 && settled < base,
    note: "hawk panic exceeds ANY routine beat's sprint by >15%, then settles",
    baseP90: +base.toFixed(0), peakP90: +peakSp.toFixed(0), settledP90: +settled.toFixed(0),
    panicRatio: +(peakSp / base).toFixed(2),
    spreadKick: +(peakSpread / calmSpread).toFixed(2),
  };

  // --- 3. silence lands them on the reeds
  const r3 = mk();
  r3.state.spec = { level: 0.8, bpm: 120, hard: 0.8 };
  run(r3, 8); // fly first
  r3.state.spec = { silence: 1 };
  // The flock settles over ~40s (measured: 42% down at 15s, 88% at 30s, 100%
  // at 45s, speed -> 0). That slow descent is the intent, not a bug — birds
  // don't drop out of the sky — but it means a shorter window measures a flock
  // still on its way down rather than the landed state.
  run(r3, 42);
  // the perch band sits just ABOVE the reed tips (they stand up to 29px
  // proud) so the landed silhouettes read against the lit sky
  const reedY = H * 0.86;
  let onReed = 0;
  for (let i = 0; i < r3.inst.n; i++) {
    const d = reedY - r3.inst.y[i];
    if (d > 12 && d < 50) onReed++;
  }
  const grounded = onReed / r3.inst.n;
  results.grounded = {
    pass: r3.inst.ground > 0.9 && meanSpeed(r3.inst) < 12 && grounded > 0.9,
    ground: +r3.inst.ground.toFixed(2), meanSpeed: +meanSpeed(r3.inst).toFixed(1),
    fracOnReedLine: +grounded.toFixed(2),
  };

  // --- 4. and music wakes them back up
  r3.state.spec = { level: 0.85, bpm: 128, hard: 0.9 };
  run(r3, 10);
  results.wake = {
    pass: r3.inst.ground < 0.1 && meanSpeed(r3.inst) > 40,
    ground: +r3.inst.ground.toFixed(2), meanSpeed: +meanSpeed(r3.inst).toFixed(0),
  };

  // --- 5. containment: the flock must ROAM the panel and stay ON it.
  // The flock can't decelerate (every bird is pinned at cruise speed), so it
  // can only turn — which means walls and roam targets have to account for its
  // turn radius AND its own ~150px radius. Both were wrong: the centroid
  // reached x=82 and y=20, hanging a third of the birds off the screen.
  const r4 = mk();
  r4.state.spec = { level: 0.9, bpm: 120, hard: 0.85 };
  run(r4, 6);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, off = 0, samples = 0;
  for (let s = 0; s < 360; s++) {
    run(r4, 10 / 60);
    let cx = 0, cy = 0, o = 0;
    for (let i = 0; i < r4.inst.n; i++) {
      cx += r4.inst.x[i]; cy += r4.inst.y[i];
      if (r4.inst.x[i] < 0 || r4.inst.x[i] > W || r4.inst.y[i] < 0 || r4.inst.y[i] > H) o++;
    }
    cx /= r4.inst.n; cy /= r4.inst.n;
    minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
    minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
    off += o / r4.inst.n; samples++;
  }
  const offPct = (off / samples) * 100;
  results.containment = {
    // A couple of birds clipping the edge as a hawk scatters them is natural
    // (~0.5% of the flock, transiently). The defect this guards against is the
    // flock PARKING off-screen — it used to sit with its centroid at y=20 and a
    // third of the birds permanently outside the panel — so the centroid bounds
    // matter as much as the percentage.
    pass: offPct < 1.5 && minY > 60 && maxY < H * 0.84 && maxX - minX > W * 0.5,
    note: "roams >50% of the width; flock body stays on the panel",
    centroidX: `${minX.toFixed(0)}..${maxX.toFixed(0)}`,
    centroidY: `${minY.toFixed(0)}..${maxY.toFixed(0)}`,
    offPanelPct: +offPct.toFixed(2),
  };

  // --- 6. LEGIBILITY on compressed "real" music — the user-report test.
  // Every other test here passed while the user saw "no evidence the items
  // are affected by the music at all," because they used exaggerated synthetic
  // dynamics (4x verse/chorus swings). Real masters are compressed: energy sat
  // pinned at 0.83..1.00, its ~20px contribution to flock size buried under
  // 88..298px of autonomous breathing, and beats only raised a speed CAP —
  // not a force, so nothing moved. This test plays compressed music and
  // asserts the choreography a viewer can actually attribute to the beat:
  //   turn    the flock's mean heading swings on kicks (the beat dance)
  //   inhale  the flock contracts on kicks (the throb)
  //   visE    the contrast-stretcher re-earns the loose<->tight range
  const r6 = mk();
  r6.state.spec = { level: 0.72, wobble: 0.1, bpm: 120, hard: 0.7 };
  run(r6, 24); // settle + learn the song's energy range
  const heading = () => {
    let sx = 0, sy = 0;
    for (let i = 0; i < r6.inst.n; i++) { sx += r6.inst.vx[i]; sy += r6.inst.vy[i]; }
    return Math.atan2(sy, sx);
  };
  const turns = [], dips = [];
  let lastB = r6.inst.beat, visLo = 1, visHi = 0;
  for (let i = 0; i < 14 * 60; i++) {
    run(r6, 1 / 60);
    visLo = Math.min(visLo, r6.inst.visE); visHi = Math.max(visHi, r6.inst.visE);
    if (r6.inst.beat > 0.9 && lastB <= 0.9) {
      const h0 = heading(), r0 = r6.inst.flockR;
      // track the dip THROUGH the swerve window — the inhale force rides the
      // beat envelope (decay 4/s), so it peaks in the first ~0.25s; measuring
      // after the turn window sampled the recovery, not the contraction
      let dip = 0;
      for (let k = 0; k < 30; k++) { run(r6, 1 / 60); dip = Math.max(dip, (r0 - r6.inst.flockR) / r0); }
      const dh = Math.atan2(Math.sin(heading() - h0), Math.cos(heading() - h0));
      turns.push(Math.abs(dh));
      dips.push(dip);
    }
    lastB = r6.inst.beat;
  }
  const avg2 = (a) => a.reduce((x, v) => x + v, 0) / Math.max(1, a.length);
  results.legibility = {
    // The TURN is the primary legibility channel (measured 0.49-0.67 rad —
    // ~28-38 deg per kick, rock stable across runs). The inhale is a garnish
    // riding on top and swings 0.035-0.09 with song phase, so it gets a sanity
    // floor, not a star role.
    pass: turns.length >= 8 && avg2(turns) > 0.15 && avg2(dips) > 0.025 && visHi - visLo > 0.35,
    note: "on COMPRESSED music: flock swerves >~9deg per kick, throbs, size range re-earned",
    beatsMeasured: turns.length,
    meanTurnRad: +avg2(turns).toFixed(3),
    meanInhale: +avg2(dips).toFixed(3),
    visERange: +(visHi - visLo).toFixed(2),
  };

  // --- 7. perf at panel size
  const r5 = mk();
  r5.state.spec = { level: 0.8, bpm: 128, hard: 0.9 };
  run(r5, 4);
  const t0 = performance.now();
  run(r5, 4);
  results.perf = { msPerFrame: +((performance.now() - t0) / 240).toFixed(3), birds: r5.inst.n, at: "1920x480" };

  console.log(results);
  return results;
}
window.murmSuite = murmSuite;
