Drop raw generated images here (any size / format / background — white, magenta,
or transparent all work), named by what they are:

SPRITE SHEETS (frames in a row; auto-detected + re-packed onto an even grid):
  hero_traveler_sheet.png     6 frames: idle, walk1, walk2, lookAtOrb, hesitate, celebrate
  orb_note_states.png         5 states: dim, awake, attracting, charged, radiant
  fragments_music_sheet.png   5 music-fragment sprites

BACKGROUNDS — two options per biome:
  {biome}_backdrop.png        EASIEST: one full opaque scene (sky+mountains+ground
                              in a single wide image). Drawn behind everything;
                              procedural mountains are auto-suppressed.
  OR a transparent parallax set for real depth (subject low, rest transparent/magenta):
  {biome}_sky.png  {biome}_far.png  {biome}_mid.png  {biome}_foreground.png

PROPS (a grid of objects on one sheet):
  {biome}_props.png

  biome = meadow-road | neon-forest | moonlit-town | arcade-ruins | castle-approach

Then run:   bun run art:import
Then in the app console:   pqAdventure.reloadAssets()

The importer downscales to engine size, auto-detects + removes the background
(flood-fill from the edges, so background-colored details inside the art survive),
snaps hard edges, and quantizes. Prompts: ../../../pixelquest-art-prompts.md
Files in THIS raw/ folder are inputs only — never loaded by the game.
