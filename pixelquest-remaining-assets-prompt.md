# Pixel Quest — Remaining Assets Prompt (standalone, copy‑paste into ChatGPT)

After the last import + wiring pass, **every wired cameo already has its art.** Almost
everything still drawn procedurally is procedural *on purpose* (weather/light FX like purple
rain, VHS tracking, lightning, glowing road, laser grid; and the hero‑costume motions, which
reuse the accessory props you already made).

So there are only **two truly‑missing sprites** (PACK A). PACK B is optional — it re‑does the
dark sky/cast silhouettes so they stop vanishing against the night sky (see the note at the
bottom).

**Workflow**

1. Paste **STEP 0** once to set the art style.
2. Then paste **one PACK block at a time**. Each is complete on its own.
3. Save each result into `vizzy/public/assets/pixelquest/raw/` with the filename shown at the top
   of the block, then tell me which pack landed — I do the import + wiring.

**The one gotcha:** the importer deletes the background by flooding in the KEY color, so if a
subject *contains* the key color it gets erased. Pink/neon subjects use a **GREEN** background;
everything else uses **MAGENTA**.

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

I will ask for single sprites or PACK SHEETS. A pack is ONE image: a grid of separate little
subjects, each in its own cell on a flat solid background, even gaps, one subject per cell, all
standing on a shared baseline, with a small text label under each cell. Keep the style identical
across everything.
```

---

## PACK A · the two missing sprites

These have different key colors, so they must be **two separate images**.

### A1 — Neon dragonfly · save as `pixelquest_extra_dragonfly.png` · GREEN key ⚠

```
PIXEL‑ART SINGLE SPRITE — a tiny neon dragonfly in flight, side view, wings out.
BACKGROUND: pure green #00FF00 everywhere except the dragonfly (it's neon pink + cyan, so we key
on green, NOT magenta). Do NOT use pure green inside the art.
Bright glowing bug: a slender CYAN/teal body, two pairs of HOT‑MAGENTA wings, a faint cyan glow
trail. Hard pixels, no anti‑aliasing, dark neon‑forest night. Very small and chunky — roughly
10–16 px wide at final size (draw it larger, I downscale).
```

### A2 — Boombox marcher · save as `pixelquest_extra_marcher.png` · MAGENTA key

```
PIXEL‑ART SINGLE SPRITE — one little marching figure carrying a boombox aloft, side view,
mid‑stride, standing on a baseline.
BACKGROUND: pure magenta #FF00FF everywhere except the figure. No magenta inside the art.
This appears far back on the horizon, so make it a DARK, low‑detail silhouette with a thin cool
moon‑rim highlight — one arm raised holding a small boombox overhead, the boombox front glowing
a warm amber. Hard pixels, no anti‑aliasing, moonlit night. Roughly 14–20 px tall at final size
(draw larger). Just ONE marcher — I repeat it into a parade in code.
```

---

## PACK B (optional) · brighter re‑do of the vanishing silhouettes

**Why:** the current sky + cast silhouette sprites were drawn as near‑black navy (avg ≈ RGB
4,16,32), which is almost exactly the game's night‑sky navy (≈ 11,24,48) — so they render but
disappear. This pack redraws them so they read. Keep them clearly silhouettes, but:

- Fill = a **medium slate / indigo**, distinctly LIGHTER than a near‑black night sky (think dusk
  blue‑grey, not black), so the shape separates from the sky on its own.
- Add a **bold 1–2 px pale cyan‑white moon rim** along the top and leading edges.
- Small warm accents (a lit window, a fire, an eye‑glow) are welcome where they fit.

If you'd rather not regenerate these, tell me and I'll add a soft moonlight backlight behind them
in code instead — either fixes the visibility.

### B1 — Sky silhouettes (redo) · save as `pixelquest_pack_sky.png` · MAGENTA key

```
PIXEL‑ART PACK SHEET. One image, a grid of separate shapes, each in its own cell, small label
under each, even gaps, one per cell.
These drift across the night sky. Make them readable SILHOUETTES: fill each with a MEDIUM
slate/indigo (clearly lighter than a near‑black sky, so the shape stands out on its own), plus a
bold 1–2 px pale cyan‑white moon rim along the top/leading edges. Low detail, clean shapes.
BACKGROUND: pure magenta #FF00FF everywhere except the shapes. No magenta inside the art.
Hard pixels, no anti‑aliasing, moonlit night.
Shapes (label each):
1. dragon — serpentine dragon in flight, wings spread, long tail.
2. pirate ship cloud — a sailing‑ship‑shaped cloud, moonlit underside.
3. witch on broom — pointy‑hat witch riding a broom.
4. winged shadow — large ambiguous winged silhouette (owl/bat).
5. bicycle and rider — a kid hunched forward on a bicycle, tiny warm glow up front.
6. spy on a rope — a secret‑agent figure descending head‑first on a thin rope.
7. meteor cassette — a cassette tape trailing a fiery streak.
Each shape roughly 30–60 px at final size (draw larger).
```

### B2 — Background cast (redo) · save as `pixelquest_pack_cast.png` · MAGENTA key

```
PIXEL‑ART PACK SHEET. One image, a grid of separate figures, each in its own cell, small label
under each, even gaps, one per cell, standing on a baseline.
These appear on the far horizon / behind the tree line. Make them readable SILHOUETTES: fill each
with a MEDIUM slate/indigo (clearly lighter than a near‑black sky), plus a bold 1–2 px pale
cyan‑white moon rim on top/leading edges. Small warm accents (lit windows, fire, eye‑glow) where
they fit. Low detail.
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

### Don't generate art for these (procedural on purpose)
Weather/light FX: purple rain, pixel‑rain umbrella, arcade‑token rain, VHS tracking, castle
lightning, glowing road, laser‑grid sunrise, alien‑hand glow, star‑power burst, portal
transition. Hero‑costume *motions* (moonwalk, spin, dances, poses) — they reuse the accessory
props you already made. These stay procedural.
