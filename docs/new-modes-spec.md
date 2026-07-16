# Vizzy — New Visualization Specs (v1, 2026-07-16)

Design specs for the ten modes from the "premier visualizer" gap analysis, plus the
shared infrastructure they need. No code here — each spec is written to be handed to
an implementation session as-is.

**Platform ground rules (apply to every mode below):**

- 1920×480 ultrawide is the primary canvas; compose for the bar, verify at that size.
  Desktop is the secondary shape, not the design target.
- Canvas 2D, no `shadowBlur` ever. Glow = additive `lighter` overdraw (wide faint
  stroke/fill under a bright thin core).
- Simulation-based modes use the established auto-quality pattern (`frameAvg` EMA,
  degrade cheap knobs only, dead band 19–26ms).
- Every mode is idle-safe: silence must look *intentional* (settled, breathing,
  asleep) — never twitchy. The Ferrofluid lesson is law: **level statistics alone
  cannot distinguish quiet steady music from room tone; silence gating needs the
  spectral `musical` discriminator.**
- AutoGain rules: `linear` profile **only** for modes that display frequency-bin
  data directly; time-domain displays and feature-driven scenes are `auto: null`
  (self-governing) — the Wave lesson.
- Every mode ships with: ≥3 palettes (cycled via the existing `preset:cycle`
  action), a committed browser bench (`test/<mode>-suite.browser.js`, preload class
  on `window.__X`, fetch+eval, measure by COLOR not alpha), a perf number at
  1920×480, and registry `stable: false` until verified on the Pi.
- No new npm deps for any of these (Butterchurn stays the only exception in the app).

---

## 0. Shared infrastructure (build first — three small pieces)

### 0.1 `src/silencegate.js` — extract the Ferrofluid gate

The two-speed noise-floor tracker + `musical` discriminator + gate envelope in
`ferrofluid.js` `analyze()` is needed by at least five of the new modes. Extract it
into a small reusable class rather than re-deriving the lesson five times.

- **API:** `new SilenceGate()` → `gate.update(freqData, dt)` → returns/exposes
  `{ gate: 0..1, open: bool, floor, musical }`. Also `gate.sub(v)` helper for the
  floor-subtraction used before per-band normalization.
- Behavior identical to the shipped Ferrofluid version: floor follows down fast,
  rises briskly only while the signal hovers near it (never while `musical`), gate
  opens on `musical && rawLoud > max(0.012, floor*1.6 + 0.004)`, envelope ~4/s open
  ~2/s close. `musical = band(11,372)/width > 0.014`.
- Ferrofluid itself is refactored to consume it (behavior-identical; its bench must
  reproduce the shipped numbers: silence all-zeros, beatsPerMin ≈ BPM).
- **Consumers:** Cymatics, Ink Fluid, Laser Show, Murmuration, Harmony Wheel,
  Note-Fall (and Ferrofluid).

### 0.2 Stereo audio path (prereq for Vectorscope; benefits everything)

Today there is one `AnalyserNode` at `fftSize` 2048 fed by the mic. Additions:

- **Capture constraints:** request `channelCount: 2` alongside the existing
  `echoCancellation: false`; ensure `noiseSuppression: false` and
  `autoGainControl: false` are explicitly set. (Critical once line-in arrives —
  browser DSP would wreck a line-level signal, and Chrome AGC fights our AutoGain.)
- **Splitter path:** source → `ChannelSplitterNode` → `analyserL` / `analyserR`
  (`fftSize` 2048, time-domain consumers use `getFloatTimeDomainData`). The existing
  merged analyser stays untouched — every current mode is unaffected.
- **Capability flag:** `audio.stereo` = true when the track really has 2 channels
  *and* L/R buffers are not bit-identical (some mono devices report stereo).
  Re-evaluate over the first ~10s. Modes read the flag; the registry may mark a mode
  `stereoPreferred` so the UI can badge it "MONO SOURCE" when the flag is false.
- Lazy: the splitter path is only built the first time a stereo-consuming mode
  activates. Zero cost to the 15 existing modes.

### 0.3 `src/chroma.js` — pitch & harmony analysis (prereq for the two musical-intelligence modes)

- **Dedicated analyser:** a second `AnalyserNode` at `fftSize` 8192 (5.9Hz bins at
  48kHz), lazily created on first use, so the global 2048 analyser and every
  existing mode stay untouched. 8192 gives semitone resolution from ~C3 (130Hz) up;
  chroma is computed over 130Hz–5kHz — where harmony lives.
