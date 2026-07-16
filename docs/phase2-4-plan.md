# Vizzy — Phase 2/4 + Pixel Quest Backlog + Real-Audio Harness (plan, 2026-07-16)

Execution plan for the four approved workstreams. Ordered by dependency, not by
size: the harness comes first because every workstream after it verifies
against it. Phase 3 (stereo/Vectorscope) stays parked until the UCA202 arrives.

Every ship keeps the established discipline: committed bench with numbers in
the commit message, version bump, push, release published (until the CI
workflow lands), memory updated with any new platform lesson.

---

## Workstream A — Real-audio test harness (first; everything downstream uses it)

**The problem it solves:** every bench so far hand-paints FFT arrays. That
caught a lot, but it can't catch what real audio does: spectral leakage,
harmonics, the analyser's Blackman window + time smoothing, real transient
shapes, real key/chord content. The Murmuration incident ("passes bench, fails
in the living room") was exactly this gap. Chroma/key detection (Workstream B)
is *impossible* to verify honestly without it.

**Design — three pieces, all committed under `test/harness/`:**

1. **Song bank (`songbank.js`)** — composed, deterministic, *rendered* music.
   Each song is a tiny arrangement (kick/snare/hats + bass line + chord pads +
   lead melody, proper ADSR envelopes, optional key changes) rendered offline
   via `OfflineAudioContext` into an AudioBuffer. Committable (it's code, not
   copyrighted recordings), reproducible, and each song declares its ground
   truth: BPM, key, chord timeline, note events. Bank: `rock-e-minor`,
   `edm-c-drop`, `ballad-g-major` (verse/chorus dynamics), `jazz-keychange`
   (Dm→F modulation, for key-detector hysteresis), `solo-piano-melody` (known
   MIDI sequence, for Note-Fall precision/recall).
2. **AnalyserSim (`analysersim.js`)** — a frame-exact reimplementation of
   AnalyserNode over a rendered AudioBuffer: 2048-sample windows (8192 for
   chroma), Blackman window, `smoothingTimeConstant` 0.55 to match main.js,
   dB→byte conversion per the WebAudio spec, `getFloat/ByteTimeDomainData` and
   `getByteFrequencyData` at any synthetic timestamp. This is what lets a
   bench step a mode frame-by-frame through *real* audio deterministically.
3. **Local-file path (`localfiles`)** — drop MP3/FLAC into `test/audio/`
   (gitignored); the harness decodes and runs the same way. For by-ear tuning
   passes with the user's own library — never committed, never required by CI.

**Deliverables:** the three modules + `test/realaudio-smoke.browser.js`: every
registry mode renders 20s of `rock-e-minor` and `ballad-g-major` and must (a)
paint (lit/colored pixels above floor), (b) move (frame-to-frame delta), (c)
sleep in the silence gap between songs where the mode has an idle contract.
Beat-detecting modes must land within ±15% of the song's true BPM.

**Estimated size:** one focused session, one release (can ride with B1).
**Risk:** AnalyserSim fidelity vs the real node — mitigated by a calibration
test comparing AnalyserSim output to a live AnalyserNode on the same buffer.

---

## Workstream B — Phase 2: musical intelligence (chroma → Harmony Wheel → Note-Fall)

### B1. `src/chroma.js` + bench (its own release)
Per the spec (docs/new-modes-spec.md §0.3):
- Dedicated 8192-fft analyser, lazily created; main.js grows a tiny
  `audioBus` so modes can request it (the shared 2048 analyser is untouched —
  zero impact on the 20 existing modes). The module also accepts injected
  frames so benches/harness can drive it.
- Chroma vector: bins 130Hz–5kHz folded to 12 pitch classes, magnitude-
  weighted, per-class slow-peak normalization behind the SilenceGate, attack
  ~10/s decay ~1.5/s.
- Key estimate: Krumhansl–Schmuckler over a ~5s chroma average, hysteresis
  (challenger must beat incumbent ~4s), `{key, mode, confidence}`.
- Note tracker (for Note-Fall): top-6 spectral peaks, harmonic grouping to
  fundamentals, semitone snap, onset/hold/release note objects, percussive
  flag for pitchless broadband hits.
- **Bench:** sine stacks (C-E-G → top-3 classes exactly), scale runs → key;
  then the harness's `jazz-keychange` song: correct initial key, correct key
  after modulation, no flapping in between; note tracker on
  `solo-piano-melody`: >90% onset precision, >70% two-voice recall, drum loop
  → zero note objects.

### B2. Harmony Wheel mode — `harmony` (Meters, its own release)
Circle-of-fifths ring (adjacent = consonant): petals bloom with chroma energy
(fast attack, ~1.5s linger); the chord polygon connects active classes (a
triad literally draws a rotating triangle); center hub shows the detected key
with a confidence halo (dim when unsure — never confidently wrong); left
panel: scrolling 12-lane chromagram ribbon (~30s of harmony as architecture);
right panel: harmonic-tension gauge (semitone-adjacency energy vs
fifths/thirds — rises on dissonance, falls on resolution); beat = 2-3% radial
pulse. Palettes: Spectral (hue/class), Gold Engraving, Nebula.
**Bench:** C-major in → triangle geometry out; petal decay timing; key label
correctness on harness songs; compressed-master legibility (petals keep
dancing); perf.

### B3. Note-Fall mode — `notefall` (Meters, its own release)
Vertical keyboard at the left edge (~4 octaves, auto-centered window that
*glides* with the music's register), notes born at their key as glowing bars,
extending right while held, scrolling left across the panel's full 1800px.
Percussive onsets = brief full-height shimmer columns (drums visible as
texture, never fake notes). Confidence dims uncertain notes — errors read as
atmosphere. Graceful degradation caps (~4 new onsets/frame, harmonic support
required). Palettes: pitch-class hue, register gradient (ember→ice), mono gold.
**Bench:** melody precision/recall against `solo-piano-melody` ground truth;
dense-mix degradation (fewer, stronger notes — capped, not sprayed); drums →
shimmer only; silence → empty roll, breathing keyboard; perf.

**Estimated size:** 3 releases. **Risks:** polyphonic tracking quality (hedged
by confidence-dimming + caps, per spec); key detection on ambiguous material
(hedged by the confidence halo).

---

## Workstream C — Phase 4: the physics showpieces (Cymatics → Ink Fluid)

### C1. Cymatics / Chladni plate — `cymatics` (Scenes, its own release)
Per spec §1.1: 8–12k sand grains on a dark plate; biased random walk with
step ∝ |field| (grains jitter off antinodes, settle on nodes — real cymatics);
field = superposition of the top 2-3 spectral peaks mapped to (m,n) plate
modes, semitone-quantized with ~150ms hysteresis so patterns actually form;
kick = plate tap (local scatter + re-settle ~1s); drop/rupture = full
re-scatter into the new pattern (the money shot); gate closed = grains hold
the last pattern, museum-still, slow glow breathing. Field evaluated on a
96×24 grid only on retarget; bilinear per grain. Auto-quality: grain count.
Palettes: Gold Sand, Iron Filings, Neon Cyan, Ember.
**Bench:** held 440Hz → nodal-line grain density ≥3× off-node within 4s (the
pattern demonstrably forms — plus a "formation half-life" metric as the tuning
dial); semitone-walk → retarget count matches hysteresis; silence → zero
retargets, agitation 0; perf.
**Known risk from the spec:** settle-speed *feel* (too fast = teleporting sand,
too slow = static). The bench metric exists precisely so tuning is measured.

### C2. Ink Fluid — `inkfluid` (Scenes, its own release)
**Prototype-first, per spec §1.3:** build the bare Stam solver (240×60 grid,
semi-Lagrangian advection, ~12 Jacobi iterations, vorticity confinement,
3 dye channels) and MEASURE before any visual polish. Mac budget ≤2.5ms/frame;
if the projected Pi cost fails, the declared fallback is curl-noise advection
(same look, half the cost) — decided by the measurement, not optimism.
Then: 7 mirrored bottom emitters (bass center) injecting palette-mapped dye
with upward impulse; kick = vortex ring; rupture = full-width swirl + a
palette-shifted dye slug; mids drive vorticity strength, treble fine jitter;
gate closed = injection stops, ink decays to black over ~20s (the beautiful
death), reopen = "world wakes" plume. Auto-quality: grid 240×60→160×40,
iterations 12→8. Palettes: Bioluminescent, Nebula, Sumi-e, Lava.
**Bench:** no blow-ups over 60s of metal (field stays finite), kick →
measurable curl spike, silence → total dye → ~0, frame-time report.

**Estimated size:** 2 releases. **Pi validation:** both ship `stable: false`
with auto-quality knobs; the user's panel is the final judge (same as all
Phase 1 modes — one evening of flipping through modes clears the list).

---

## Workstream D — Pixel Quest backlog

### D1. Wire the ~40 cameo events to their imported art (1-2 releases)
All 50 pack sprites are imported and registered; the events in
`pixelquest-events.js` still draw procedurally. Wire = set `def.asset` + swap
the procedural body for `drawSprite` at the computed position (debug page-2
flips green per event). Done in batches by pack — sky (7), ground (7), cast
(11), props (9), moon (3), neon (5), heroKit (8 — respects the existing
`heroShowpieces` gate) — verifying each batch headlessly via forced triggers
(`pq.events.start(def)`) + debug-screen inventory + screenshot spot checks.

### D2. Import the 9 animated prop strips (same release as a D1 batch)
All 9 confirmed still in `~/Desktop/pixelquest_drop`: lantern_flicker,
flower_sway, grass_sway, door_open_close, gate_open_close, cottage, signpost,
shrine, bridge. Add SHEET_SPECS entries (frame counts from the strips),
`bun run art:import`, upgrade the existing props to their animated versions
(fps ~2-4, magenta de-spill per the import pipeline's rules).

### D3. Biome-gating pass (decision point → 1 release)
The parked question: cameos currently fire anywhere; some read as wrong-world
(the snail complaint's cousin). **Default plan (overridable): keep ALL the
whimsy, but biome-gate it** — each event def gets a `biomes:` allowlist
(shark fins near starfall-shore water, arcade cabinets in arcade-ruins,
sky dragons anywhere, etc.), so surprises stay surprising *and* coherent.
Cut nothing without being told.

### D4. Real-music pacing pass (after A + D1-D3; by-ear with the user)
The old pixelquest-tuning-todo: with the harness's local-file path, run real
songs through Pixel Quest, log the event/choreography timeline against the
music, and tune `EVENT_TUNING` pacing. This one ends with the user watching
the panel — I tune, they judge.

---

## Order of execution

| # | Item | Ships as |
|---|---|---|
| 1 | A: harness (song bank + AnalyserSim + smoke) | v1.0.11 |
| 2 | B1: chroma.js + bench | v1.0.12 |
| 3 | B2: Harmony Wheel | v1.0.13 |
| 4 | B3: Note-Fall | v1.0.14 |
| 5 | C1: Cymatics | v1.0.15 |
| 6 | C2: Ink Fluid (solver prototype gate first) | v1.0.16 |
| 7 | D1+D2: cameo wiring batches + animated props | v1.0.17-18 |
| 8 | D3: biome-gating | v1.0.19 |
| 9 | D4: pacing pass with real music | tuning release(s) |

Rationale for the order: the harness multiplies the honesty of everything
after it and B1 cannot be verified without it; B before C because chroma is
the "premier" differentiator and C's risks are contained by prototype-first;
D is independent and safe to do last (or interleaved if a session wants a
change of pace). Each item is separately shippable — stopping after any row
leaves the appliance better than before it.

**Standing hedges:** every new mode ships `stable: false` until seen on the
panel; every self-governing mode uses SilenceGate + the (now-fixed) contrast
stretcher; every bench includes a compressed-master legibility case; if a
third mode needs the contrast stretcher it gets extracted to a module
(murmuration + lasers currently carry inline copies — rule of three).
