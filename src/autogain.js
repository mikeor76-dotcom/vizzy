// AutoGain — the hand on the sensitivity dial, automated. The slider is gone;
// this module listens to the music and drives every mode's cfg.sensitivity to
// the level where that mode looks best, re-adapting on song changes and mode
// switches.
//
// Per-mode PROFILE (registry `auto` field):
//   model:  "linear" — the mode scales the raw signal by sensitivity (meters,
//                      bars). Drive on peaks ≈ peak * sens.
//           "agc"    — the mode has its own internal peak-tracking gain
//                      (min(6, 0.55/peak) * sens — scenes). Drive on peaks
//                      ≈ min(6*peak, 0.55) * sens.
//   target: desired drive on peaks (0..1). The loop solves sens directly:
//           sens* = target / driveUnit — no integral windup, no hunting.
//   clamp:  [lo, hi] sensitivity bounds (defaults to the old dial's 0.5–2.5).
//
// Behavior timeline ("quick default, listen, adjust"):
//   mode switch  → apply that mode's learned BASELINE instantly, listen ~4s
//   song start   → re-listen ~7s (fast steps), then LOCK (slow drift only)
//   song change  → detected by a silence gap OR a sustained big level shift
//   silence      → adaptation frozen — never wind the gain up between songs
//   too hot      → clip guard: sens drops fast any time (fast-down/slow-up)
//
// Learned baselines persist to localStorage AND the kiosk server
// (/api/autogain), so a reboot starts at yesterday's converged values.

const STORE_KEY = "vizzy-autogain";
const DEFAULT_CLAMP = [0.5, 3];
const DEFAULT_SENS = 1.25;

export class AutoGain {
  constructor() {
    this.freq = new Uint8Array(1024);
    this.sens = DEFAULT_SENS;
    this.pinned = false; // ?sens= escape hatch: fixed value, no adaptation
    this.modeId = null;
    this.profile = null;

    // signal statistics
    this.peak = 0.05; // recent peak of BROADBAND loudness (the scenes' AGC measure)
    this.binPeak = 0.1; // recent peak of the LOUDEST BIN (what meters/bars display)
    this.rawLoud = 0;
    this.gate = false; // true = musical signal present
    this._silentMs = 0;
    this._songGap = false;

    // control state
    this.listenT = 0; // >0 = fast-adapt window (seconds remaining)
    this._lockPeak = 0.05; // peak level at lock time (for level-shift relisten)
    this._shiftMs = 0;
    this._lastNow = 0;
    this._saveTimer = 0;

    // learned per-mode baselines
    this.baselines = this.#loadLocal();
    this.#loadRemote(); // best-effort; merges when it arrives
  }

