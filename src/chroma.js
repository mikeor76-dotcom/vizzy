// chroma.js — pitch and harmony analysis. The moat.
//
// Everything else in this app reads ENERGY: how loud, how bassy, how sudden.
// This reads MUSIC: which pitch classes are sounding, what key we're in, how
// much harmonic tension is building, which notes are being played. Consumer
// visualizers don't do this, and it's what Harmony Wheel and Note-Fall are
// built on.
//
// Resolution is the whole game. The app's shared analyser is fftSize 2048 —
// 23.4Hz bins, when a semitone at C3 is 7.7Hz wide. You cannot tell C from C#
// down there. So this owns a dedicated 8192-point analyser (5.9Hz bins,
// semitone-resolving from ~C3 up), created lazily and attached to the passed
// analyser as `.hiRes`, so no mode signature changes and the twenty existing
// modes never pay for it.
//
// Verified against test/harness — real rendered music with declared ground
// truth, including a song that modulates key mid-track. Painted spectra can't
// test any of this: harmony IS harmonics.

const A4 = 440;
const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Krumhansl-Schmuckler key profiles: probe-tone ratings, the standard.
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const KEY_TAU = 11; // s — the key histogram's memory; must cover a full
// harmonic cycle (a 68bpm ballad's 4-bar progression is 14s long)
const DYN_DB = 38; // only the top 38dB of a frame is musical content
const LO_HZ = 130; // ~C3 — below this a bin is wider than a semitone
const HI_HZ = 5000; // above this it's cymbals and air, not pitch

function corr(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 1e-9 && db > 1e-9 ? num / Math.sqrt(da * db) : 0;
}

export class Chroma {
  constructor(opts = {}) {
    this.fftSize = opts.fftSize ?? 8192;
    this.tonality = 0; // peak-to-median dB spread — see _tonalGate
    this._gateEnv = 0;
    this._open = false;

    this.chroma = new Float32Array(12); // smoothed, vector-normalized 0..1
    this.raw = new Float32Array(12);
    this._acc = new Float32Array(12);
    this._accKey = new Float32Array(12); // register-weighted, for the key
    this._keyAcc = new Float32Array(12); // leaky pitch histogram for the key

    this.key = null; // "C" | ... | null while unsure
    this.keyMode = null; // "major" | "minor"
    this.keyConfidence = 0;
    this.keyPc = -1;
    this._cand = null; // challenger key, and how long it has been winning
    this._candFor = 0;
    this._best = { pc: -1, mode: null, score: 0 };

    this.tension = 0; // 0..1 — dissonance vs consonance
    this.percussive = 0; // 0..1 — broadband, pitchless (a drum hit)
    this.notes = []; // live note objects: {midi, vel, conf, state, age}
    this._nextId = 1;

    this._freq = null; // Float32Array(bins), dB
    this._binPc = null; // bin -> pitch class
    this._binW = null; // bin -> weight (0 outside the pitch window)
    this._binMidi = null;
    this._sr = opts.sampleRate ?? 48000;
    this._ready = false;
  }

  _prepare(sr) {
    const bins = this.fftSize >> 1;
    this._freq = new Float32Array(bins);
    this._binPc = new Int8Array(bins);
    this._binW = new Float32Array(bins);
    this._binKeyW = new Float32Array(bins);
    this._binMidi = new Float32Array(bins);
    this._sr = sr;
    for (let k = 0; k < bins; k++) {
      const hz = (k * sr) / this.fftSize;
      if (hz < LO_HZ || hz > HI_HZ) { this._binPc[k] = -1; continue; }
      const midi = 69 + 12 * Math.log2(hz / A4);
      this._binMidi[k] = midi;
      const near = Math.round(midi);
      // how close is this bin to a real semitone centre? Bins that fall
      // between semitones are mostly leakage — weight them down rather than
      // letting them smear energy into the wrong pitch class.
      const dev = Math.abs(midi - near);
      this._binPc[k] = ((near % 12) + 12) % 12;
      this._binW[k] = Math.max(0, 1 - dev * 2);
      // REGISTER WEIGHT, for the key histogram only. A key's tonic lives in
      // the bass and low-mid — that's what "the root" means — but the display
      // chroma weights every octave equally, so a busy lead two octaves up
      // outvotes the harmony by sheer bin count. (Measured: rock-e-minor's
      // E-pentatonic lead and its B chord between them made B the most
      // prominent class, and the detector duly said B minor.) The bass's own
      // fundamental is unresolvable even at 8192 — a semitone at 65Hz is
      // 3.6Hz, well under a 5.9Hz bin — but its SECOND harmonic lands in
      // 130-260Hz and carries the same pitch class, which is exactly this
      // window.
      this._binKeyW[k] = this._binW[k] * (hz < 420 ? 1 : hz < 950 ? 0.45 : 0.18);
    }
    this._ready = true;
  }

