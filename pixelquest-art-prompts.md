# Pixel Quest — Art Generation Prompts (ChatGPT / GPT‑4o image)

How to use this file:

1. Paste **§1 STYLE BIBLE** into ChatGPT once, at the start of an image session. It sets the
   art direction so every following asset matches.
2. Then request **one asset per message** using the templates in §2, filling the `{…}` blanks
   from the biome tables in §3.
3. Save each result into `vizzy/public/assets/pixelquest/raw/` with the right name (see the
   filename list at the bottom), then run the importer — it does all the cleanup automatically:
   ```
   bun run art:import          # downscale + key out magenta + crisp edges + quantize
   ```
   Then in the app console: `pqAdventure.reloadAssets()`. The four new biomes are already wired,
   so they light up the moment their files exist. (Handy flags: `--only neon-forest_mid`,
   `--colors 64`, `--no-quantize`, `--key 00ff00`.)

> **Reality check on GPT‑4o image gen.** It is *not* pixel‑perfect and can't output true
> transparency, exact tiny dimensions, or guaranteed seamless tiling. That's fine — generate the
> art large and clean; the importer does the pixel‑ification/keying on the way in. The prompts
> below are written to make that conversion easy (limited palette, hard edges, magenta
> backgrounds, subject kept low in the frame). The importer removes the background by flooding in
> from the edges, so magenta/pink *inside* the art (neon caps, arcade signs) is safe — only the
> surrounding background is cut.

---

## §1 — STYLE BIBLE (paste once per session)

```
You are generating 2D PIXEL‑ART assets for a side‑scrolling, moonlit music‑adventure game.
The game renders on a tiny low‑resolution canvas (~220×160 pixels) upscaled to a wide LED
display, so every asset is TRUE PIXEL ART.

Global rules for everything you make:
- Hard‑edged pixels. NO anti‑aliasing, NO blur, NO soft gradients. Shade with dithering only.
- Tight limited palette: about 8–16 colors per asset. Flat color blocks.
- Flat side‑on / orthographic view, like a classic 16‑bit platformer background. No perspective.
- It is ALWAYS NIGHT, lit by one soft moon: cool moonlight rim on the TOP edges of shapes,
  plus small WARM light sources (lanterns, windows, neon, torches) that pool light locally.
- Strong readable silhouettes. Chunky, deliberate shapes — nothing noisy or photographic.
- NO text, NO letters, NO watermark, NO UI, NO borders or frames, NO character unless asked.

I will ask for assets one at a time. For each one I'll give you a subject, a palette, a mood,
and a background rule. Follow them exactly and keep a consistent style across the whole set.
```

---

## §2 — Asset request templates

### A. Parallax background plate  ← **this is the priority; it transforms the look**

Each world has **4 stacked plates** (back → front): `sky`, `far`, `mid`, `foreground`. They
scroll at different speeds and **tile horizontally**, so the design must loop seamlessly and the
subject must sit LOW in the frame (the top is empty sky).

```
Pixel‑art PARALLAX BACKGROUND BAND — world: {BIOME}, depth layer: {LAYER}.
Wide horizontal image designed to scroll and repeat seamlessly left↔right: the left and right
edges must line up so it can tile with no visible seam.
Content: {LAYER_CONTENT}
Palette (use these and close neighbors only): {PALETTE}
Mood: {MOOD}.
Keep all the important shapes in the LOWER portion of the image; the upper portion is empty.
Flat side view, hard pixels, no anti‑aliasing, limited palette, moonlit night lighting.
{BACKGROUND_RULE}
```

`{BACKGROUND_RULE}` — pick by layer:
- **sky** → `This layer is the sky itself: fill the WHOLE image, fully opaque, no transparency.`
- **far / mid / foreground** → `Everything that is NOT the subject must be pure magenta #FF00FF, and do not use magenta anywhere in the actual art, so the background can be deleted cleanly. Leave the empty upper area as flat magenta.`

Approx. target sizes (I downscale to these — you can generate larger in a wide landscape shape):
`sky ≈ 640×180 · far ≈ 320×80 · mid ≈ 640×120 · foreground ≈ 640×80`.

### B. Prop sheet (optional, secondary)

One sheet of small objects for a world, magenta background, objects in a row with clear gaps:

```
Pixel‑art PROP SHEET for the {BIOME} world — a single row of separate small objects on a pure
magenta #FF00FF background, even gaps between them, each object standing on the same baseline.
Objects, left to right: {PROP_LIST}.
Palette: {PALETTE}. Moonlit night, warm glow on any light sources. Hard pixels, no anti‑aliasing.
No magenta inside the objects themselves.
```

### C. Global character sprites (you already have these — regenerate only to improve them)

These are world‑independent; you don't need new ones per biome.

```
# Hero — 6 frames in a horizontal strip, magenta #FF00FF background, each frame same size,
# character centered on a shared baseline. Frames in this exact order:
# 1 idle · 2 hesitate (leaning back) · 3 walk‑1 · 4 walk‑2 · 5 looking up at the orb · 6 celebrating.
# A tiny hooded traveler, warm cloak, human and friendly (not scary). ~24×30 px per frame.

# Orb — 5 frames in a horizontal strip, magenta background. A glowing musical note that grows in
# power left→right: 1 dim/asleep · 2 awake · 3 attracting (reaching) · 4 charged · 5 radiant.
# ~18×18 px per frame.

# Fragments — 8 small glowing music‑fragment sprites (notes/sparks) in a row, magenta background,
# ~16×16 px each.
```

---

## §3 — Biome content reference

Order that the game cycles through them. **meadow‑road is already done** (included so you can
regenerate for consistency); the other four are what we need.