- **Chroma vector:** fold bin energies into 12 pitch classes (A440 reference,
  log-frequency mapping, magnitude-weighted), normalize against a slow per-class
  peak (AutoGain lesson applied per pitch class), smooth with attack ~10/s decay
  ~1.5/s so chords bloom and linger.
- **Key estimate:** correlate the 24 Krumhansl–Schmuckler major/minor profiles
  against a ~5s chroma average; expose `{ key, mode, confidence }`; hysteresis — a
  challenger key must beat the incumbent for ~4s before the display switches.
- **Note tracker (for Note-Fall):** spectral-peak picker (top ~6 peaks), harmonic
  grouping (peaks at ~n×f0 fold into the fundamental), snap to nearest semitone,
  note objects with onset/hold/release state. Percussive onsets (broadband flux
  with no stable pitch) are flagged separately so drums don't become fake notes.
- Consumes the SilenceGate; in silence the chroma vector decays to zero and the key
  display fades rather than freezing on a stale guess.
- **Bench:** synthesized sine stacks (C-E-G at 261.6/329.6/392Hz → top-3 classes
  must be C,E,G), scale runs for key detection, a known synthetic melody for the
  note tracker (targets: >90% onset precision monophonic, graceful degradation —
  fewer, stronger notes — on dense mixes).

### 0.4 Registry placement summary

| Mode | id | Category | AutoGain | Needs |
|---|---|---|---|---|
| Flame Spectrum | `flames` | Meters | `linear` t=0.8 | — |
| City Skyline EQ | `skyline` | Scenes | `linear` t=0.8 | — |
| Laser Show | `lasers` | Scenes | `null` + gate | — |
| Vector CRT | `vectorcrt` | Scenes | `null` (RANGE_*) | — |
| Murmuration | `murmuration` | Scenes | `null` + gate | — |
| Harmony Wheel | `harmony` | Meters | `null` (chroma self-norm) | 0.3 |
| Note-Fall | `notefall` | Meters | `null` | 0.3 |
| Vectorscope | `vectorscope` | Meters | `null` (RANGE_*) | 0.2 |
| Cymatics | `cymatics` | Scenes | `null` + gate | — |
| Ink Fluid | `inkfluid` | Scenes | `null` + gate | — |

---

## 1. Signature pieces

### 1.1 Cymatics / Chladni Plate — `cymatics` (Scenes)

**Pitch:** real standing-wave physics. Thousands of sand grains on a dark vibrating
plate migrate into the geometric nodal patterns of whatever frequencies are
playing; pitch changes visibly re-sculpt the pattern. Nobody else has this done
well in software.

**Visual design (1920×480):** one full-panel dark plate (brushed-anodized texture,
near-black) with a subtle machined border. Sand = 8–12k warm-white grains with a
faint additive glow; where grains accumulate (nodal lines) the lines brighten and
read as luminous engraved geometry. A kick "taps the plate": grains scatter locally
and re-settle over ~1s. On a drop/rupture the whole plate re-scatters and the new
pattern assembles — the signature moment.

**Physics model:** rectangular-plate standing waves. Field
`F(x,y) = Σ wᵢ · [cos(mᵢπx/W)cos(nᵢπy/H) − cos(nᵢπx̂/W)cos(mᵢπŷ/H)]` over the top
2–3 spectral peaks; the wide plate allows m up to ~12 across, n up to ~4 vertical
(aspect-corrected so cells stay near-square). Grains do a biased random walk with
step size ∝ |F| at their position — they jitter off antinodes and settle on nodes,
exactly like real sand. Evaluate F on a coarse grid (~96×24, recomputed only on
retarget) and bilinear-sample per grain.

**Audio mapping:**

| Signal | Effect |
|---|---|
| Dominant spectral peak (pitch) | selects (m,n) mode pair — higher pitch = finer pattern. Quantized to semitones with hysteresis: retarget only when the peak moves ≥1 semitone and holds ~150ms, else patterns never form |
| 2nd/3rd peaks (chord) | superposed secondary modes, weighted by energy |
| Kick transient | plate tap: burst of grain jitter, brightness flash on nodal lines |
| Drop / rupture | full re-scatter + assemble into the new pattern |
| Overall energy | grain agitation baseline + glow intensity |

