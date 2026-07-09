# Pixel Quest — Missing‑Assets Prompt (standalone, copy‑paste into ChatGPT)

Everything here is self‑contained — you do **not** need the biome file. Workflow:

1. Paste **STEP 0** once to set the art style.
2. Then paste **one PACK block at a time** (STEP 1…8). Each is complete on its own.
3. Save each result into `vizzy/public/assets/pixelquest/raw/` with the filename shown at the top
   of the block, then tell me which pack landed — I do the import + wiring.

**The one gotcha:** the importer deletes the background by flooding in the KEY color, so if a
subject *contains* the key color it gets erased. That's why each block says **MAGENTA key** or
**GREEN key**. Pink/neon subjects use a GREEN background; everything else uses MAGENTA.

---

## STEP 0 — paste once to set the style

```
You are generating 2D PIXEL‑ART sprite sheets for a side‑scrolling, moonlit music‑adventure
game that renders on a tiny low‑res canvas upscaled to a wide LED display. Everything is TRUE
PIXEL ART.

Rules for everything you make:
- Hard‑edged pixels. NO anti‑aliasing, NO blur, NO soft gradients. Shade with dithering only.
- Tight limited palette, ~8–16 flat colors per subject.
- Flat side‑on / orthographic view, like a 16‑bit platformer. No perspective.
- Always night, lit by one soft moon: cool rim light on top edges, small warm light pools from
  lanterns/windows/neon/fire.
- Strong chunky readable silhouettes. No text, no letters, no UI, no frames.

I will ask for PACK SHEETS. Each pack is ONE image: a grid of separate little subjects, each in
its own cell on a flat solid background, even gaps, one subject per cell, all standing on a
shared baseline, with a small text label under each cell. Keep the style identical across packs.
```

---

## STEP 1 — Attractions & props  ·  save as `pixelquest_pack_props.png`  ·  MAGENTA key

```
PIXEL‑ART PACK SHEET. One image, a grid of separate objects, each in its own cell, small label
under each cell, even gaps, one object per cell, each standing on a baseline.
BACKGROUND: pure magenta #FF00FF everywhere except the objects. Do NOT use magenta anywhere
inside the art. Hard pixels, no anti‑aliasing, ~8–16 colors, flat side view, moonlit night.
Objects (label each):
1. windmill — wooden tower windmill, 4 sail blades, warm‑lit window at the base.
2. campfire — small stone fire ring with logs, warm orange flame core, ember glow.
3. brazier — iron fire bowl on a post, warm flame.
4. snail — friendly cartoon snail with a glowing spiral shell.
5. jukebox — chrome‑and‑wood 50s jukebox, warm amber arch, glowing panel.
6. phone booth — tall call‑box, glass panels, small light on top.
7. sword in stone — heroic sword planted in a mossy boulder, faint blade glow.
8. secret door — low arched wood/stone door in a bank, iron studs, keyhole glow.
9. statue — half‑buried heroic adventurer statue, weathered stone, one arm raised.
Each object roughly 40–90 px tall at final size (draw larger).
```

---

## STEP 2 — Neon / synthwave props  ·  save as `pixelquest_pack_neon.png`  ·  GREEN key ⚠

```
PIXEL‑ART PACK SHEET. One image, a grid of separate objects, each in its own cell, small label
under each, even gaps, one per cell, standing on a baseline.
BACKGROUND: pure green #00FF00 everywhere except the objects (these subjects are pink/neon, so
we key on green instead of magenta). Do NOT use pure green inside the art. Bright neon is welcome.
Hard pixels, no anti‑aliasing, ~8–16 colors, flat side view, dark synthwave night.
Objects (label each):
1. arcade cabinet — upright 80s cabinet, glowing cyan/magenta CRT screen, lit marquee.
2. blue time booth — tall glowing blue booth, magenta window light.
3. ghost trap — small sci‑fi trap device with hot‑pink energy leaking out the top.
4. neon diner sign — roadside sign shape: glowing magenta arrow + cyan tubes, no readable words.
5. magic microphone — vintage stage mic on a stand with a hot‑pink halo.
Each object roughly 40–90 px tall at final size (draw larger).
```

---

## STEP 3 — Sky silhouettes  ·  save as `pixelquest_pack_sky.png`  ·  MAGENTA key

```
PIXEL‑ART PACK SHEET. One image, a grid of separate shapes, each in its own cell, small label
under each, even gaps, one per cell.
These are things that drift across the night sky, so make them near‑solid DARK silhouettes with
only a thin cool moon‑rim highlight — clean readable shapes, low detail.
BACKGROUND: pure magenta #FF00FF everywhere except the shapes. No magenta inside the art.
Hard pixels, no anti‑aliasing, moonlit night.
Shapes (label each):
1. dragon — serpentine dragon in flight, wings spread, long tail.
2. pirate ship cloud — a sailing‑ship‑shaped cloud, faint moonlit underside.
3. witch on broom — pointy‑hat witch riding a broom.
4. winged shadow — large ambiguous winged silhouette (owl/bat).
5. bicycle and rider — a kid hunched forward on a bicycle, tiny warm glow up front.
6. spy on a rope — a secret‑agent figure descending head‑first on a thin rope.
7. meteor cassette — a cassette tape trailing a fiery streak.
Each shape roughly 30–60 px at final size (draw larger).
```