### 1. meadow‑road — *cozy classic adventure, calm* ✅ done
- **Palette:** night sky `#0E1620→#1A2A30`, green horizon glow `#3A503E`, grass `#487034`, dark green `#182E1E`, warm moon `#EBE2C0`, lantern `#FFCA7A`.
- **sky:** deep blue‑green night, warm round moon, soft stars, a couple of drifting clouds, faint green glow at the horizon.
- **far:** low rolling hills / soft distant mountains, hazy blue‑green, no detail.
- **mid:** green hills with a tiny cozy village — a few cottages with warm‑lit windows, some trees, a small stone shrine.
- **foreground:** grassy roadside band — tufts of grass, wildflowers, wooden fence posts, a dirt path edge.
- **props:** lantern · cottage · wildflower · grass tuft · wooden signpost.

### 2. neon‑forest — *magical, synthy, mysterious but beautiful*
- **Palette:** violet sky `#0E0820→#2E144A`, glowing magenta `#C83CA0`, teal `#28BEB4`, pale‑purple moon `#BE82E6`, teal stars `#E1BEFF`.
- **sky:** deep purple night, large pale‑violet moon, teal stars and a faint aurora‑like haze.
- **far:** silhouettes of tall alien trees and a distant glowing canopy, purple mist between.
- **mid:** dense forest of glowing mushrooms — magenta caps on teal stems — twisted dark trunks, drifting spores and fireflies.
- **foreground:** clusters of glowing mushrooms and luminous ferns, bioluminescent undergrowth, floating spores.
- **props:** glowing mushroom‑lamp · big twisted trunk · luminous fern · glowing spore tuft · rune stone.

### 3. moonlit‑town — *quiet village, nostalgic, late‑night, charming*
- **Palette:** cool blue night `#0A0C1C→#22263C`, blue‑gray stone `#404456`, warm lamplight `#FFD28C`, cool‑white moon `#E1E1F0`.
- **sky:** cool blue night, bright cool‑white moon, sparse stars, thin high clouds.
- **far:** distant town rooftops and a tall clock‑tower silhouette on low hills.
- **mid:** a cobbled village street — row houses with warm‑lit windows, chimneys, and a tall tower with a glowing clock face.
- **foreground:** cobblestone sidewalk band with a lit street lamp, a bench, a few crates, the edge of a fountain.
- **props:** street lamp · townhouse · lit window‑box flowers · cobble/curb tuft · hanging shop sign.

### 4. arcade‑ruins — *retro, playful, 80s/90s neon energy, not chaotic*
- **Palette:** near‑black `#080610→#1E0E28`, neon cyan `#28C8DC`, hot magenta `#DC3CB4`, hot‑pink glow `#FF5AB4`, gold stars `#FFDC5A`.
- **sky:** very dark night with a synthwave neon glow low on the horizon, faint gridline haze, cyan stars.
- **far:** ruined city skyline silhouettes studded with distant neon signs and glow.
- **mid:** broken‑down arcade — cracked walls, tilted arcade cabinets glowing cyan/magenta, neon signs, CRT light spill.
- **foreground:** cracked pavement band with a fallen arcade cabinet, loose cables, neon puddle reflections.
- **props:** arcade cabinet · neon sign panel · glowing floppy/cartridge · cracked‑tile tuft · joystick post.

### 5. castle‑approach — *heroic destination, epic but soft*
- **Palette:** dusk purple `#0E091A→#34203E`, warm stone `#4A4250`, warm torch `#FFB45A`, warm moon `#EBDEC8`.
- **sky:** deep dusk‑purple sky, warm round moon, dramatic soft clouds, a scatter of stars.
- **far:** a great mountain range with the silhouette of a huge castle on the highest peak, tiny lit windows.
- **mid:** a rising approach — stone walls, a gatehouse, towers with warm‑lit windows, hanging banners and flags.
- **foreground:** a stone road / broad steps climbing toward the gate, lit torches on posts, low framing walls and banners.
- **props:** torch post · stone gatehouse · hanging banner · stone/rubble tuft · heraldic sign.

---

## §4 — Copy‑paste STARTER (do this first)

Paste the **STYLE BIBLE (§1)** and then this first request in the same session to test the pipeline
with one plate before doing all 16:

```
Pixel‑art PARALLAX BACKGROUND BAND — world: neon‑forest, depth layer: mid.
Wide horizontal image designed to scroll and repeat seamlessly left↔right: the left and right
edges must line up so it can tile with no visible seam.
Content: a dense forest of glowing mushrooms — magenta caps (#C83CA0) on teal stems (#28BEB4),
twisted dark trunks, drifting spores and fireflies.
Palette: violet sky #0E0820 to #2E144A, glowing magenta #C83CA0, teal #28BEB4, pale‑purple moon
#BE82E6 accents. Mood: magical, mysterious, beautiful.
Keep all the important shapes in the LOWER portion of the image; the upper portion is empty.
Flat side view, hard pixels, no anti‑aliasing, limited palette, moonlit night lighting.
Everything that is NOT the subject must be pure magenta #FF00FF, and do not use magenta anywhere
in the actual art, so the background can be deleted cleanly. Leave the empty upper area as flat
magenta.
```

If that one looks right, run the same template for every `{BIOME} × {sky, far, mid, foreground}`
using §3, drop them in the assets folder, and I'll import + wire them up.

---

### Filenames to use (so import is automatic)
Per biome: `{biome}_sky.png`, `{biome}_far.png`, `{biome}_mid.png`, `{biome}_foreground.png`,
`{biome}_props.png` — e.g. `neon-forest_sky.png`, `castle-approach_mid.png`. Global sprites keep
their current names (`hero_traveler_sheet.png`, `orb_note_states.png`, `fragments_music_sheet.png`).
