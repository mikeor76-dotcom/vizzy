# Pixel Quest art assets

Drop pixel-art sprite sheets here; the manifest in `src/pixelquest-assets.js`
(ASSET_MANIFEST / PARALLAX_MANIFEST / PROP_RECIPES) defines the contract:

- Sheets are HORIZONTAL frame strips, transparent background, crisp 1:1 pixels.
- Each entry declares frameW/frameH, named animations (frame indices + fps),
  anchor, scale, and a procedural fallback that renders until the PNG decodes.
- Hero contract: 24x32 frames — idle(2) walk(4) lookUp lookAtOrb hesitate
  stepBack celebrateSmall(2) rest. Warm, human, unmasked traveler.
- Orb contract: 18x18, five power-state frames: dim awake attracting charged radiant.
- Parallax plates: horizontal-tiling strips per biome (see PARALLAX_MANIFEST).

Rendering never breaks when a file is missing — the old procedural draw path
owns any subject whose art hasn't loaded.