  #loadLocal() {
    try {
      const j = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
      return typeof j === "object" && j ? j : {};
    } catch {
      return {};
    }
  }
  async #loadRemote() {
    try {
      const r = await fetch("/api/autogain");
      if (!r.ok) return;
      const j = await r.json();
      if (j && typeof j === "object") {
        // server wins where localStorage is missing (kiosk Chromium drops it)
        for (const [k, v] of Object.entries(j)) {
          if (typeof v === "number" && v >= 0.4 && v <= 3 && this.baselines[k] == null) this.baselines[k] = v;
        }
        if (this.modeId != null && !this.pinned && this.baselines[this.modeId] != null && this.listenT > 0) {
          this.sens = this.baselines[this.modeId]; // late arrival, still listening — jump
        }
      }
    } catch {
      /* dev server / file hosting: no endpoint, localStorage carries it */
    }
  }
  #persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.baselines)); } catch {}
    try { fetch("/api/autogain", { method: "POST", body: JSON.stringify(this.baselines), keepalive: true }).catch(() => {}); } catch {}
  }

  pin(v) {
    this.pinned = true;
    this.sens = Math.min(3, Math.max(0.4, v));
  }

  setMode(modeId, profile) {
    this.modeId = modeId;
    this.profile = profile || null;
    if (this.pinned || !this.profile) return;
    const clamp = this.profile.clamp || DEFAULT_CLAMP;
    const base = this.baselines[modeId] ?? this.profile.start ?? DEFAULT_SENS;
    this.sens = Math.min(clamp[1], Math.max(clamp[0], base));
    this.listenT = 4; // music is already playing and stats are warm: short listen
  }

  // one call per frame with the live analyser; returns the current sensitivity
  update(analyser, now) {
    const dt = Math.min(0.1, this._lastNow ? (now - this._lastNow) / 1000 : 0.016);
    this._lastNow = now;
    if (this.pinned || !this.profile || !analyser) return this.sens;

    analyser.getByteFrequencyData(this.freq);
    let sum = 0;
    let maxBin = 0;
    for (let i = 1; i < 372; i += 3) {
      const v = this.freq[i];
      sum += v;
      if (v > maxBin) maxBin = v;
    }
    const rawLoud = sum / (124 * 255);
    this.rawLoud = rawLoud;
    maxBin /= 255;

    // ---- silence gate + song-gap detection --------------------------------
    if (rawLoud < 0.012) {
      this._silentMs += dt * 1000;
      if (this._silentMs > 2500) this._songGap = true;
      this.gate = false;
      return this.sens; // frozen: stats AND sens hold through silence
    }
    if (this._songGap && rawLoud > 0.02) {
      // a new song after a real gap: re-listen with fresh measurements
      // (threshold sits just above the silence floor so even a QUIET new song
      // — a ballad after an EDM set — reopens the listen window)
      this.listenT = 7;
      this.peak = rawLoud;
      this.binPeak = maxBin;
      this._songGap = false;
    }
    this._silentMs = 0;
    this.gate = true;

    // ---- level statistics ---------------------------------------------------
    // recent-peak tracker, faster decay while listening so a new song's level
    // is measured quickly instead of inheriting the previous song's peak
    const decay = this.listenT > 0 ? 0.3 : 0.035;
    this.peak = Math.max(this.peak * (1 - dt * decay), rawLoud, 0.02);
    this.binPeak = Math.max(this.binPeak * (1 - dt * decay), maxBin, 0.04);

    // sustained big level shift without a silence gap (DJ mix, radio segue):
    // treat as a song change and re-listen
    if (this.listenT <= 0) {
      const ratio = this.peak / Math.max(0.02, this._lockPeak);
      if (ratio > 2 || ratio < 0.5) {
        this._shiftMs += dt * 1000;
        if (this._shiftMs > 4000) {
          this.listenT = 5;
          this._shiftMs = 0;
        }
      } else this._shiftMs = 0;
    }

    // ---- solve for the sensitivity this mode wants -------------------------
    // linear modes DISPLAY per-bin values, so their drive unit is the loudest
    // bin's recent peak; agc scenes work on broadband loudness through their
    // own capped internal gain
    const p = this.profile;
    const clamp = p.clamp || DEFAULT_CLAMP;
    const driveUnit = p.model === "agc" ? Math.min(6 * this.peak, 0.55) : this.binPeak;
    const want = Math.min(clamp[1], Math.max(clamp[0], p.target / Math.max(0.01, driveUnit)));

    // ---- approach it EXPONENTIALLY (log-space): reaches any distance within
    // the listen window, scale-free across the whole clamp range, glacial when
    // locked — and always faster DOWN than up (clip guard) -------------------
    const listening = this.listenT > 0;
    const tau = want < this.sens ? (listening ? 0.5 : 10) : (listening ? 1.3 : 25);
    this.sens *= Math.pow(want / this.sens, Math.min(1, dt / tau));
    if (Math.abs(want - this.sens) < 0.005) this.sens = want;

    if (listening) {
      this.listenT -= dt;
      if (this.listenT <= 0) {
        // LOCK: remember the level we locked at, fold the converged value into
        // this mode's learned baseline, persist (debounced by the lock itself)
        this._lockPeak = this.peak;
        const prev = this.baselines[this.modeId];
        this.baselines[this.modeId] = Math.round(((prev == null ? this.sens : prev * 0.7 + this.sens * 0.3)) * 100) / 100;
        this.#persist();
      }
    }
    return this.sens;
  }

  status() {
    return {
      mode: this.modeId,
      sens: +this.sens.toFixed(3),
      pinned: this.pinned,
      listening: +this.listenT.toFixed(1),
      gate: this.gate,
      peak: +this.peak.toFixed(3),
      baselines: { ...this.baselines },
    };
  }
}