**Silence/idle:** gate closed → retargeting frozen, agitation → 0, grains settle
and hold the last pattern like a museum piece; slow 8s glow breathing. No pattern
churn in room tone.

**Palettes:** Gold Sand · Iron Filings (cool silver, slight spike texture on
accumulations) · Neon Cyan · Ember.

**Perf:** 8–12k grains × (1 bilinear sample + 1 walk step) ≈ well under 2ms; grid
recompute only on retarget. Auto-quality knob: grain count 12k→5k. Typed arrays,
zero per-frame allocation.

**Bench:** feed a held 440Hz sine → assert grain density along predicted nodal
lines ≥3× off-node density within 4s (pattern actually forms); semitone-walk input
→ retarget count matches (hysteresis works); silence → agitation 0, zero retargets.

**Risks:** the look lives or dies on settle speed — too fast reads as teleporting,
too slow reads as static. Budget a tuning pass with the bench reporting
"pattern-formation half-life." **Effort: L** (physics is easy; feel is the work).

### 1.2 Vectorscope / Goniometer Suite — `vectorscope` (Meters, `stereoPreferred`)

**Pitch:** the studio-legend stereo display: L drives X, R drives Y (rotated 45° so
mono = vertical line), and real music draws living Lissajous calligraphy. Flanked
by pro metering. This is the flagship payoff of the line-in purchase.

**Visual design (1920×480):** instrument-cluster layout. Center-left: the
goniometer in a 440×440 round bezel — the XY trace drawn as a connected polyline
with phosphor persistence (previous frame faded by ~0.2 alpha, same technique as
Wave) and additive glow; graticule = faint L/R diagonals + mono vertical.
Right of it, a rack of instruments filling the remaining ~1300px:
correlation meter (−1…+1 horizontal bar, green at +1 through amber 0 to red −1,
with a slow-average marker), L/R peak+RMS bar pair with peak-hold pips, a stereo
*width history* strip chart (last 60s), and a slim 31-band RTA with peak-hold —
the classic pro-audio wall.

**Audio mapping:** direct signal display — `getFloatTimeDomainData` from
`analyserL`/`analyserR` (2048 samples ≈ 43ms window), plotted per frame.
Correlation = Pearson over the window, smoothed ~2/s. Auto-range: the shared
RANGE_* slow excursion normalizer from `wave.js` applied to XY radius — loud songs
fill ~60% of the bezel, quiet songs stay visible, dynamics preserved.

**Mono behavior:** when `audio.stereo` is false the mode still runs honestly (a
vertical line that dances) with a small "MONO SOURCE" tag in the bezel — it becomes
a self-advertisement for plugging in the line-in.

**Silence/idle:** trace collapses to a breathing center dot; meters at rest with
peak-holds decaying. No gate needed — it displays the actual signal.

**Palettes:** Phosphor Green (classic) · Ice Blue · Amber CRT · White-hot.

**Perf:** one 2048-point polyline + rects ≈ <0.6ms. **Bench:** synthesize known
L/R pairs — identical signals → correlation +1 and a vertical trace (column-pixel
histogram), inverted → −1 and horizontal, 90°-phase sines → a circle (trace
bounding box ~square); assert RTA band peaks land on synthesized tones.
**Effort: M** (+ the 0.2 infra). **Risks:** none technical; ship after line-in
arrives or it demos as a diagonal line.

### 1.3 Ink Fluid — `inkfluid` (Scenes)

**Pitch:** music injects luminous ink into dark water. Bass blooms heavy slow
plumes, treble stipples fine turbulence, a drop slams a vortex through the whole
tank. The "premier" showpiece for slow, beautiful material.

**Visual design (1920×480):** full-panel dark fluid. Seven emitters along the
bottom edge in the Ferrofluid mirrored-spectrum arrangement — bass at center,
treble toward the edges — each injecting dye colored by its band. Dye is
multi-channel (3 dye fields mapped through the palette) so colors *mix physically*
where plumes collide instead of averaging to mud. Rendered soft: simulate coarse,
upscale with smoothing — the blur is the aesthetic.

**Simulation:** Stam stable fluids on a 240×60 grid (matches the 4:1 aspect):
semi-Lagrangian advection of velocity + 3 dye channels, ~12 Jacobi pressure
iterations, vorticity confinement for liveliness, mild dye dissipation so the tank
never saturates. Float32Arrays, zero allocation, rendered via `putImageData` to a
240×60 offscreen → `drawImage` upscaled.

