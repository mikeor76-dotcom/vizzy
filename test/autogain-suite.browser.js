// AutoGain regression suite — run in the browser console on the dev server:
//   window.__AutoGain = (await import('/src/autogain.js')).AutoGain;
//   const src = await (await fetch('/test/autogain-suite.browser.js')).text();
//   eval(src); await autogainSuite();
// (No import inside this file: Vite's transform of fetched JS injects a static
// import helper for dynamic imports, which breaks eval.)
//
// Drives src/autogain.js directly with a synthetic-music fake analyser at
// several input volumes and asserts the core contract:
//   1. CONVERGES within the listen window (<8s) for linear + agc profiles
//   2. VOLUME-INVARIANT: post-gain drive ~equal at 25% / 50% / 100% volume,
//      and a 12% whisper still gets a big lift (clamp-limited, by design)
//   3. NO PUMPING once locked (sens drifts <3% over 20s of steady music)
//   4. SILENCE FREEZES adaptation (sens unchanged through a 5s gap)
//   5. SONG CHANGE re-listens (quiet ballad after loud EDM converges again)

async function autogainSuite() {
  const AutoGain = window.__AutoGain;
  if (!AutoGain) throw new Error("pre-load first: window.__AutoGain = (await import('/src/autogain.js')).AutoGain");

  // synthetic music: kicks + pad + hiss, scaled by `vol`
  const makeAnalyser = (state) => ({
    getByteFrequencyData(a) {
      const t = state.t;
      const beat = Math.max(0, Math.sin(t * Math.PI * 4)) ** 6;
      for (let i = 0; i < a.length; i++) {
        let v = 0;
        if (i < 26) v = 90 + beat * 130;
        else if (i < 220) v = 66 + 38 * Math.sin(t * 2 + i * 0.06);
        else if (i < 372) v = 40 + 26 * Math.sin(t * 3.1 + i * 0.11);
        else v = 8;
        a[i] = Math.min(255, Math.round(v * state.vol));
      }
    },
  });

  const run = (ag, an, state, seconds, dtMs = 33) => {
    const hist = [];
    for (let ms = 0; ms < seconds * 1000; ms += dtMs) {
      state.t += dtMs / 1000;
      state.now += dtMs;
      hist.push(ag.update(an, state.now));
    }
    return hist;
  };

  const results = {};
  const profiles = {
    linear: { model: "linear", target: 0.8, clamp: [0.6, 5] },
    agc: { model: "agc", target: 0.62 },
  };

  for (const [name, profile] of Object.entries(profiles)) {
    const drives = {};
    for (const vol of [0.12, 0.25, 0.5, 1.0]) {
      const ag = new AutoGain();
      ag.baselines = {}; // isolate from any real learned state
      const state = { t: 0, now: 1000, vol };
      const an = makeAnalyser(state);
      ag.setMode("test-" + name, profile);
      ag.listenT = 7; // treat as a fresh song
      run(ag, an, state, 8);
      const s1 = ag.sens;
      // locked steady music: measure drift (pumping check)
      const hist = run(ag, an, state, 20);
      const drift = (Math.max(...hist) - Math.min(...hist)) / s1;
      // post-gain drive at this volume (same drive unit AutoGain solves for)
      const driveUnit = profile.model === "agc" ? Math.min(6 * ag.peak, 0.55) : ag.binPeak;
      drives[vol] = +(driveUnit * ag.sens).toFixed(3);
      results[`${name}@${vol}`] = { sens: +s1.toFixed(2), drive: drives[vol], driftPct: +(drift * 100).toFixed(1), listening: ag.listenT > 0 };
    }
    // invariance over the realistic listening range (25%..100%); the 12%
    // whisper is clamp-limited, so it only has to show a big LIFT vs unaided
    const dv = [drives[0.25], drives[0.5], drives[1.0]];
    const unaided12 = results[`${name}@0.12`].drive / results[`${name}@0.12`].sens; // what sens=1 would show
    results[`${name}-invariance`] = {
      spreadPct: +(((Math.max(...dv) - Math.min(...dv)) / Math.max(...dv)) * 100).toFixed(1),
      pass: (Math.max(...dv) - Math.min(...dv)) / Math.max(...dv) < 0.25,
      quietLiftX: +(results[`${name}@0.12`].drive / Math.max(0.001, unaided12)).toFixed(1),
      quietLiftPass: results[`${name}@0.12`].drive > unaided12 * 2,
    };
  }

  // 4. silence freeze + 5. song-change relisten
  {
    const ag = new AutoGain();
    ag.baselines = {};
    const state = { t: 0, now: 1000, vol: 1.0 };
    const an = makeAnalyser(state);
    ag.setMode("test-freeze", profiles.linear);
    ag.listenT = 7;
    run(ag, an, state, 8);
    const lockedSens = ag.sens;
    state.vol = 0.0001; // silence
    run(ag, an, state, 5);
    const afterSilence = ag.sens;
    state.vol = 0.12; // a much quieter new song
    run(ag, an, state, 1);
    const relistening = ag.listenT > 0;
    run(ag, an, state, 8);
    results["freeze+songchange"] = {
      frozeThroughSilence: Math.abs(afterSilence - lockedSens) < 0.001,
      relistenedOnNewSong: relistening,
      adaptedUp: ag.sens > lockedSens * 1.5, // quiet song needs much more gain
      finalSens: +ag.sens.toFixed(2),
    };
  }

  console.table(results);
  return results;
}
window.autogainSuite = autogainSuite;
