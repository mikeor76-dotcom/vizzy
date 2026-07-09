# Galaxy / Event Horizon asset library

Backgrounds are **local cached scene plates** — nothing is generated during
playback. The journey engine crops slow-panning windows out of each plate and
crossfades between regions during jumps. Plates are never tiled, so no seams.

## Folder structure

```
/assets/galaxy/
  library.json            <- the index: which scene folders exist per category
  nasa/<scene>/           real astronomy plates (realism + texture)
  generated/<scene>/      manually curated cinematic plates
  blackhole/<scene>/      black-hole vistas (Event Horizon backdrops + rare
                          Galaxy encounter regions)
  foreground/             optional transparent overlay plates (reserved)
  planet_a.jpg ...        equirectangular 2:1 planet surface maps (hero worlds)
  moon_a.jpg              equirectangular moon map
  scene01_nebula.jpg      nebula-on-black strip used for the fog layer
```

Each scene folder contains:

- `base.jpg` — the plate itself. Ideally large (4096×1024+ for ultrawide
  displays); anything ≥1280px wide works.
- `metadata.json` — optional but recommended. If missing, defaults are
  inferred from the folder name and a warning is logged.

## Adding a new plate (2 steps)

1. Create `generated/<yourname>/` with `base.jpg` (and optionally
   `metadata.json`).
2. Add `"<yourname>"` to the matching category array in `library.json`.

**Pre-wired pending folders** (metadata already written — just drop `base.jpg`
into each): `generated/planet01`, `generated/nebula_warm01`,
`generated/nebula_blue01`, `generated/openspace01`, `blackhole/bh01`.
Folders listed in `library.json` without a `base.jpg` are skipped silently.

## metadata.json fields

```json
{
  "title": "Dark Open Space 01",
  "sourceType": "nasa | generated | openai | manual",
  "credit": "",
  "sourceUrl": "",
  "mood": "open_space | nebula | star_cluster | planet_flyby | black_hole | dust_lane",
  "fogLevel": 0.0,
  "brightness": 0.5,
  "defaultDriftSeconds": 30,
  "jumpSuitability": 0.8,
  "panDirection": "left | right | diagonal | push",
  "zoomMin": 1.0,
  "zoomMax": 1.12,
  "bassGlow": 1.0,
  "trebleSparkle": 1.0,
  "beatFlare": 1.0
}
```

How they're used: `mood` drives selection variety (foggy nebula regions
alternate with clear ones; `black_hole` regions are rare encounters;
`planet_flyby` regions spawn a hero world) · `fogLevel` gates the nebula fog
layer · `brightness` sets the plate's exposure · `defaultDriftSeconds` is how
long the journey lingers · `jumpSuitability` weights how often it's chosen ·
`panDirection`/`zoomMin`/`zoomMax` shape the Ken-Burns motion ·
`bassGlow`/`trebleSparkle`/`beatFlare` scale that region's audio accents.

## Bundled assets & attribution

- `nasa/milkyway` — Milky Way panorama — ESO / S. Brunier, CC BY 4.0 (eso.org/public/images/eso0932a/)
- `nasa/pillars` — Pillars of Creation — NASA, ESA, Hubble Heritage Team (esahubble.org/images/heic1501a/)
- `nasa/deepfield` — Hubble Ultra Deep Field — NASA, ESA, S. Beckwith (STScI), HUDF Team (esahubble.org/images/heic0406a/)
- `nasa/horsehead` — Horsehead Nebula (IR) — NASA, ESA, Hubble Heritage Team (esahubble.org/images/heic1307a/)
- `scene01_nebula.jpg` — Orion Nebula — NASA, ESA, M. Robberto (STScI/ESA), HST Orion Treasury Team (esahubble.org/images/heic0601a/)
- `planet_a/b/c.jpg`, `moon_a.jpg` — Solar System Scope textures, CC BY 4.0

If this project is shown publicly, keep these credits with it.