  // TONALITY GATE — chroma's own, deliberately NOT SilenceGate.
  //
  // SilenceGate asks "is there broadband mid content?", which is exactly right
  // for its job: separating room tone from a full band, where level alone
  // can't. But it is the wrong question here. A solo piano IS music and is
  // spectrally SPARSE — six live bins out of 361 — so its mean mid content
  // never clears the bar: measured on solo-piano-melody, the gate oscillated
  // between 0.3 and 0.5 and notes flickered in and out mid-note while their
  // spectral peak sat rock-steady at -30dB. A pure sine chord scored 0.01.
  //
  // The question chroma actually needs is "is there a PITCH here?", and the
  // answer is peak-to-median spread across the pitch band: a pitched sound
  // towers over its own noise floor; hiss and rumble do not. Scale-invariant,
  // so it needs no level calibration, and it rejects room tone by structure
  // rather than by volume.
  _tonalGate(dt) {
    const bins = this.fftSize >> 1;
    const loK = Math.max(2, Math.floor((LO_HZ * this.fftSize) / this._sr));
    const hiK = Math.min(bins - 1, Math.ceil((HI_HZ * this.fftSize) / this._sr));
    if (!this._samp) this._samp = new Float32Array(Math.ceil((hiK - loK) / 8) + 1);
    let n = 0, peak = -200;
    for (let k = loK; k < hiK; k += 8) {
      const db = this._freq[k];
      this._samp[n++] = db < -160 ? -160 : db; // -Infinity would poison the sort
      if (db > peak) peak = db;
    }
    for (let k = loK; k < hiK; k++) if (this._freq[k] > peak) peak = this._freq[k];
    const view = this._samp.subarray(0, n);
    view.sort();
    const median = view[n >> 1];
    const spread = peak - median;
    this.tonality = spread;
    this._peakDb = peak;
    const open = spread > 17 && peak > -72;
    this._open = open;
    this._gateEnv += ((open ? 1 : 0) - this._gateEnv) * Math.min(1, dt * (open ? 6 : 2));
    return { open, gate: this._gateEnv, sub: 0 };
  }