**Audio mapping:**

| Signal | Effect |
|---|---|
| Per-band level (7 mirrored bands, floor-subtracted, per-band normalized) | dye injection rate + upward impulse at that emitter |
| Kick transient | vortex-ring impulse from the bass emitters (visible ring swirl) |
| Drop / rupture | full-width swirl impulse + a palette-shifted dye slug |
| Mid energy | vorticity-confinement strength (how much it curls) |
| Treble | fine velocity jitter (surface shimmer) |

**Silence/idle:** gate closed → injection stops; the existing ink keeps advecting,
diffusing, and fading to black over ~20s — a gorgeous natural decay — then near-still
darkness with the faintest drift. Gate reopens → first plume is the "world wakes"
moment.

**Palettes:** Bioluminescent (deep blue/cyan/white) · Nebula (violet/magenta/gold)
· Sumi-e (white ink, paper-dark water) · Lava (black/red/amber).

**Perf:** 14.4k cells; advection + 12 Jacobi + putImageData ≈ 1.5–2.5ms estimated —
the riskiest budget in this document. Auto-quality: grid 240×60→160×40 and
iterations 12→8. **Bench:** dye conservation sanity (no blow-ups over 60s of metal),
kick → measurable vortex (curl spike), silence → total dye trends to ~0, frame-time
report. **Effort: L.** **Risks:** Pi frame cost — prototype the solver first and
measure before polishing visuals; if 2D fluid can't hold 60fps on the Pi, fall back
to curl-noise advection (fake fluid, same look, half the cost).

---

## 2. Musical intelligence

### 2.1 Harmony Wheel — `harmony` (Meters)

**Pitch:** the mode that proves the platform *understands* music. The spectrum
folded to 12 pitch classes on a circle-of-fifths ring: chords bloom as glowing
geometric shapes, key changes rotate the whole constellation. Consumer visualizers
don't do harmony; this is moat.

**Visual design (1920×480):** three-panel cluster. Center: the wheel (~440px) —
12 petals in circle-of-fifths order (C,G,D,A…) so consonant harmony is *adjacent*;
petal brightness/length = chroma energy (fast attack, ~1.5s decay so chords
linger). Inside the ring, the **chord polygon**: active pitch classes connected
through the interior — a major triad literally draws a bright triangle that rotates
as the progression moves. Center hub: detected key ("A MINOR", small caps, subtle)
with a confidence halo; on key change the ring's home marker glides around the
circle. Left panel: scrolling 12-lane chromagram ribbon (the last ~30s of harmony
as colored lanes — you *see* the chord progression as architecture). Right panel:
harmonic-tension gauge (energy in semitone-adjacent class pairs vs fifths/thirds —
rises on dissonance, falls on resolution; genuinely tracks musical tension) plus
the last few key changes as a faded trail.

**Audio mapping:** entirely from `chroma.js` (0.3): chroma vector → petals/ribbon,
key estimate → hub, tension metric → gauge; beat (bass flux, Ferrofluid-style) →
gentle 2–3% radial pulse of the ring. Silence: gate → petals decay to a faint
outline ring, key label fades out (never freezes stale).

**Palettes:** Spectral (hue per pitch class, 30°/class) · Gold Engraving
(monochrome, energy only — the classy one) · Nebula.

**Perf:** trivial (<0.5ms) — 12 petals, one polygon, two side panels of rects.
**Bench:** rides 0.3's bench (chord/key assertions) + petal-decay timing and a
"C major in, triangle out" geometric assertion. **Effort: M** once 0.3 exists.
**Risks:** key detection on ambiguous material — mitigated by the confidence halo
(low confidence = dim label, never a confident wrong answer).

### 2.2 Note-Fall — `notefall` (Meters)

**Pitch:** the music transcribing itself in real time — a live piano-roll written
at the left edge and scrolling away, Synthesia in reverse.

**Visual design (1920×480):** a vertical keyboard at the left edge (~4 octaves,
auto-centered on the active register — the window glides when the music moves
register, never jumps). Detected notes are born at their key as rounded glowing
bars, extend rightward while held, then scroll left across the full 1800px of
history — the ultrawide is *made* for this. Octave stripes shade lanes; C lines
are faintly marked. Percussive onsets (no stable pitch) render as brief full-height
shimmer columns in the background — drums are visible as texture but never pollute
the roll with fake notes. Note-off releases a small particle wisp.

