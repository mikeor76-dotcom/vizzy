// Song bank — composed, deterministic, RENDERED music with declared ground truth.
//
// Every bench in this project until now hand-painted FFT arrays. That caught a
// lot, but it cannot catch what real audio does: spectral leakage, harmonic
// stacks, the analyser's own window and time-smoothing, real transient shapes,
// real harmony. Murmuration passed every synthetic test and still failed in the
// user's living room — that gap is this file's reason to exist. And key/chord
// detection simply cannot be verified honestly against painted spectra at all.
//
// These are SYNTHESIZED arrangements, not recordings: committable (it's code),
// bit-for-bit reproducible on any machine, and each one declares its own truth
// — bpm, key, the chord timeline, and every note event — so a bench can assert
// against what the music actually IS rather than against a guess.
//
// Samples are written directly into a Float32Array (no OfflineAudioContext):
// no async, no browser audio implementation in the loop, identical output
// everywhere.
//
//   import { renderSong, SONGS } from './harness/songbank.js'
//   const { pcm, truth } = renderSong('rock-e-minor');

export const SR = 48000;

// GROUND TRUTH NOTE — `bassHits` vs `bpm`.
// Every mode's beat detector fires on low-end TRANSIENTS, not on quarter
// notes, and a real snare has broadband noise with genuine low-end content:
// measured, three modes "over-detected" 144/min against a 120bpm song and
// were all correct — the song contains 150 percussive hits/min (3 kicks + 2
// snares per bar). Firing on the backbeat is right, and desirable. So songs
// declare every hit they contain and benches assert against THAT; `bpm` is
// musical metadata, not a detector target.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------- voices
// Each writes into `out` at sample offset `at`. Envelopes are real ADSR-ish
// exponential decays — a synthetic spectrum has no attack transient at all,
// and transients are exactly what every beat detector in this project keys on.

function kick(out, at, gain = 1) {
  const n = Math.round(0.28 * SR);
  for (let i = 0; i < n && at + i < out.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 14);
    const f = 45 + 95 * Math.exp(-t * 34); // pitch sweep: the "thump"
    const click = Math.exp(-t * 420) * 0.35; // beater click = broadband edge
    out[at + i] += (Math.sin(2 * Math.PI * f * t) * env + (Math.random() * 2 - 1) * click) * 0.9 * gain;
  }
}

function snare(out, at, gain = 1) {
  const n = Math.round(0.22 * SR);
  for (let i = 0; i < n && at + i < out.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 22);
    const tone = Math.sin(2 * Math.PI * 185 * t) * 0.5 + Math.sin(2 * Math.PI * 330 * t) * 0.3;
    const noise = (Math.random() * 2 - 1);
    out[at + i] += (tone * 0.4 + noise * 0.6) * env * 0.55 * gain;
  }
}

function hat(out, at, gain = 1, open = false) {
  const n = Math.round((open ? 0.18 : 0.045) * SR);
  let hp = 0, prev = 0;
  for (let i = 0; i < n && at + i < out.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * (open ? 18 : 90));
    const x = Math.random() * 2 - 1;
    hp = 0.85 * (hp + x - prev); // 1-pole highpass: hats live up top
    prev = x;
    out[at + i] += hp * env * 0.3 * gain;
  }
}

// RELEASE MATTERS, and not cosmetically. A voice that simply stops mid-decay
// leaves a step discontinuity in the waveform — a CLICK, broadband, which no
// real instrument makes. Measured: without this, every note in
// solo-piano-melody produced a phantom second onset ~40ms after it ended, and
// the note tracker was blamed for what the song bank was doing to it. `rel`
// fades the last 30ms to zero.
const rel = (t, dur) => Math.min(1, Math.max(0, (dur - t) / 0.03));

// bass: saw-ish (harmonic stack) — the thing chroma must fold to a pitch class
function bass(out, at, midi, dur, gain = 1) {
  const f = mtof(midi);
  const n = Math.round(dur * SR);
  for (let i = 0; i < n && at + i < out.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t * 90) * Math.exp(-t * 2.2) * rel(t, dur);
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * f * h * t) / h;
    out[at + i] += s * env * 0.22 * gain;
  }
}