  // analyser: the HI-RES node (fftSize 8192). dt in seconds.
  update(analyser, dt) {
    if (!analyser) return this;
    const sr = analyser.sampleRate ?? 48000;
    // Adapt to whatever analyser we're actually handed. If the hi-res node is
    // missing (a mode forgot `needsChroma`, or an old build), this would
    // otherwise ask a 1024-bin analyser to fill a 4096-bin array: no throw,
    // just three quarters of the spectrum silently stale. Degraded pitch
    // resolution is survivable; reading garbage is not.
    const nBins = analyser.frequencyBinCount;
    if (nBins && nBins * 2 !== this.fftSize) {
      this.fftSize = nBins * 2;
      this._ready = false;
    }
    if (!this._ready || this._sr !== sr) this._prepare(sr);
    const bins = this.fftSize >> 1;
    if (this._freq.length !== bins) this._prepare(sr);
    analyser.getFloatFrequencyData(this._freq);

    const g = this._tonalGate(dt);

    // ---- fold the spectrum onto 12 pitch classes.
    //
    // The floor is RELATIVE to this frame's own peak, not an absolute -78dB.
    // That absolute version looked reasonable and quietly wrecked everything
    // downstream: there are ~350 bins per pitch class in the pitch band, so
    // every bin sitting one dB over the floor contributed ~1 each and summed
    // into a flat pedestal that dwarfed the actual notes. Measured on
    // rock-e-minor, pitch classes that are NOT IN THE SONG read 0.47-0.54 of
    // full, and the pedestal flattened every key correlation until D minor
    // beat D major by 0.009 — far too little for the detector to ever act on.
    // Only the top DYN_DB of the spectrum is musical content.
    const cut = this._peakDb - DYN_DB;
    this._acc.fill(0);
    this._accKey.fill(0);
    for (let k = 1; k < bins; k++) {
      const pc = this._binPc[k];
      if (pc < 0) continue;
      const db = this._freq[k];
      if (db < cut) continue;
      this._accKey[pc] += (db - cut) * this._binKeyW[k];
      // dB above that floor, not linear magnitude: linear power is dominated
      // by the loudest partial and a quiet inner voice vanishes entirely.
      // This is log-weighting — presence, not power.
      this._acc[pc] += (db - cut) * this._binW[k];
    }
    // normalize the VECTOR, never per-class: per-class auto-level is right for
    // a meter (each band ranges itself) and catastrophically wrong here — it
    // would drag every pitch class to full scale and erase the chord. What a
    // chord IS is the RELATIVE strengths within one frame.
    let mx = 1e-6;
    for (let i = 0; i < 12; i++) if (this._acc[i] > mx) mx = this._acc[i];
    for (let i = 0; i < 12; i++) {
      const v = g.gate * (this._acc[i] / mx);
      this.raw[i] = v;
      // fast attack / slow release: chords bloom and linger, as they sound
      const k2 = v > this.chroma[i] ? Math.min(1, dt * 10) : Math.min(1, dt * 1.5);
      this.chroma[i] += (v - this.chroma[i]) * k2;
    }

    // ---- percussiveness: spectral flatness (geometric/arithmetic mean).
    // A drum is broadband and pitchless; without this, every snare would
    // become a fake chord and every cymbal a fake note.
    let logSum = 0, linSum = 0, n = 0;
    for (let k = 8; k < Math.min(bins, 1400); k += 3) {
      const m = Math.pow(10, this._freq[k] / 20) + 1e-10;
      logSum += Math.log(m); linSum += m; n++;
    }
    const flat = n ? Math.exp(logSum / n) / (linSum / n) : 0;
    this.percussive += (Math.min(1, flat * 3.2) - this.percussive) * Math.min(1, dt * 12);

    // ---- harmonic tension: semitone friction vs fifths and thirds
    let dis = 0, con = 0;
    for (let i = 0; i < 12; i++) {
      dis += this.chroma[i] * this.chroma[(i + 1) % 12]; // minor 2nd
      dis += this.chroma[i] * this.chroma[(i + 6) % 12] * 0.7; // tritone
      con += this.chroma[i] * this.chroma[(i + 7) % 12]; // fifth
      con += this.chroma[i] * this.chroma[(i + 4) % 12] * 0.8; // major 3rd
      con += this.chroma[i] * this.chroma[(i + 3) % 12] * 0.6; // minor 3rd
    }
    const tRaw = dis + con > 1e-6 ? dis / (dis + con) : 0;
    this.tension += (tRaw * g.gate - this.tension) * Math.min(1, dt * 2);

    this._updateKey(dt, g);
    this._updateNotes(dt, g, bins);
    return this;
  }

