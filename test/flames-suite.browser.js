// Flame Spectrum bench — does the fire actually mean anything?
//
//   window.__Flames = (await import('/src/flames.js')).Flames;
//   const src = await (await fetch('/test/flames-suite.browser.js')).text();
//   eval(src); await flamesSuite();
//
// (No import in this file: Vite's transform of fetched JS breaks eval.)
//
// The tests that matter for a METER (it must be readable as data, not just
// pretty fire):
//   mapping   a pure tone at band k must light column k and NOT its neighbours
//   monotone  flame height must rise with level (a meter that saturates lies)
//   pilots    silence = short guttering pilot flames, never a dead black panel
//   embers    kicks throw sparks; silence throws none
//
// Height is measured from the HEAT FIELD, not painted pixels: the field is the
// ground truth and the palette/upscale can't fool it.

function flameAnalyser(state) {
  return {
    getByteFrequencyData(a) {
      const s = state.spec;
      for (let i = 0; i < a.length; i++) a[i] = 0;
      if (s.silence) {
        // a real quiet room: a few LSBs of mic hiss, jittering per frame
        for (let i = 0; i < a.length; i++) a[i] = Math.max(0, Math.round(2 + Math.random() * 3 - (i / a.length) * 1.5));
        return;
      }
      if (s.tone != null) {
        // narrow tone centred on a bin, with realistic spectral leakage
        for (let d = -3; d <= 3; d++) {
          const i = s.tone + d;
          if (i >= 0 && i < a.length) a[i] = Math.round(255 * s.level * Math.exp(-(d * d) / 2));
        }
        return;
      }
      if (s.kick) {
        const beatPhase = (state.t * 120 / 60) % 1;
        const kick = Math.exp(-beatPhase * 18);
        for (let i = 0; i < a.length; i++) {
          a[i] = i < 6 ? Math.round(255 * (0.35 + kick * 0.6)) : i < 200 ? Math.round(255 * 0.25) : Math.round(255 * 0.08);
        }
      }
    },
  };
}

// column-wise flame height from the heat field (fraction of grid height)
function columnHeights(inst, gw, gh) {
  const BANDS = inst.level.length;
  const out = new Float32Array(BANDS);
  for (let b = 0; b < BANDS; b++) {
    const x0 = Math.floor((b / BANDS) * gw), x1 = Math.floor(((b + 1) / BANDS) * gw);
    let top = gh;
    for (let y = 0; y < gh; y++) {
      let hot = false;
      for (let x = x0; x < x1; x++) if (inst.heat[y * gw + x] > 0.12) { hot = true; break; }
      if (hot) { top = y; break; }
    }
    out[b] = (gh - top) / gh;
  }
  return out;
}

async function flamesSuite() {
  const Flames = window.__Flames;
  if (!Flames) throw new Error("pre-load: window.__Flames = (await import('/src/flames.js')).Flames");
  const cv = document.createElement("canvas");
  cv.width = 960; cv.height = 240;
  const ctx = cv.getContext("2d");
  const run = (spec, secs) => {
    const inst = new Flames();
    inst.cfg.sensitivity = 1.25;
    const state = { t: 0, spec };
    const an = flameAnalyser(state);
    let now = 1000;
    for (let i = 0; i < secs * 60; i++) { state.t += 1 / 60; now += 1000 / 60; inst.render(ctx, an, 960, 240, now); }
    return inst;
  };
  const results = {};

  // --- 1. band mapping: a tone in band k lights column k, not the neighbours
  const BANDS = 40;
  const probe = new Flames();
  const mapRows = [];
  let mapPass = true;
  for (const b of [2, 10, 20, 32]) {
    const bin = Math.round((probe.bandLo[b] + probe.bandHi[b]) / 2);
    const inst = run({ tone: bin, level: 0.9 }, 4);
    const gh = Math.max(64, Math.round(120 * inst.autoQuality));
    const hts = columnHeights(inst, 480, gh);
    let peak = 0, peakB = -1;
    for (let i = 0; i < BANDS; i++) if (hts[i] > peak) { peak = hts[i]; peakB = i; }
    const ok = Math.abs(peakB - b) <= 1; // exact column, +-1 for band-edge leakage
    if (!ok) mapPass = false;
    mapRows.push({ band: b, litColumn: peakB, height: +peak.toFixed(2), ok });
  }
  results.mapping = { pass: mapPass, detail: mapRows };

  // --- 2. monotonic: height must track level (no saturation, no dead zone)
  const levels = [0.15, 0.35, 0.6, 0.9];
  const heights = [];
  const bin = Math.round((probe.bandLo[10] + probe.bandHi[10]) / 2);
  for (const L of levels) {
    const inst = run({ tone: bin, level: L }, 4);
    const gh = Math.max(64, Math.round(120 * inst.autoQuality));
    heights.push(+columnHeights(inst, 480, gh)[10].toFixed(3));
  }
  let mono = true;
  for (let i = 1; i < heights.length; i++) if (heights[i] <= heights[i - 1]) mono = false;
  results.monotonic = { pass: mono, levels, heights, dynRange: +(heights[3] / Math.max(0.001, heights[0])).toFixed(2) };

  // --- 3. silence: pilot flames only — alive but low, and NO embers
  const sil = run({ silence: 1 }, 10);
  const gh = Math.max(64, Math.round(120 * sil.autoQuality));
  const sh = columnHeights(sil, 480, gh);
  let maxSil = 0, meanSil = 0;
  for (let i = 0; i < BANDS; i++) { maxSil = Math.max(maxSil, sh[i]); meanSil += sh[i] / BANDS; }
  results.silence = {
    pass: maxSil > 0.02 && maxSil < 0.3 && sil.embers.length === 0,
    maxHeight: +maxSil.toFixed(3), meanHeight: +meanSil.toFixed(3),
    embers: sil.embers.length, note: "alive (>0.02) but low (<0.3), zero embers",
  };

  // --- 4. kicks throw embers
  const kick = run({ kick: 1 }, 8);
  results.embers = { pass: kick.embers.length > 0, count: kick.embers.length };

  // --- 5. perf at the real panel size
  const perfInst = new Flames();
  const pc = document.createElement("canvas"); pc.width = 1920; pc.height = 480;
  const pctx = pc.getContext("2d");
  const st = { t: 0, spec: { kick: 1 } };
  const pan = flameAnalyser(st);
  let n = 1000;
  for (let i = 0; i < 60; i++) { st.t += 1 / 60; n += 16.7; perfInst.render(pctx, pan, 1920, 480, n); }
  const t0 = performance.now();
  for (let i = 0; i < 240; i++) { st.t += 1 / 60; n += 16.7; perfInst.render(pctx, pan, 1920, 480, n); }
  results.perf = { msPerFrame: +((performance.now() - t0) / 240).toFixed(3), at: "1920x480" };

  console.table(mapRows);
  console.log(results);
  return results;
}
window.flamesSuite = flamesSuite;
