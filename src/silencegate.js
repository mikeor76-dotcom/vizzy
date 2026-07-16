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
    // two-speed floor: follow DOWN fast; rise briskly while the signal hovers
    // near the floor (steady room tone, loud HVAC included — it converges and
    // gates out in seconds); rise barely at all when well above it. Music
    // never feeds the floor at all, or steady quiet music gets absorbed.
    const nearFloor = !musical && rawLoud < Math.max(0.016, this.floor * 2.5);
    this.floor += (rawLoud - this.floor) *
      Math.min(1, dt * (rawLoud < this.floor ? 2 : nearFloor ? 0.25 : 0.008));

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