  _updateKey(dt, g) {
    if (!g.open) {
      // never freeze on a stale guess: fade the label out instead
      this.keyConfidence = Math.max(0, this.keyConfidence - dt * 0.5);
      if (this.keyConfidence < 0.05) { this.key = null; this.keyMode = null; this.keyPc = -1; }
      return;
    }
    // A LEAKY pitch histogram over ~KEY_TAU seconds, accumulating RAW
    // per-class energy.
    //
    // Two things here were wrong and both were measured, not guessed:
    //   - Never accumulate the max-normalized DISPLAY vector: that makes every
    //     frame count equally and erases the tonic's whole statistical
    //     advantage — over G-Em-C-D each root gets a 1.0 in its own bar and
    //     the average goes flat. KS wants duration-AND-amplitude weighting.
    //   - A 5s window (the spec's guess, and mine) is far too short. A 68bpm
    //     ballad holds each chord for 3.5s, so 5s sees ONE AND A HALF CHORDS
    //     and the "key" is just whatever is sounding now: it read G major at
    //     t=5/10/15 and D major at t=20 — correctly describing the D chord in
    //     front of it, while failing the song. The window must span a whole
    //     harmonic cycle (14s for this ballad). A leaky integrator does that
    //     smoothly, in 12 floats instead of a 900-frame ring.
    const decay = Math.exp(-dt / KEY_TAU);
    const avg = this._keyAcc;
    // Percussion damping: a drum hit is broadband, so it adds energy to EVERY
    // pitch class at once — which flattens the key histogram, shrinks the
    // winner's margin, and drags confidence down on exactly the music people
    // actually play (drums on everything). Frames the flatness detector calls
    // percussive contribute far less to the KEY estimate; the display chroma
    // is untouched, so the wheel still moves with the hit.
    const keyW = dt * (1 - this.percussive * 0.65);
    for (let i = 0; i < 12; i++) avg[i] = avg[i] * decay + this._accKey[i] * keyW;
    this._keyT = (this._keyT || 0) + dt;
    if (this._keyT < 1.5) return; // needs some history before it means anything

    let bestScore = -2, bestPc = 0, bestMode = "major", second = -2, incScore = -2;
    const rot = new Float32Array(12);
    for (let pc = 0; pc < 12; pc++) {
      for (const [prof, mode] of [[KS_MAJOR, "major"], [KS_MINOR, "minor"]]) {
        for (let i = 0; i < 12; i++) rot[i] = prof[(i - pc + 12) % 12];
        const s = corr(avg, rot);
        if (pc === this.keyPc && mode === this.keyMode) incScore = s;
        if (s > bestScore) { second = bestScore; bestScore = s; bestPc = pc; bestMode = mode; }
        else if (s > second) second = s;
      }
    }
    this._best = { pc: bestPc, mode: bestMode, score: bestScore };
    // Confidence is for the DISPLAY: how much daylight over the field. A vague
    // passage correlates decently with several keys at once, and the wheel's
    // halo should say so.
    const conf = Math.max(0, Math.min(1, (bestScore - second) * 3.5)) * Math.min(1, Math.max(0, bestScore) * 1.6);
    this._provConf = conf; // the CURRENT best's confidence, locked or not

    if (this.keyPc === bestPc && this.keyMode === bestMode) {
      this._candFor = 0;
            // 1.6/s, not 0.7: the number was taking ~3s to reflect a margin the
      // detector had already measured — report what you know when you know it
      this.keyConfidence += (conf - this.keyConfidence) * Math.min(1, dt * 1.6);
      return;
    }
    // SWITCHING is a different question from confidence, and conflating them
    // was a real bug: gating the switch on `conf > 0.12` meant a challenger
    // needed daylight over the whole FIELD — but the field's runner-up is the
    // incumbent, and rival keys are inherently neck-and-neck (relatives share
    // all seven notes; parallels differ by one). Measured, D minor beat D major
    // 0.831 to 0.822 on jazz-keychange and could never take over, so a wrong
    // early lock was permanent. What matters is beating THE INCUMBENT,
    // sustained — margin over the field is not the challenger's problem.
    const same = this._cand && this._cand.pc === bestPc && this._cand.mode === bestMode;
    this._cand = { pc: bestPc, mode: bestMode };
    this._candFor = same && bestScore > incScore + 0.02 ? this._candFor + dt : 0;
    // First lock is quick; after that a challenger must hold ~4s or the label
    // flickers between relatives on every passing chord.
    const settleFor = this.key === null ? 1.2 : 4;
    if (this._candFor >= settleFor && bestScore > 0.1) {
      this.keyPc = bestPc;
      this.key = PC_NAMES[bestPc];
      this.keyMode = bestMode;
      this.keyConfidence = conf;
      this._candFor = 0;
    }
  }

