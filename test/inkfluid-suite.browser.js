// Ink Fluid bench — does the tank hold, and does the music stir it?
//
//   const src = await (await fetch('/test/inkfluid-suite.browser.js')).text();
//   eval(src); await inkSuite();
//
// The mode's claims: the solver stays finite forever (a fluid sim's one
// unforgivable sin is a NaN blooming across the field), kicks punch real
// vortices (measurable curl, not decoration), silence is the beautiful death
// (total dye -> ~0 in ~20s, injection fully stopped), the next song wakes the
// tank, a drop slams a full-width swirl through it, and the whole thing fits
// the measured budget that let the REAL solver ship over the curl-noise
// fallback (median 1.0ms vs the 2.5ms gate at decision time).
//
//   perf        the decision measurement, re-run every time (throttle-proof)
//   stability   60s of loud full-mix: no NaN, bounded speed, bounded dye
//   kickVortex  drums-only: total |curl| spikes after kicks
//   silence     music then silence: dye decays to ~0, injection stops
//   wake        music resumes after silence: the wake plume fires, dye returns
//   rupture     the EDM drop fires the full-width swirl + slug

async function inkSuite() {
  const V = Date.now();
  const { renderSong, SR } = await import(`/test/harness/songbank.js?v=${V}`);
  const { AnalyserSim } = await import(`/test/harness/analysersim.js?v=${V}`);
  const { InkFluid } = await import(`/src/inkfluid.js?v=${V}`);
  const results = {};

  const W = 1920, H = 480;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  const mkRun = (pcm) => {
    const inst = new InkFluid();
    const lo = new AnalyserSim(pcm, { fftSize: 2048, smoothingTimeConstant: 0.55, sampleRate: SR });
    return { inst, lo, now: 1000, frame: 0 };
  };
  const drive = (r, secs, onFrame) => {
    const end = r.frame + Math.round(secs * 60);
    while (r.frame < end) {
      r.lo.seek(r.frame / 60); r.now += 1000 / 60; r.frame++;
      r.inst.render(ctx, r.lo, W, H, r.now);
      if (onFrame) onFrame(r.inst, r.frame / 60);
    }
  };
  const totalDye = (inst) => {
    let s = 0;
    for (let i = 0; i < inst.dr.length; i++) s += inst.dr[i] + inst.dg[i] + inst.db[i];
    return s;
  };
  const totalCurl = (inst) => {
    let s = 0;
    for (let i = 0; i < inst.curl.length; i++) s += Math.abs(inst.curl[i]);
    return s;
  };
  const maxAbs = (a) => {
    let m = 0, nan = false;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (v !== v) nan = true;
      else if (Math.abs(v) > m) m = Math.abs(v);
    }
    return { m, nan };
  };
  const concat = (parts) => {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Float32Array(n);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };

  // --- 1. perf: the measurement that DECIDED the real solver ships.
  // Runs first (thermal droop) and asserts the throttle-proof ratio too.
  {
    const r = mkRun(renderSong("rock-e-minor").pcm);
    const costs = [];
    let last = performance.now();
    drive(r, 10, () => { const n2 = performance.now(); costs.push(n2 - last); last = n2; });
    costs.sort((a, b) => a - b);
    const median = costs[costs.length >> 1];
    const arr = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) arr[i] = Math.random();
    const refs = [];
    for (let k = 0; k < 25; k++) {
      const s0 = performance.now();
      let s = 0;
      for (let i = 0; i < 600000; i++) s += arr[i & 1023] * 0.5;
      refs.push(performance.now() - s0 + (s > 1e12 ? 1 : 0));
    }
    refs.sort((a, b) => a - b);
    const ref = refs[12];
    results.perf = {
      pass: median < 2.5 || median / ref < 5,
      msMedian: +median.toFixed(2),
      msSolve: +r.inst.msSolve.toFixed(2),
      msRender: +r.inst.msRender.toFixed(2),
      refMs: +ref.toFixed(2),
      xRef: +(median / ref).toFixed(2),
      grid: `${r.inst.gw}x${r.inst.gh}`, iters: r.inst.iters,
    };
  }

  // --- 2. stability: 60s of loud music, the field must stay finite and sane
  {
    const rock = renderSong("rock-e-minor").pcm;
    const edm = renderSong("edm-c-drop").pcm;
    const r = mkRun(concat([rock, edm, rock]));
    let worstU = 0, worstDye = 0, sawNaN = false;
    drive(r, 60, (inst, t) => {
      if (Math.round(t * 60) % 120 !== 0) return;
      const u = maxAbs(inst.u), v = maxAbs(inst.v), d = maxAbs(inst.dr);
      if (u.nan || v.nan || d.nan) sawNaN = true;
      worstU = Math.max(worstU, u.m, v.m);
      worstDye = Math.max(worstDye, d.m);
    });
    results.stability = {
      // velocity bounded (cells/sec — a cell is 8px, so 400 = one panel/sec),
      // dye bounded (the soft-clip renders anything, but unbounded growth
      // means dissipation lost to injection)
      pass: !sawNaN && worstU < 400 && worstDye < 40,
      sawNaN, worstSpeed: +worstU.toFixed(1), worstDye: +worstDye.toFixed(1),
      kicks: r.inst.kicks, ruptures: r.inst.ruptures,
    };
  }

  // --- 3. kicks punch REAL vortices: curl spikes AT THE KICK SITE.
  // Global total-curl was the wrong meter (the p90 lesson from the
  // murmuration hawk): a local vortex is a rounding error on 14,400 cells of
  // ambient churn — it measured 1.04 while the mushroom was plainly rolling.
  {
    const localCurl = (inst, x, y, rad) => {
      let s = 0;
      const x0 = Math.max(1, x - rad), x1 = Math.min(inst.gw - 2, x + rad);
      const y0 = Math.max(1, y - rad), y1 = Math.min(inst.gh - 2, y + rad);
      for (let j = y0; j <= y1; j++)
        for (let i = x0; i <= x1; i++) s += Math.abs(inst.curl[j * inst.gw + i]);
      return s;
    };
    const r = mkRun(renderSong("drums-only").pcm);
    drive(r, 3); // settle, learn peaks
    const ratios = [];
    let kicksSeen = r.inst.kicks;
    // "before" must be the frame BEFORE the kick: onFrame runs after the
    // render, so at kick-detection time the jet's shear has ALREADY bloomed
    // curl into the field (sampling then measured 1.19 while the mushroom was
    // plainly rolling). Track all three candidate sites every frame.
    const sites = [86, 120, 154]; // e2/e3/e4 emitter x's on the 240 grid
    let prev = null;
    drive(r, 12, (inst) => {
      const cur = sites.map((x) => localCurl(inst, x, inst.gh - 6, 10));
      if (inst.kicks > kicksSeen && inst.lastKick && prev) {
        kicksSeen = inst.kicks;
        const { x, y } = inst.lastKick;
        const si = sites.indexOf(x);
        const before = si >= 0 ? prev[si] : localCurl(inst, x, y, 10);
        let peak = 0;
        // the mushroom's shoulders roll up over ~half a second
        drive(r, 0.5, (i2) => { peak = Math.max(peak, localCurl(i2, x, y, 10)); });
        ratios.push(peak / Math.max(0.05, before));
      }
      prev = cur;
    });
    const avg = ratios.reduce((a, b) => a + b, 0) / Math.max(1, ratios.length);
    results.kickVortex = {
      pass: ratios.length >= 6 && avg > 1.5,
      kicksMeasured: ratios.length,
      meanLocalCurlSpike: +avg.toFixed(2),
    };
  }

  // --- 4 + 5. the beautiful death, then the world wakes.
  // One timeline: 8s of music -> 26s of true silence -> music again.
  {
    const rock = renderSong("rock-e-minor").pcm;
    const gap = new Float32Array(26 * SR); // digital-zero room
    const r = mkRun(concat([rock.slice(0, 8 * SR), gap, rock]));
    drive(r, 8);
    const peakDye = totalDye(r.inst);
    drive(r, 25.5); // deep into the silence
    const deadDye = totalDye(r.inst);
    const wakesBefore = r.inst.wakes;
    const dyeBefore = totalDye(r.inst);
    drive(r, 4); // music returns
    const wokeDye = totalDye(r.inst);
    results.silence = {
      pass: peakDye > 20 && deadDye < peakDye * 0.05,
      peakDye: +peakDye.toFixed(1), deadDye: +deadDye.toFixed(2),
      deathRatio: +(deadDye / peakDye).toFixed(4),
    };
    results.wake = {
      pass: r.inst.wakes > wakesBefore && wokeDye > dyeBefore * 3 + 5,
      wakePlumes: r.inst.wakes - wakesBefore,
      dyeBefore: +dyeBefore.toFixed(2), dyeAfter: +wokeDye.toFixed(1),
    };
  }

  // --- 6. the drop slams the tank: rupture fires in the drop window
  {
    const r = mkRun(renderSong("edm-c-drop").pcm);
    const rupAt = [];
    let seen = 0;
    drive(r, 12, (inst, t) => {
      if (inst.ruptures > seen) { seen = inst.ruptures; rupAt.push(+t.toFixed(2)); }
    });
    const hit = rupAt.find((t) => t >= 7.3 && t <= 10.5);
    results.rupture = { pass: !!hit, rupturesAt: rupAt, dropAt: 7.5 };
  }

  const all = Object.values(results).every((r) => r.pass);
  console.log(`INKFLUID SUITE: ${all ? "ALL PASS" : "FAILURES"}`);
  for (const [k, v] of Object.entries(results)) console.log(k, v.pass ? "PASS" : "FAIL", v);
  return { all, results };
}
