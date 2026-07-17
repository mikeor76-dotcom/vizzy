// SilenceGate — "is real music playing right now?"
//
// Extracted from Ferrofluid, where it was the fix for a bug this project has
// now hit TWICE (Pixel Quest's phantom beats, then Ferrofluid pulsing in a
// silent room). Any mode that auto-levels per band eventually normalizes the
// room's NOISE FLOOR to full scale — then mic hiss and the air conditioner
// drive the visuals and transient detectors fire on nothing. Every
// self-governing mode needs this, so it lives here once.
//
// THE LESSON (the part that isn't obvious): level statistics ALONE cannot
// distinguish quiet steady music from steady room tone. They can have the
// same broadband level. What separates them is SPECTRAL: music has mid/high
// band content; hiss and HVAC rumble don't. That `musical` test is what
// stopped the floor tracker from eating ambient music.
//
// Usage:
//   this.gate = new SilenceGate();
//   const g = this.gate.update(freqBytes, dt);   // per frame, before anything
//   if (g.open) { ...adapt peak trackers... }    // NEVER adapt while closed
//   const v = Math.max(0, raw - g.sub);          // floor-subtract band values
//   target *= g.gate;                            // 0..1 smoothed envelope
//
// The contract in one line: while the gate is closed, silence must never wind
// the gain up, and nothing may count as a beat.

export class SilenceGate {
  constructor(opts = {}) {
    // Bin indices assume the project-standard fftSize 2048 @ ~48kHz
    // (1024 bins, ~23.4Hz each): 1-6 ≈ 23-140Hz, 11 ≈ 258Hz, 372 ≈ 8.7kHz.
    this.loBin = opts.loBin ?? 1;
    this.hiBin = opts.hiBin ?? 372;
    this.midBin = opts.midBin ?? 11; // where "musical" content starts
    this.musicalMin = opts.musicalMin ?? 0.014; // mid/high energy = music present
    this.openMin = opts.openMin ?? 0.012;

    this.floor = 0.008; // room-noise estimate (two-speed minimum tracker)
    this.gate = 0; // smoothed 0..1 envelope: 0 = silence, 1 = music
    this.open = false; // instantaneous decision
    this.musical = false;
    this.loud = 0; // raw broadband level this frame
    this.sub = 0.008 * 1.2; // floor-subtraction offset for band values
  }

  // freq: Uint8Array of byte frequency data. dt: seconds.
  update(freq, dt) {
    let sumAll = 0, sumMid = 0;
    for (let i = this.loBin; i < this.hiBin; i++) sumAll += freq[i];
    for (let i = this.midBin; i < this.hiBin; i++) sumMid += freq[i];
    const rawLoud = sumAll / ((this.hiBin - this.loBin) * 255);
    const rawMidHi = sumMid / ((this.hiBin - this.midBin) * 255);
    this.loud = rawLoud;

    const musical = rawMidHi > this.musicalMin;
    this.musical = musical;
    // Multi-speed floor. Music NEVER raises it — not even slowly. The original
    // let music creep the floor at 0.008/s "because it's negligible", and it
    // is not: measured, 16 seconds of loud music dragged the floor from 0.008
    // to 0.036, so the quiet verse that followed (0.061) fell under the open
    // threshold (0.064) and the mode went to sleep mid-song. Over a whole
    // playlist it would keep climbing. The floor tracks the ROOM, so only
    // non-musical audio may raise it; music may only ever pull it DOWN (a
    // quieter room is always believable).
    const nearFloor = !musical && rawLoud < Math.max(0.016, this.floor * 2.5);
    const rise = rawLoud < this.floor ? 2 // the room got quieter: follow it down
      : musical ? 0 // music: never
      : nearFloor ? 0.25 // steady room tone: converge and gate out in seconds
      : 0.008; // loud but non-musical (an HVAC surge): creep up
    this.floor += (rawLoud - this.floor) * Math.min(1, dt * rise);

    this.open = musical && rawLoud > Math.max(this.openMin, this.floor * 1.6 + 0.004);
    this.gate += ((this.open ? 1 : 0) - this.gate) * Math.min(1, dt * (this.open ? 4 : 2));
    this.sub = this.floor * 1.2;
    return this;
  }