// pad: the chord bed — sine partials, slow attack (no transient to false-trigger)
function pad(out, at, midis, dur, gain = 1) {
  const n = Math.round(dur * SR);
  for (let i = 0; i < n && at + i < out.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t * 3) * Math.min(1, (dur - t) * 4);
    let s = 0;
    for (const m of midis) {
      const f = mtof(m);
      s += Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 2 * t) * 0.16 +
        Math.sin(2 * Math.PI * f * 3 * t) * 0.07;
    }
    out[at + i] += (s / midis.length) * env * 0.3 * gain;
  }
}

// lead / piano: a struck tone with a real harmonic series + decay
function tone(out, at, midi, dur, gain = 1, bright = 1) {
  const f = mtof(midi);
  const n = Math.round(dur * SR);
  for (let i = 0; i < n && at + i < out.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t * 200) * Math.exp(-t * 3.4) * rel(t, dur);
    let s = 0;
    for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f * h * t) * (1 / (h * h)) * (h === 1 ? 1 : bright);
    out[at + i] += s * env * 0.34 * gain;
  }
}

// ---------------------------------------------------------------- chords
//
// REAL VOICINGS, and this is not pedantry — it decides whether the song is
// actually IN the key it claims. The first version took arbitrary slices of a
// note array, which dropped the root out of the audible register and doubled
// the third: "G major" rendered as B2-D3-G3-B3 — two B's and no G underneath —
// and its pitch histogram came out B:1.00 D:0.92 F#:0.71 G:0.61. That is a B
// minor triad, and the key detector said so, correctly, while being marked
// wrong. Root position, root doubled at the octave, everything inside C3-C5
// where the analyser can resolve semitones.
//   root = the bass note (its harmonics reinforce the root in the chroma band)
//   pad  = the sounding voicing
const CH = {
  Em: { root: 40, pad: [52, 55, 59, 64] }, //  E3 G3 B3 E4
  C: { root: 36, pad: [48, 52, 55, 60] }, //  C3 E3 G3 C4
  G: { root: 43, pad: [55, 59, 62, 67] }, //  G3 B3 D4 G4
  D: { root: 38, pad: [50, 54, 57, 62] }, //  D3 F#3 A3 D4
  Am: { root: 45, pad: [57, 60, 64, 69] },
  F: { root: 41, pad: [53, 57, 60, 65] },
  Cm: { root: 36, pad: [48, 51, 55, 60] },
  Ab: { root: 44, pad: [56, 60, 63, 68] },
  Eb: { root: 39, pad: [51, 55, 58, 63] },
  Bb: { root: 46, pad: [58, 62, 65, 70] },
  Dm: { root: 38, pad: [50, 53, 57, 62] },
  A7: { root: 45, pad: [57, 61, 64, 67] }, //  A C# E G
  Gm: { root: 43, pad: [55, 58, 62, 67] },
  Bbmaj: { root: 46, pad: [58, 62, 65, 70] },
  B: { root: 47, pad: [59, 63, 66, 71] }, //  B3 D#4 F#4 B4 — the V of E minor
};
const ROOT_PC = { Em: 4, C: 0, G: 7, D: 2, Am: 9, F: 5, Cm: 0, Ab: 8, Eb: 3, Bb: 10, Dm: 2, A7: 9, Gm: 7, Bbmaj: 10, B: 11 };

// ---------------------------------------------------------------- songs
// Each returns { duration, bpm, key, mode, chords[], notes[], keyChanges[], build }

