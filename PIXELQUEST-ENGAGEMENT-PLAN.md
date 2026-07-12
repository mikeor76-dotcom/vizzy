# Pixel Quest Engagement Plan — "Can't Look Away"

**Status: APPROVED, awaiting GO.** When the user says **GO**, execute the phases in
order. After each phase: run the genre suite (below), compare against the
acceptance table, screenshot-verify, commit, push, then continue. Report the
suite table after every phase.

**Goal:** a viewer glances at the wall and can't leave — the scene visibly IS the
music (any genre), every song has an arc, rare wonders reward staying, and the
world grows over a session. Perf budget: every phase keeps added cost under
~1 ms/frame at standard detail (measure with the harness timing run).

**Grounding:** play-test findings and research in the conversation of 2026-07-12
(genre table, MilkDrop/slow-TV/soft-fascination sources). The five-genre suite
lives at `test/genre-suite.browser.js` and is the regression gate.

---

## Phase 1 — Fix the music reading (foundation)

### 1.1 Absolute intensity model (the contrast-collapse fix)
**Problem:** after volume-independence, every genre saturates to one mood/section
(~90% "energetic/chorus"); ballads read as bangers. No absolute anchor remains.
**Build:** in `pixelquest.js` `analyze()`, compute `this.intensity` (0..1) from
VOLUME-PROOF structural features:
- onset density (existing `rateN`)
- spectral fullness: fraction of ~24 coarse bands above a floor (a ballad lights
  a few bands, EDM lights most)
- percussiveness: transient flux vs sustained level ratio
- tempo presence (`tempoConf`, bps)
Blend ≈ `0.3*density + 0.3*fullness + 0.25*percussiveness + 0.15*tempoFactor`,
two EMAs: `intensity` (~3 s) and `intensityFast` (~0.4 s).
**Rewire:** `AdventureMood.update` consumes intensity (not raw driveFx);
`SongSection` uses intensity + trend. Retune `ADVENTURE_TUNING` mood thresholds
and `SECTION_PROFILE` gates against the suite. Keep `driveFx` for pace but give
it a fullness factor so a sparse ballad can't sustain sprint-level drive.

### 1.2 Half/double-time tempo disambiguation
**Problem:** ballad locked 141 BPM (true 70) → hero sprints through lullabies.
**Build:** in the interval fold (`analyze()`), when `intensity < ~0.35` and the
folded period reads faster than ~105 BPM but the doubled period fits the clamp,
prefer the slower octave. Symmetrically, high intensity + very slow reading may
prefer the faster octave.

### 1.3 Self-tuning melody detector
**Problem:** rock chugs flood it (237 notes/min), ballads starve (6/min).
**Build:** in `analyze()`, track `melodyRate` (hits/min EMA). Adapt the rise
threshold (currently fixed 0.035, clamp ~0.02..0.12): rate > 40/min → raise
~5%/s; rate < 8/min while mids present → lower ~3%/s. Optionally require the
centroid to have MOVED since the last onset (chugs repeat the same pitch).

### 1.4 Honest snares
**Problem:** string beds/hats fire "snares" 110–240/min in gentle music — sword
flashes all through an adagio.
**Build:** `onSnare` dispatch additionally requires percussive character: a
treble-band flux spike well above the sustained treble level (crest test), e.g.
`trebleFlux > 2.2 * trebleSustain`. Tune so rock backbeat (~120/min) survives.

### Phase 1 acceptance (genre suite)
| Metric | EDM | Ballad | Rock | Hip-hop | Orchestral |
|---|---|---|---|---|---|
| Tempo | 128 | **60–80** | 120 | 87 | none |
| Top mood share | <60% | calm/steady ≥70%, energetic ≤15% | <65% | <70% | calm, but climax hits energetic/peak ≥8% |
| Sections seen ≥3 | yes | yes (no chorus-lock) | yes | yes | ≥2 |
| Melody notes/min | 15–45 | **≥10** | **10–45** | 20–45 | 15–40 |
| Snares/min | 100–150 | **<30** | ~90–150 | <80 | **<30** |
| Hero speed avg | 130–190 | **<70** | 140–190 | 90–140 | <40 |

---

## Phase 2 — Choreograph the song (within-song arc)

### 2.1 Section scene-direction
One direction table (extend `SECTION_PROFILE` in `pixelquest-resonance.js`) that
draw sites consume — states must differ AT A GLANCE:
- **intro:** dim ambient, sparse motes, aurora whisper, slow walk
- **groove/verse:** steady pulse waves, normal density
- **build:** the world LEANS IN — aurora climbs frame by frame, motes gather
  toward the orb, hero quickens slightly, torches brighten
- **chorus:** full curtain, hero notes, radiant orb — the current "everything on"
- **breakdown:** mist rolls in (new cheap fog band), moonlight lift, slow drift
- **outro:** settle, fireflies thicken, aurora exhale
Consumers: `drawAurora`, `Songstream`, `ResonancePath`, torch warmth in
`drawTorch`, `drawSky` ambient lift, hero pace nudge.

