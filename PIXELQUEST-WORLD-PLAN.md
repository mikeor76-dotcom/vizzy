# Pixel Quest World Plan — Arriving Somewhere

**The problem (user, 2026-07-12):** the biomes are "interesting but sort of
cliche, and it never looks like I've arrived anywhere — just walking between
cities and villages, never arriving."

**The diagnosis:** every biome is a palette + prop-swap over the SAME uniform
corridor. Trees/attractions/torches are spread evenly around a short 1280px
loop, the gate drifts past like any prop, and one shared 64px ground tile
textures every world. Structurally there is no *place* to arrive at.

**The fix, in one sentence:** give every biome a **HEART** — a dense, lit,
unique set-piece the road builds toward, passes through slowly, and leaves —
plus per-biome ground texture and much deeper art variety.

---

## 1. The biome lineup (decision)

Keep all five, but sharpen each identity from "generic corridor with a theme"
to "a specific place with a heart." Add ONE new biome for long-session variety.

| Biome | Identity (sharpened) | Its HEART |
|---|---|---|
| meadow-road | the pastoral home road — safe, warm, familiar | a tiny hamlet: farmhouse + windmill + well, laundry lines, a shared fire |
| neon-forest | a bioluminescent deep-wood — alien, beautiful, quiet awe | the Mother Grove: one colossal glowing mushroom ringed by offspring and spore falls |
| moonlit-town | a sleeping stone town — nostalgic, intimate | the town square: fountain, tavern with lit windows, clock tower, market stalls under lamps |
| arcade-ruins | ruins of a lost arcade civilization — playful melancholy | the Grand Arcade plaza: a broken marquee arch, rows of dead cabinets, one still flickering |
| castle-approach | the pilgrimage — heroic, ceremonial | the castle gatecourt: banners, braziers, statues flanking the great doors |
| **starfall-shore (NEW)** | a night coast where fallen stars wash up — wonder, stillness | the beached star: a glowing fallen star half-buried in sand, tide pools reflecting it |

Starfall-shore ships when its art lands (full pack in the art prompt); the
engine work below is biome-generic and will accept it without code changes
beyond a BIOMES entry + manifest rows.

## 2. The Heart system (engine — no art required to start)

World loop grows 1280 → 1920 and gets STRUCTURE:

```
0 ......... 500 ......... 880 | 900 ....... 1260 ......... 1920
  OUTSKIRTS     APPROACH    GATE      HEART         DEPARTURE
  sparse,       density     (the      dense set-    thinning,
  lonely        rises,      thresh-   piece, extra  quiet again
                more lamps  old)      light, NO
                                      random trees
```

- The **gate stands at the heart's threshold** (fixed x=880) instead of
  drifting anywhere — passing the gate now means ENTERING somewhere.
- **Heart clusters** are laid out as generic spots (anchor / two sides / two
  lights / decor) and skinned per-biome at draw time — today from existing
  sprites (house, windmill, cabinets, braziers…), upgraded automatically as
  heart art lands in the manifest.
- **The heart moment:** as the hero crosses the heart, the world eases to ~half
  pace for the crossing, warm light pools up, and he celebrates — every loop
  pass is a small arrival; waypoint arrivals (Phase 3) land on top of this.
- Tree groves respect zones: lonely outskirts, thickening approach, NONE
  inside the heart, medium departure.

## 3. Anti-repetition (engine + art)

- **Per-biome ground tiles**: the single mottle tile becomes five — organic
  meadow dirt, violet neon soil with rare glow flecks, moonlit cobble courses,
  broken arcade tiling, castle flagstones. (Engine now; optional art tiles later.)
- **Foliage 3 → 6 variants** per biome (art prompt) so groves stop repeating.
- **Micro-decor scatter** (art prompt): 6-8 tiny path props per biome (crates,
  mile-stones, mushroom clusters, cables, banners…) placed by the existing
  PropField recipes.
- Already shipped and helping: grove/clearing placement, per-song hue, weather.

## 4. Execution order

1. ✅ engine: zones + hearts + heart moment + gate-at-threshold (this commit)
2. ✅ engine: per-biome ground tiles (this commit)
3. art drop → wire heart set-pieces + foliage expansions + decor (same
   slice-packs/import pipeline as all previous drops)
4. starfall-shore: BIOMES entry + manifest + parallax rows when its pack lands
5. wall pass: tune heart pacing (ease amount, light pools) by ear

**Acceptance:** a 90s watch of any biome shows a legible journey — lonely road
→ gate → a real lit PLACE crossed slowly → quiet again; no two biomes share
ground texture; suite stays green; perf budget holds.

The full art request lives in **PIXELQUEST-WORLD-ART-PROMPT.md**.