**Audio mapping:** entirely from `chroma.js`'s note tracker: note on/hold/off →
bars; note confidence → brightness (uncertain notes are dim, so errors read as
atmosphere, not mistakes); percussive-onset flag → shimmer columns; overall energy
→ scroll-lane background glow. Silence: roll scrolls to empty, keyboard breathes.

**Honest scope (acceptance criteria):** clean monophonic material (voice, lead
lines, bass lines, solo piano) tracks convincingly; dense polyphonic mixes must
degrade *gracefully* — cap simultaneous onsets (~4/frame), require harmonic
support, prefer showing fewer, stronger notes over spraying garbage. The bench's
two-voice recall target is 70%; below that the cap, not the user, eats the error.

**Palettes:** Pitch-class hue · Register gradient (low=ember → high=ice) ·
Monochrome gold.

**Perf:** dozens of rounded rects + one keyboard = <1ms. **Bench:** synthetic MIDI
melody (sines with ADSR) → onset precision >90% / pitch accuracy >95% mono, >70%
recall two-voice; drum loop → zero note objects (all shimmer). **Effort: L**
(tracker tuning dominates). **Risks:** it's the most algorithmically ambitious
mode; the confidence-dimming + graceful-degradation design is the hedge.

---

## 3. Ultrawide-native

### 3.1 City Skyline Equalizer — `skyline` (Scenes)

**Pitch:** a night city where the *lights* are the meter. Architecture stands
still; energy climbs the towers as lit windows. Analytical data wearing a cinematic
costume — the bridge between Meters and Scenes.

**Visual design (1920×480):** a full-width skyline silhouette, ~56 buildings of
varied width/height/roofline (water towers, antennas, a crane) generated once per
palette seed — **buildings never bounce; only light moves** (bouncing buildings are
kitsch; this is the load-bearing design decision). Each building = one log-spaced
frequency band, arranged mirrored like Ferrofluid: downtown bass towers at center,
treble low-rises toward the edges — "downtown thumps" reads instantly. Windows
light floor-by-floor with band level (LED-meter logic per building); the peak-hold
is a penthouse light that flashes then decays floor by floor. Foreground: a highway
strip with headlight/taillight streams whose speed follows detected tempo. Sky:
moon, slow clouds, stars; a kick fires a distant sky-glow pulse (occasional
lightning silhouette at high energy). Below: a dark river running the panel's full
width with rippled window reflections (cheap flipped-gradient strips, Aurora's
technique).

**Audio mapping:**

| Signal | Effect |
|---|---|
| 56 log bands (mirrored) | windows lit per building, bottom-up |
| Per-band recent peak | penthouse peak-hold light |
| Kick | sky-glow pulse; window-flicker ripple outward from downtown |
| Tempo | traffic speed |
| Sustained treble | a plane crossing / shooting star |
| Energy trend (slow) | sky tint warms/cools; more windows "occupied" |

**Silence/idle:** the city sleeps — windows fade to a sparse random scatter of
night owls, traffic thins to nothing, stars sharpen. Wake = windows flicker on
block by block (a beat to savor).

**Palettes:** Midnight Amber · Cyberpunk Neon · Blackout Storm (near-dark +
lightning) · Dawn.

**AutoGain:** `linear` target 0.8 — this is exactly the frequency-bin display the
linear profile exists for. Silence handling comes free (AutoGain freezes, levels
die, city sleeps).

**Perf:** window grid = batched fillRects over a cached skyline offscreen; ~2–4k
small rects worst case ≈ ~1ms. **Bench:** band→building mapping correctness (tone
at f lights exactly building k), peak-hold decay timing, sleep state = window count
below threshold. **Effort: M.**

### 3.2 Laser Show — `lasers` (Scenes)

**Pitch:** a concert lighting rig aimed at the audience, run by a virtual light
jockey who listens the way MilkDrop's director does. Beams, fans, tunnels, haze.