### 2.2 Drop detection + the Hit
In `SongSection`: `build` held ≥3 s then `intensityFast` jumps >0.25 within
~300 ms → `dropHit` (one frame) + `dropPulse` envelope (~2 s), ≥20 s cooldown.
Choreography (one function, tunable amplitude): screen-wide light pulse, aurora
flare to full, ALL held phrase-notes launch at once, orb ring-burst + heartbeat
overdrive, hero leap, double resonance shockwave on the path. Bold but ≤2 s.

### 2.3 Song boundaries
- Silence >2.5 s after ≥60 s of music → **finale**: firefly bloom, orb settles
  bright then dims with grace (peak-end rule).
- Next gate-open → **new song**: reroll `songSeed` → palette hue tint (±8°),
  weather roll (Phase 3), Songstream halo tint variation. Every song looks
  subtly its own.

### Phase 2 acceptance
Suite shows ≥4 distinct sections traversed on EDM with the drop flagged exactly
once at t≈25 s; screenshots of build vs chorus vs breakdown are unmistakably
different; drop hit visible in a 3-frame screenshot burst.

---

## Phase 3 — The "hours" layer (variable reward + journey + evolution)

### 3.1 Cameo rarity tiers + musical scheduling
Use the existing `rarity` field; add a scheduler in `PixelQuestEventManager`:
- common ≈ every 30–60 s; uncommon ≈ 2–4 min; rare ≈ 6–12 min (variable-ratio
  jitter); **epic: exactly one per session**, ≥20 min in.
- Rare+ events fire ON musical moments only (chorus/peak/drop), commons anywhere.
- New epic set-piece: **the Sky Whale** — a vast mist-style silhouette (Friendly
  Giant rendering language) that swims the length of the sky over ~25 s while
  the aurora bends around it. Procedural, no art needed.

### 3.2 The Journey (waypoints + orb economy)
- Orb charge becomes scarce: lower `chargePerFragment`, raise decay; arrival
  requires charge ≥0.6 and SPENDS it; charge 1.0 → rare **golden arrival**.
- Visible route: signpost near the gate shows the next waypoint ("⚑ in 2 songs").
  Milestone arrival every ~3 songs advances a waypoint list (the 5 gates +
  named landmarks); each unlock = a small unique flourish.
- **Persistence: server-side**, like last-mode: `GET/POST /api/journey` in
  `scripts/serve.mjs` storing `{waypoint, songsCompleted, worldWake}`,
  localStorage fallback in the browser. Survives kiosk restarts.

### 3.3 World evolution
- **Weather state machine:** clear → mist → rain → aurora-storm; transitions
  every 3–8 min biased by recent intensity (storms follow intense stretches).
  Mist = cheap horizontal fog bands; rain = existing pixel-rain vocabulary,
  gentler; aurora-storm = aurora ×1.6 + occasional sky shimmer.
- **World-wake meter** (persistent 0..1): grows with total notes absorbed;
  drives flora density, firefly population, window warmth. An hour of music
  visibly enriches the world; it greets you richer tomorrow.

### 3.4 Combinatorial novelty
Scene state = biome × weather × palette-tint × section. Per-song prop-variant
reshuffle and per-song tint make exact repeats rare (MilkDrop lesson).

### Phase 3 acceptance
1-hour simulated session (suite looped with varied genres): ≥1 epic, rare
events 4–8, weather changes 8–15, ≥1 waypoint advance, worldWake visibly up;
journey state survives a reload.

---

## Phase 4 — Gaze food (soft fascination polish)

- Firefly flocking: boids-lite on ≤20 fireflies (cohesion + wander), they
  loosely orbit the orb during choruses.
- Shooting stars answer big melody leaps (centroid jump > threshold → streak
  from the note's birth row).
- Far-plate micro-drift (±0.2 px sway) so backgrounds never fully freeze.
- **Sleeping world:** gate closed >10 s → lantern dims, aurora breathes faint,
  fireflies slow, occasional lone shooting star. Silence is watchable; wakes
  instantly on music.

### Phase 4 acceptance
Idle screenshot reads as intentional "night rest" scene; flocking visible in a
5-frame burst; perf still <1 ms added vs today's baseline.

---

## Execution protocol on GO
1. Phases strictly in order (1 → 4); each phase = implement → genre suite →
   acceptance table → screenshots → commit (one commit per phase, message
   references this plan) → push.
2. Any acceptance miss: tune within the phase before moving on; if a target
   proves wrong in practice, note the deviation in the commit message.
3. Deploy note for the user after each push: `cd ~/vizzy && git pull && sudo
   bash deploy/install.sh`.
4. Wall-feel checkpoints (user listens on the LED wall) after Phases 1, 2, and 3
   — thresholds are tunable dials, expect one nudge round each.