  // convenience: floor-subtracted mean of a bin range, 0..1
  band(freq, lo, hi) {
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += freq[i];
    return Math.max(0, sum / ((hi - lo) * 255) - this.sub);
  }
}

// EnergyJump — "did the song just tear upward?" (a drop, a chorus arrival).
//
// Shared by Murmuration's chorus flash and Cymatics' plate rupture, and built
// for every future mode that wants a drop moment (Ink Fluid is next). Every
// clause is a measured lesson:
//
// - TWO SMOOTHED TRACKERS, ~0.6s vs ~4.5s. The fast one must bridge kick
//   gaps: at a 0.14s time constant the EDM drop's fast/slow ratio only spiked
//   for 0.18s, so a sustain requirement missed the drop and no sustain fired
//   on every lone kick pulse.
// - SUSTAIN. A drop stays loud; a kick pulse doesn't. 0.4s default.
// - RELATIVE LOUDNESS FLOORS. An absolute floor tuned on a hot EDM render
//   (0.22) meant a real ballad's chorus (fast tracker peaking 0.18, ratio
//   1.83) could never fire. Floors scale with the mode's own loudness peak.
// - SEEDED BASELINE. The slow tracker starting from zero inflates the ratio
//   for the first ~10s of any song — measured, a QUIET VERSE fired a "drop"
//   at 5.8s. On gate-open (after >2s of silence), both trackers snap to the
//   current level — deferred 0.5s so the analyser's own attack ramp isn't
//   recorded as the song's floor. Brief mid-song gate dips do NOT re-seed.
export class EnergyJump {
  // ratio 1.15 is CALIBRATED TO dB SPACE, not linear energy: `loud` is a
  // mean of the analyser's byte values, which are dB-scaled, so a doubling
  // of amplitude (+6dB) only reads ~1.3x here. Measured: the song bank's EDM
  // drop = 1.29 sustained, a ballad's chorus arrival = 1.83, steady drums
  // after seeding = 0.85..1.05. 1.45 "looked right" and was unreachable by a
  // real drop — it only ever fired off the unconverged zero baseline.
  constructor({ ratio = 1.15, sustain = 0.4, cooldown = 8 } = {}) {
    this.ratio = ratio;
    this.sustain = sustain;
    this.cooldown = cooldown;
    this.fast = 0;
    this.slow = 0;
    this._arm = 2.1; // >2 = will re-seed on next open (starts armed)
    this._openFor = 0;
    this._seeded = false;
    this._hot = 0;
    this._last = -1e9;
    this._t = 0;
  }

  // loud: raw broadband level. peak: the mode's own slow loudness peak.
  // open/gateEnv: from SilenceGate. Returns true exactly once per firing.
  update(loud, peak, open, gateEnv, dt) {
    this._t += dt;
    if (!open) {
      this._arm += dt;
      this._openFor = 0;
    } else {
      this._openFor += dt;
      if (this._arm > 2) {
        if (this._openFor > 0.5) {
          this.fast = this.slow = loud;
          this._seeded = true;
          this._arm = 0;
        }
      } else this._arm = 0;
    }
    this.fast += (loud - this.fast) * Math.min(1, dt * 1.7);
    this.slow += (loud - this.slow) * Math.min(1, dt * 0.22);
    const hot = this._seeded && this._arm === 0 && gateEnv > 0.5 &&
      this.slow > peak * 0.15 &&
      this.fast > this.slow * this.ratio &&
      this.fast > Math.max(0.08, peak * 0.25);
    // DRAIN on cold frames, don't zero: a seeded baseline leaves a real
    // drop's ratio nearer the line (measured 1.55 on the EDM drop), and kick
    // ripple dips it under for a frame or two — a hard reset erased 0.3s of
    // genuine accumulation each time and the drop was never detected.
    // Sustained cold still drains to zero in half the sustain window.
    this._hot = hot ? this._hot + dt : Math.max(0, this._hot - dt * 2);
    if (this._hot > this.sustain && this._t - this._last > this.cooldown) {
      this._hot = 0;
      this._last = this._t;
      return true;
    }
    return false;
  }
}