**Visual design (1920×480):** darkness + haze (large soft radial washes). Three
emitter clusters: bottom-left, bottom-right, center behind a low stage-truss
silhouette. Beams = additive polylines (wide 12% halo + 2px core) with bright
scatter dots where beams "hit haze." Cue vocabulary: symmetric fans (5–9 beams
sweeping), crossed scissors L/R, tunnel (concentric polygon outlines zooming from
center — devastating on an ultrawide), Lissajous scan figures, slow single-beam
sweep, mirror-ball moment (dozens of static faint rays + drifting specks), color
chase along a fan.

**Choreography engine (the real spec):** a light-jockey state machine directly
reusing the MilkDrop director's inputs:每 *pattern* = a cue sequence; **beat**
advances the cue (fan flips direction, scissors cross); **section change**
(bass-flux drop / post-silence new song) cuts to a new pattern + palette;
**energy** scales beam count/sweep speed; **quiet passage** dissolves to the
single-slow-beam cue. Patterns hold 16–64 beats so the show has phrasing, not
chaos.

**Photosensitivity cap (non-negotiable):** sustained full-field flashing is capped
at 3Hz (WCAG guidance); strobe cues are brief bursts with enforced cool-downs. The
cap lives in the engine, not per-cue, so no future cue can violate it.

**Silence/idle:** gate closed → beams retract to one faint static fan through
breathing haze — a rig at rest, roadies gone home.

**Palettes:** Club RGB · Emerald Mono (single green laser — the most authentic) ·
Sunset (amber/magenta) · UV Violet.

**AutoGain:** `null` + SilenceGate (feature-driven). **Perf:** ≤80 glowing
polylines + a few gradients ≈ ~1.5ms. **Bench:** beats → cue-advance count matches
BPM, section changes → pattern changes, flash-rate audit over a metal run (must
never exceed the cap — this is a *safety assertion*), silence → single-fan state.
**Effort: M.**

---

## 4. Retro / physical charm

### 4.1 Vector CRT — `vectorcrt` (Scenes)

**Pitch:** an Asteroids/Tempest-era vector monitor doing oscilloscope-music art:
everything drawn as a single luminous beam with real phosphor persistence, vertex
dwell-glow, and feedback bloom.

**Visual design (1920×480):** pure black screen, subtle barrel-distortion applied
to all geometry (precomputed warp on vertices, not pixels), faint bezel vignette.
Content rotates by song section (reusing the MilkDrop director triggers):
(a) rotating wireframe solid (cube → icosahedron as energy rises) whose vertices
jitter with treble; (b) the live waveform bent into a closed shape outline (a
radial waveform ring morphing between shape targets); (c) band-phase Lissajous
curves; (d) the spectrum as a single-stroke mountain skyline. Kick = scale-punch +
beam-brightness flash. Phosphor: previous frame faded ~0.2 alpha *through an
offscreen feedback pass with 0.3% zoom* — the classic trail-bloom (never draw a
canvas onto itself directly; bounce via the offscreen).

**Vertex dwell:** bright dots at path vertices (where a real vector beam pauses) —
this one detail sells the illusion more than anything else.

**Audio mapping:** time-domain float samples (waveform content) + frequency bands
(shape energy/jitter) + the RANGE_* excursion consts from `wave.js` for
self-governing amplitude. Kick from bass flux.

**Silence/idle:** the beam parks as a slowly drifting standby dot with a faint
burn-in ghost of the last figure — deeply CRT.

**Palettes:** P1 Green (white-hot core → green glow) · P7 Blue/amber-decay ·
Amber Mono.

**Perf:** a few hundred line segments + one feedback drawImage ≈ 1–2ms. **Bench:**
persistence half-life measurement, dwell-dot presence at vertices, silence = dot
only, RANGE governance (quiet vs loud fills 30%/60% target band). **Effort: M.**

### 4.2 Flame Spectrum — `flames` (Meters)

**Pitch:** the beloved classic fire-equalizer, executed with real fire dynamics
instead of scaled flame sprites. The crowd-pleaser and the cheapest win in this
document — build first.

**Visual design (1920×480):** 40 log-spaced band columns across the full width
(traditional bass-left — this one *is* an EQ and should read like one), each a
flame rising from a dark hearth line. Fire = the classic heat-field cellular
automaton at 480×120 quarter-res (heat injected at each column base ∝ band level;
propagate upward with cooling + lateral wind jitter; palette-map heat) upscaled
with smoothing. Bass flames are broad and rolling (low cooling), treble flames
thin and flickery (high cooling, more jitter). Kick = heat burst across the bass
columns + a handful of rising ember particles. Per-band peak-hold = a floating
ember hovering at the recent max height, sinking slowly — the peak-dot as physics.