export const SONGS = {
  // full band, driving, UNAMBIGUOUS key centre.
  // The progression ends on B (the V of E minor) resolving back to Em: B major
  // carries D#, E minor's leading tone, and that one note is the whole
  // difference between E minor and its relative G major. The first version was
  // Em-C-G-D — pure Aeolian, which shares all seven notes with G major and has
  // no leading tone at all. The detector called it G major and was arguably
  // RIGHT; a musician would have shrugged too. Ground truth has to actually be
  // true before it can judge anything.
  "rock-e-minor": () => {
    const bpm = 120, beat = 60 / bpm, bar = beat * 4, bars = 12;
    const prog = ["Em", "C", "G", "B"];
    const chords = [], notes = [], bassHits = [];
    const riff = [64, 67, 71, 67, 74, 71, 67, 64]; // E minor pentatonic
    const build = (out) => {
      for (let b = 0; b < bars; b++) {
        const t0 = b * bar, name = prog[b % 4];
        const at = (t) => Math.round(t * SR);
        pad(out, at(t0), CH[name].pad, bar * 0.98, 0.85);
        for (let q = 0; q < 4; q++) bass(out, at(t0 + q * beat), CH[name].root, beat * 0.9, 1);
        kick(out, at(t0)); kick(out, at(t0 + 2 * beat));
        bassHits.push(t0, t0 + 2 * beat);
        if (b > 0) { kick(out, at(t0 + 2.5 * beat), 0.7); bassHits.push(t0 + 2.5 * beat); }
        snare(out, at(t0 + beat)); snare(out, at(t0 + 3 * beat));
        bassHits.push(t0 + beat, t0 + 3 * beat);
        for (let e = 0; e < 8; e++) hat(out, at(t0 + e * beat / 2), 0.8, e === 7);
        if (b >= 4) { // the lead enters after the intro
          for (let e = 0; e < 8; e++) {
            const m = riff[(b * 3 + e) % riff.length];
            tone(out, at(t0 + e * beat / 2), m, beat * 0.45, 0.7);
            notes.push({ t: +(t0 + e * beat / 2).toFixed(3), dur: +(beat * 0.45).toFixed(3), midi: m });
          }
        }
      }
      for (let b = 0; b < bars; b++) chords.push({ t: +(b * bar).toFixed(3), name: prog[b % 4], pc: ROOT_PC[prog[b % 4]], notes: CH[prog[b % 4]].pad });
    };
    return { duration: bars * bar, bpm, key: "E", mode: "minor", chords, notes, bassHits, keyChanges: [], build, hasBeat: true };
  },

  // four-on-the-floor, a real drop — the loudest, densest case
  "edm-c-drop": () => {
    const bpm = 128, beat = 60 / bpm, bar = beat * 4, bars = 12;
    const prog = ["Cm", "Ab", "Eb", "Bb"];
    const chords = [], notes = [], bassHits = [];
    const build = (out) => {
      for (let b = 0; b < bars; b++) {
        const t0 = b * bar, name = prog[b % 4], at = (t) => Math.round(t * SR);
        const dropped = b >= 4; // bars 0-3 build, then the drop
        const g = dropped ? 1 : 0.45;
        pad(out, at(t0), CH[name].pad, bar * 0.98, 0.7 * g);
        for (let q = 0; q < 4; q++) {
          kick(out, at(t0 + q * beat), 1.1 * (dropped ? 1 : 0.6));
          bassHits.push(t0 + q * beat);
          bass(out, at(t0 + q * beat + beat / 2), CH[name].root, beat * 0.45, 1.1 * g); // offbeat
        }
        if (dropped) {
          snare(out, at(t0 + beat), 0.8); snare(out, at(t0 + 3 * beat), 0.8);
          bassHits.push(t0 + beat, t0 + 3 * beat);
        }
        for (let e = 0; e < 8; e++) hat(out, at(t0 + e * beat / 2 + beat / 4), 0.9 * g, false);
        if (dropped) for (let e = 0; e < 4; e++) { // saw stabs
          const m = CH[name].pad[2];
          tone(out, at(t0 + e * beat), m, beat * 0.3, 0.5, 1.6);
          notes.push({ t: +(t0 + e * beat).toFixed(3), dur: +(beat * 0.3).toFixed(3), midi: m });
        }
        chords.push({ t: +t0.toFixed(3), name, pc: ROOT_PC[name], notes: CH[name].pad });
      }
    };
    return { duration: bars * bar, bpm, key: "C", mode: "minor", chords, notes, bassHits, keyChanges: [], build, hasBeat: true };
  },

  // quiet verse / loud chorus — the WITHIN-SONG dynamics case that compressed
  // masters hide and that every contrast-stretcher in the app claims to find
  "ballad-g-major": () => {
    const bpm = 68, beat = 60 / bpm, bar = beat * 4, bars = 8;
    const prog = ["G", "Em", "C", "D"];
    const chords = [], notes = [], bassHits = [];
    // centres on G and returns to it: the first version was G-A-B-D-B-A-G-D,
    // which put two D's (the dominant, and the highest/loudest note) in every
    // phrase — the rendered song's most prominent pitch was D, so "G major"
    // was a label the audio didn't support
    const mel = [67, 71, 74, 71, 67, 64, 62, 67];
    const build = (out) => {
      for (let b = 0; b < bars; b++) {
        const t0 = b * bar, name = prog[b % 4], at = (t) => Math.round(t * SR);
        const chorus = b >= 4; // bars 0-3 verse (quiet), 4-7 chorus (loud)
        const g = chorus ? 1 : 0.3;
        pad(out, at(t0), CH[name].pad, bar * 0.98, 0.9 * g);
        bass(out, at(t0), CH[name].root, beat * 1.8, g);
        bass(out, at(t0 + 2 * beat), CH[name].root, beat * 1.8, g);
        kick(out, at(t0), 0.7 * g);
        snare(out, at(t0 + 2 * beat), 0.5 * g);
        bassHits.push(t0, t0 + 2 * beat);
        if (chorus) { kick(out, at(t0 + 2 * beat), 0.7); for (let e = 0; e < 8; e++) hat(out, at(t0 + e * beat / 2), 0.5); }
        for (let e = 0; e < 4; e++) {
          const m = mel[(b * 2 + e) % mel.length];
          tone(out, at(t0 + e * beat), m, beat * 0.8, 0.6 * g);
          notes.push({ t: +(t0 + e * beat).toFixed(3), dur: +(beat * 0.8).toFixed(3), midi: m });
        }
        chords.push({ t: +t0.toFixed(3), name, pc: ROOT_PC[name], notes: CH[name].pad });
      }
    };
    return {
      duration: bars * bar, bpm, key: "G", mode: "major", chords, notes, bassHits, keyChanges: [], build, hasBeat: true,
      sections: [{ t: 0, name: "verse", quiet: true }, { t: 4 * bar, name: "chorus", quiet: false }],
    };
  },

  // MODULATES mid-song: D minor -> F major. The credibility test for a key
  // detector — it must find the first key, find the second, and not flap in
  // between (the hysteresis assertion has nothing to bite on otherwise).
  "jazz-keychange": () => {
    // 16 bars, not 12: the B section must be LONG enough to observe a
    // keys-are-rare detector committing to the new key (the ~11s histogram
    // has to swing, then the challenger must hold ~7s — a 15s B section
    // ended before that could finish, through no fault of the detector)
    const bpm = 96, beat = 60 / bpm, bar = beat * 4, bars = 16;
    const A = ["Dm", "Gm", "A7", "Dm"], Bp = ["F", "Bbmaj", "C", "F"];
    const chords = [], notes = [], bassHits = [];
    const build = (out) => {
      for (let b = 0; b < bars; b++) {
        const t0 = b * bar, at = (t) => Math.round(t * SR);
        const inB = b >= 6;
        const name = inB ? Bp[b % 4] : A[b % 4];
        pad(out, at(t0), CH[name].pad, bar * 0.98, 0.95);
        bass(out, at(t0), CH[name].root, beat * 1.9, 1);
        bass(out, at(t0 + 2 * beat), CH[name].root + 7, beat * 1.9, 0.8);
        kick(out, at(t0), 0.6); snare(out, at(t0 + 2 * beat), 0.4);
        bassHits.push(t0, t0 + 2 * beat);
        for (let e = 0; e < 8; e++) hat(out, at(t0 + e * beat / 2), 0.35, e % 4 === 3);
        for (let e = 0; e < 3; e++) { // comping
          const m = CH[name].pad[1 + (e % 3)] + 12;
          tone(out, at(t0 + e * beat * 1.2), m, beat * 0.5, 0.45);
          notes.push({ t: +(t0 + e * beat * 1.2).toFixed(3), dur: +(beat * 0.5).toFixed(3), midi: m });
        }
        chords.push({ t: +t0.toFixed(3), name, pc: ROOT_PC[name], notes: CH[name].pad });
      }
    };
    return {
      duration: bars * bar, bpm, key: "D", mode: "minor", chords, notes, bassHits, build, hasBeat: true,
      keyChanges: [{ t: 0, key: "D", mode: "minor" }, { t: 6 * bar, key: "F", mode: "major" }],
    };
  },

  // no drums, one voice, exact MIDI truth — Note-Fall's precision/recall test
  "solo-piano-melody": () => {
    const bpm = 100, beat = 60 / bpm;
    const seq = [
      [60, 1], [62, 1], [64, 1], [65, 1], [67, 2], [65, 1], [64, 1], [62, 2],
      [60, 1], [64, 1], [67, 1], [72, 2], [71, 1], [67, 1], [64, 2], [60, 2],
    ];
    const notes = [];
    let t = 0.5;
    for (const [m, b] of seq) { notes.push({ t: +t.toFixed(3), dur: +(b * beat * 0.85).toFixed(3), midi: m }); t += b * beat; }
    const build = (out) => {
      for (const n of notes) tone(out, Math.round(n.t * SR), n.midi, n.dur, 1.1, 0.8);
    };
    return { duration: t + 1.5, bpm, key: "C", mode: "major", chords: [], notes, bassHits: [], keyChanges: [], build, hasBeat: false };
  },

  // percussion ONLY: the note tracker must find NOTHING here. (Highpassing a
  // full mix does not substitute — it leaves the pad's and lead's upper
  // partials, which are real pitches and SHOULD produce notes.)
  "drums-only": () => {
    const bpm = 120, beat = 60 / bpm, bar = beat * 4, bars = 8;
    const bassHits = [];
    const build = (out) => {
      for (let b = 0; b < bars; b++) {
        const t0 = b * bar, at = (t) => Math.round(t * SR);
        kick(out, at(t0), 1); kick(out, at(t0 + 2 * beat), 1);
        snare(out, at(t0 + beat), 0.9); snare(out, at(t0 + 3 * beat), 0.9);
        bassHits.push(t0, t0 + beat, t0 + 2 * beat, t0 + 3 * beat);
        for (let e = 0; e < 8; e++) hat(out, at(t0 + e * beat / 2), 0.85, e === 7);
      }
    };
    return {
      duration: bars * bar, bpm, key: null, mode: null, chords: [], notes: [],
      bassHits, keyChanges: [], build, hasBeat: true,
    };
  },

  // a quiet ROOM, not digital zero: the silence gate's actual adversary
  "room-tone": () => ({
    duration: 12, bpm: 0, key: null, mode: null, chords: [], notes: [], bassHits: [], keyChanges: [], hasBeat: false,
    build: (out) => {
      let lp = 0;
      for (let i = 0; i < out.length; i++) {
        const x = (Math.random() * 2 - 1) * 0.0016; // mic hiss
        lp += (x - lp) * 0.08;
        out[i] += lp * 1.6 + x * 0.4 + Math.sin(2 * Math.PI * 52 * i / SR) * 0.0007; // + HVAC rumble
      }
    },
  }),
};