  // ---- note tracking -----------------------------------------------------
  // Spectral peaks -> harmonic grouping -> semitone snap -> note lifecycle.
  _updateNotes(dt, g, bins) {
    for (const nt of this.notes) nt.seen = false;

    if (g.open && this.percussive < 0.62) {
      const peaks = [];
      const loK = Math.max(2, Math.floor((LO_HZ * this.fftSize) / this._sr));
      const hiK = Math.min(bins - 2, Math.ceil((HI_HZ * this.fftSize) / this._sr));
      for (let k = loK; k < hiK; k++) {
        const db = this._freq[k];
        if (db < -62) continue;
        if (db <= this._freq[k - 1] || db < this._freq[k + 1]) continue;
        // parabolic interpolation: the true peak sits between bins, and
        // rounding to the bin centre is a ~third of a semitone of error up here
        const a = this._freq[k - 1], b = db, c = this._freq[k + 1];
        const d = (a - c) / (2 * (a - 2 * b + c) || 1e-9);
        const midi = 69 + 12 * Math.log2((((k + d) * this._sr) / this.fftSize) / A4);
        peaks.push({ midi, db });
      }
      peaks.sort((x, y) => y.db - x.db);
      const top = peaks.slice(0, 14);

      // harmonic grouping: a struck note is a STACK — its 2nd partial is an
      // octave up, its 3rd a fifth above that. Report the fundamentals or
      // every single note becomes a fake chord.
      const funds = [];
      for (const p of top.sort((x, y) => x.midi - y.midi)) {
        let harmonic = false;
        for (const f of funds) {
          const ratio = Math.pow(2, (p.midi - f.midi) / 12);
          const nearInt = Math.round(ratio);
          if (nearInt >= 2 && nearInt <= 8 && Math.abs(ratio - nearInt) < 0.045) {
            f.support++;
            f.db = Math.max(f.db, p.db - 6);
            harmonic = true;
            break;
          }
        }
        if (!harmonic) funds.push({ midi: p.midi, db: p.db, support: 0 });
      }

      for (const f of funds) {
        const snapped = Math.round(f.midi);
        const dev = Math.abs(f.midi - snapped);
        if (dev > 0.35) continue; // between semitones = not a note
        // a real note has harmonic support; a lone peak is usually noise or
        // an artefact. This cap is also the graceful-degradation valve: dense
        // mixes yield FEWER, STRONGER notes rather than a spray of wrong ones.
        const conf = Math.max(0, Math.min(1, (f.db + 62) / 26)) * (f.support > 0 ? 1 : 0.45) * (1 - dev * 1.6);
        if (conf < 0.16) continue;
        let nt = this.notes.find((x) => x.midi === snapped);
        if (!nt) {
          nt = { id: this._nextId++, midi: snapped, vel: 0, conf: 0, state: "on", age: 0, seen: true };
          this.notes.push(nt);
        }
        nt.seen = true;
        nt.conf = Math.max(nt.conf * 0.7, conf);
        nt.vel = Math.max(nt.vel, Math.min(1, (f.db + 62) / 30));
      }
    }

    for (let i = this.notes.length - 1; i >= 0; i--) {
      const nt = this.notes[i];
      nt.age += dt;
      if (nt.seen) { nt.state = nt.age < 0.09 ? "on" : "hold"; nt.miss = 0; }
      else {
        nt.miss = (nt.miss || 0) + dt;
        nt.state = "release";
        nt.conf *= Math.max(0, 1 - dt * 3);
        if (nt.miss > 0.16) this.notes.splice(i, 1); // brief gaps aren't note-offs
      }
    }
    // hard cap: the display degrades to the strongest voices, never sprays
    if (this.notes.length > 8) {
      this.notes.sort((a, b) => b.conf - a.conf);
      this.notes.length = 8;
    }
  }

  // The best CURRENT guess before the lock. The detector always has a
  // leading candidate with a measured margin; hiding it behind "listening…"
  // for the first several seconds threw that information away. Displays show
  // it dimmed as an estimate — confidence is understood from the first bars,
  // and the eventual lock reads as the estimate firming up rather than a
  // verdict from nowhere.
  provisional() {
    if (this.key || !this._open || this._best.pc < 0 || (this._provConf ?? 0) <= 0.02) return null;
    return {
      label: `${PC_NAMES[this._best.pc]} ${this._best.mode === "minor" ? "MINOR" : "MAJOR"}`,
      confidence: this._provConf,
    };
  }

  // The relative key (A major <-> F# minor). Relatives share all seven notes,
  // which makes them THE classic "detector picked the wrong key" case — often
  // the detector and the listener are both right. Displays show this next to
  // the key so an ambiguous call reads as informed rather than wrong.
  relative() {
    if (this.keyPc < 0) return null;
    return this.keyMode === "major"
      ? { pc: (this.keyPc + 9) % 12, mode: "minor" }
      : { pc: (this.keyPc + 3) % 12, mode: "major" };
  }
  relativeLabel() {
    const r = this.relative();
    return r ? `${PC_NAMES[r.pc]} ${r.mode}` : "";
  }

  // convenience for displays
  keyLabel() {
    if (!this.key) return "";
    return `${this.key} ${this.keyMode === "minor" ? "MINOR" : "MAJOR"}`;
  }
  static pcName(pc) { return PC_NAMES[((pc % 12) + 12) % 12]; }
}

// The hi-res analyser. main.js attaches it to the shared analyser as `.hiRes`
// so modes need no new plumbing and benches can inject their own.
export function hiResOf(analyser) {
  return (analyser && analyser.hiRes) || analyser;
}