**AutoGain:** `linear` target 0.8 (frequency-bin display). Silence: bands die to
tiny pilot flames guttering at each base (heat injection has a 1-cell floor), the
occasional ember pop. No gate needed — AutoGain freezes in silence and pilots are
constant.

**Palettes:** Inferno (black-red-orange-white) · Blue Gas · Witchfire Green ·
White Heat mono.

**Perf:** 57.6k-cell automaton + putImageData ≈ ~1ms (demoscene fire is famously
cheap); auto-quality: 320×80 grid. **Bench:** column↔band mapping (tone at f
heats column k), flame height tracks level monotonically, peak-ember decay
timing, silence = pilot-height only. **Effort: S.**

### 4.3 Murmuration — `murmuration` (Scenes)

**Pitch:** a starling flock over a dusk marsh, flying the music. Loud tight
passages ball the flock into a dense pulsing mass; a kick sends a predator through
it and the flock *explodes and reforms* — the natural phenomenon everyone has
watched on mute, finally with the soundtrack driving it.

**Visual design (1920×480):** minimal dusk backdrop (gradient sky, low sun/moon,
a dark reed-line strip, still water hint) — the flock is the show. 800–1200 birds,
each a 2–3px oriented dash, rendered with a per-frame fade (~0.3 alpha) so motion
leaves silky ribbon trails. The panel's width is the canvas for the flock's
signature stretching — sheets, ropes, and split/merge across 1920px.

**Simulation:** classic boids (separation/alignment/cohesion) with a spatial hash
grid (cell = perception radius) for O(n) neighborhoods; soft boundary force keeps
the flock on-panel; an off-screen drift target wanders so the flock roams.

**Audio mapping:**

| Signal | Effect |
|---|---|
| Smoothed energy | cohesion+alignment weights and airspeed — loud = tight/fast, quiet = loose drift |
| Beat | subtle whole-flock contraction pulse (wingbeat) |
| Kick transient | **predator burst**: an invisible hawk spawns at the flock edge, local scatter force, split-and-reform over ~2s |
| Drop / rupture | full-flock explosion + slow reform; brief sub-flock split |
| Treble | individual jitter (feather noise) |
| Sustained complexity (many active bands) | flock splits into two sub-flocks, merges when it simplifies |

**Silence/idle:** gate closed → the flock descends and *lands* along the reed-line
as still silhouettes with occasional flutters; music resumes → mass takeoff (the
world-wake moment, PixelQuest-style). This idle state alone justifies the mode.

**Palettes:** Dusk (black birds, amber sky) · Night Neon (glowing cyan on dark) ·
Dawn Silver · Storm.

**AutoGain:** `null` + SilenceGate. **Perf:** ~1000 boids × ~8 neighbors via hash
grid, typed arrays ≈ 1–2ms; auto-quality: population 1200→500. **Bench:** kick →
scatter metric spike (mean nearest-neighbor distance) then re-convergence <3s;
energy sweep → flock radius tracks inversely; silence → grounded (mean speed ≈ 0);
landing/takeoff transition timing. **Effort: M.**

---

## 5. Build order

Ordered by dependency + risk retirement + wow-per-hour:

| Phase | Items | Rationale |
|---|---|---|
| **0** | SilenceGate extraction (0.1) + capture-constraint hardening (from 0.2) | Prereq for five modes; Ferrofluid refactor proves the extraction against its shipped bench numbers |
| **1** | Flame Spectrum → Murmuration → City Skyline → Laser Show → Vector CRT | Zero new analysis infra; S/M efforts; each ships independently with its bench |
| **2** | `chroma.js` (0.3) → Harmony Wheel → Note-Fall | The moat. Chroma module lands with its own bench before either mode starts |
| **3** | Stereo path (0.2) → Vectorscope suite | Gated on the UCA202 arriving; the mode is half infra |
| **4** | Cymatics → Ink Fluid | The two R&D-heavy sims; prototype the solver/settle-feel first, measure on the Pi, then polish. Fluid has the declared fallback (curl-noise) if the Pi says no |

Every phase ends with: bench committed + numbers in the commit message, version
bump, push, release published (until CI lands), memory updated with any new
platform lesson.