// Render a song to mono PCM + its ground truth. Deterministic apart from the
// noise voices (hats/snare/room), which are noise by nature.
export function renderSong(name) {
  const spec = SONGS[name]();
  const pcm = new Float32Array(Math.ceil(spec.duration * SR));
  spec.build(pcm);
  // soft-clip: real masters are limited, and a clipped square wave would
  // spray harmonics that aren't in the music
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.tanh(pcm[i] * 0.9);
  const { build, ...truth } = spec;
  return { pcm, truth: { name, sampleRate: SR, ...truth } };
}

// Concatenate songs/silence into one timeline (for gap + wake tests).
// gapSec of true room tone between each — never digital silence.
export function medley(names, gapSec = 6) {
  const parts = names.map((n) => renderSong(n));
  const gapN = Math.round(gapSec * SR);
  const total = parts.reduce((s, p) => s + p.pcm.length + gapN, 0);
  const pcm = new Float32Array(total);
  const marks = [];
  let at = 0;
  for (const p of parts) {
    pcm.set(p.pcm, at);
    marks.push({ name: p.truth.name, start: at / SR, end: (at + p.pcm.length) / SR, truth: p.truth });
    at += p.pcm.length;
    const room = renderSong("room-tone").pcm;
    for (let i = 0; i < gapN; i++) pcm[at + i] = room[i % room.length];
    at += gapN;
  }
  return { pcm, marks, sampleRate: SR };
}