---

## STEP 4 — Moon overlays  ·  save as `pixelquest_pack_moon.png`  ·  MAGENTA key

```
PIXEL‑ART PACK SHEET. One image, three round overlays, each in its own cell, small label under
each, even gaps.
Each is a ROUND decoration meant to sit ON TOP OF an existing moon disc — draw only the overlay
pattern as a filled circle, NOT a new glowing moon.
BACKGROUND: pure magenta #FF00FF outside the circles. No magenta inside the art.
Hard pixels, no anti‑aliasing, cool pale palette.
Overlays (label each):
1. disco moon — mirror‑ball facet grid across the disc.
2. record moon — vinyl‑record grooves with a center label.
3. winking moon face — simple friendly face, one eye winking, small smile.
Each circle roughly 48 px at final size (draw larger).
```

---

## STEP 5 — Ground cameos  ·  save as `pixelquest_pack_ground.png`  ·  MAGENTA key

```
PIXEL‑ART PACK SHEET. One image, a grid of small subjects, each in its own cell, small label
under each, even gaps, one per cell, standing on a baseline.
BACKGROUND: pure magenta #FF00FF except the subjects. No magenta inside the art.
Hard pixels, no anti‑aliasing, ~8–16 colors, flat side view, moonlit night.
Subjects (label each):
1. shark fin — a single dorsal fin cutting a small water ripple.
2. submarine periscope — a periscope tube with a glass eye poking up from a puddle.
3. sports car — a low 80s sports car in profile.
4. boulder — a big round cracked rolling rock.
5. black cat — a black cat mid‑stride, tail up, two glowing eyes.
6. red balloon — a single round red balloon on a string.
7. cassette tumbleweed — a wad of tangled cassette tape rolling like a tumbleweed.
Each subject roughly 20–44 px at final size (draw larger).
```

---

## STEP 6 — Background cast  ·  save as `pixelquest_pack_cast.png`  ·  MAGENTA key

```
PIXEL‑ART PACK SHEET. One image, a grid of separate figures, each in its own cell, small label
under each, even gaps, one per cell, standing on a baseline.
These appear far away on the horizon / behind the tree line, so keep them DARK, low‑detail
silhouette figures with a thin moon‑rim highlight.
BACKGROUND: pure magenta #FF00FF except the figures. No magenta inside the art.
Hard pixels, no anti‑aliasing, moonlit night.
Figures (label each):
1. giant friendly creature — a huge gentle beast peeking over a treeline.
2. dinosaur — a long‑necked dino grazing on the far horizon.
3. robot duo — two blocky retro robots standing together.
4. glam‑rock guitarist — a rocker mid‑solo, guitar raised.
5. keyboard player — a figure at a keytar/synth.
6. tiny drummer — a small figure drumming on a cliff edge.
7. crane‑kick pose — a lone martial‑artist on one leg, arms out.
8. masked shadow — a cloaked masked figure half‑hidden behind a tree trunk.
9. detective in the rain — a trench‑coat‑and‑hat figure under a streetlamp.
10. steam train — a small steam train crossing a viaduct, glowing windows.
11. ballroom window — a lit castle window with two tiny dancing silhouettes inside.
Each figure roughly 40–80 px tall at final size (draw larger).
```

---

## STEP 7 — Hero accessories  ·  save as `pixelquest_pack_hero_kit.png`  ·  MAGENTA key

```
PIXEL‑ART PACK SHEET. One image, a grid of TINY separate props, each in its own cell, small
label under each, even gaps. Draw each item ALONE — no character.
BACKGROUND: pure magenta #FF00FF except the items. No magenta inside the art.
Hard pixels, no anti‑aliasing, moonlit night, tiny and chunky.
Items (label each):
1. fedora hat.        2. sunglasses.       3. flowing cape.     4. glowing red shoes (pair).
5. boombox.           6. power glove.      7. whip (coiled).    8. hoverboard (small glowing board).
Each item roughly 8–24 px at final size (draw larger).
```

---

## STEP 8 — Fix the broken arcade gate  ·  save as `gateArcade.png`  ·  GREEN key ⚠

```
PIXEL‑ART SINGLE SPRITE — an arcade gateway/archway, standing on a baseline.
BACKGROUND: pure green #00FF00 everywhere except the gate (the gate is neon pink/cyan, so we key
on green, NOT magenta). Do NOT use pure green inside the art.
A tall arcade gateway: glowing cyan + hot‑magenta neon arch, a little pixel‑invader motif on top,
CRT‑glow accents. Same overall size/shape as a doorway the hero could walk through.
Hard pixels, no anti‑aliasing, dark synthwave night.
```

---

### Skip these (already handled procedurally — don't generate art)
Hero costume *motions* (moonwalk, pirouette, cape flourish, dances/poses — only the accessory
props in STEP 7 are art); weather fields (purple/pixel/token rain, VHS tracking); light FX
(glowing road, laser‑grid sunrise, lightning, alien‑hand glow, star‑power burst, sparkles,
fireflies, torch flames). These stay red on the debug page on purpose.
