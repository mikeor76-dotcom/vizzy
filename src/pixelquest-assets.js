// Pixel Quest — Real Art Asset Integration v1 (Meadow Road).
//
// EXTERNAL PNGs ARE THE SOURCE OF TRUTH. Every renderable subject declares
// a `src` PNG path (attempted first at load). Only if that file is absent
// does it fall back to a BAKED canvas placeholder, and only if there is no
// bake does it fall back to the PROCEDURAL renderer. So each subject has a
// clear three-tier precedence:  external PNG  >  baked placeholder  >  proc.
//
// IMPORTANT: the baked placeholders below are deliberately programmer-art.
// They exist ONLY so the pipeline runs end-to-end before real art lands.
// The premium/cinematic look is expected to come from imported PNGs — do
// not "improve" the bakers; replace them with art.
//
//   AssetStore   — loads sheets, tracks source (external|baked|procedural),
//                  slices frames, runs named animations, draws pixel-perfect
//                  (nearest-neighbor). Supports runtime reload() for hot art
//                  iteration without a full page reload.
//   GlowQueue    — capped, batched additive light pass. Pi-safe.
//   PerfMeter    — fps / frame-time EMA for the debug readout.
//
// RENDER MODES (pq.cfg.renderMode):
//   "procedural_fallback" — force the old renderer everywhere (A/B baseline)
//   "asset_standard"      — external PNG else baked else procedural (default)
//   "asset_showcase"      — same + richer glow budget
//
// ===================================================================
// ARTIST / IMAGE-GENERATOR ASSET SPEC — Meadow Road slice
// ===================================================================
// All files live in:  public/assets/pixelquest/
// All PNGs: transparent background, TRUE 1:1 pixel art (no anti-aliasing,
// no blur), horizontal frame strips for animated sheets, rendered by the
// engine with nearest-neighbor. `scale` is world-px per art-px (keep 1).
//
// SPRITE SHEETS (frame strip = frameW*frameCount wide, frameH tall):
//   hero_traveler_sheet.png   24×30 frames, 6 frames wide (144×30)
//       frames: 0 idle · 1 idle-blink · 2 walk1 · 3 walk2 · 4 lookAtOrb/lookUp
//               · 5 celebrateSmall   (hesitate/stepBack/rest reuse 0/1)
//       anchor bottom-center. Warm hooded human, face visible, scarf/short
//       cape, red/brown/gold, NOT masked/armored/stiff.
//   orb_note_states.png       18×18 frames, 5 frames (90×18)
//       frames: 0 dim · 1 awake · 2 attracting · 3 charged · 4 radiant
//       anchor center. A LIVING musical note — warm core, halo, resonance
//       ring, sparkle; must not read as a plain starburst/icon.
//   fragments_music_sheet.png 8×8 frames, 2+ frames (16×8) anchor center.
//       Cyan-white music motes, clearly smaller/simpler than the orb.
//   meadow_cottage.png        30×26, 1 frame, anchor bottom-left.
//   meadow_lantern.png        14×22, 2 flicker frames (28×22), anchor bottom-left.
//   meadow_flower.png         7×9, 3 sway frames (21×9), anchor bottom-center.
//   meadow_grass.png          9×7, 2 sway frames (18×7), anchor bottom-center.
//   meadow_sign.png           11×15, 1 frame, anchor bottom-center.
//   (A combined meadow_props_sheet.png is fine too, but individual files
//    are simplest — the engine loads whichever names below exist.)
//
// PARALLAX PLATES (seamless horizontal-tiling strips; see PARALLAX_MANIFEST
// for width/height/factor. Bottom-anchored to the ground unless layer:"sky"):
//   meadow_sky.png            full-width sky/stars/moon plate (layer sky, top-anchored)
//   meadow_far_mountains.png  ~160×46, slow factor — distant ranges
//   meadow_mid_village.png    ~200×54 — hills, treeline, distant lit village
//   meadow_path_foreground.png ~200×24 — foreground grasses/flowers/silhouettes
//
// HOT RELOAD: drop/replace a PNG in public/assets/pixelquest/ and either
// refresh the page, or call `pqAdventure.reloadAssets()` in the console to
// re-attempt external loads live (no code change, no rebuild needed).
// ===================================================================

export const ASSET_BASE = "/assets/pixelquest/";

// ------------------------------------------------------------ the manifest
// `src` = the external PNG we try FIRST. `bake` = the canvas placeholder if
// the PNG is absent. Every entry prioritizes imported art.
export const ASSET_MANIFEST = {
  // -------- the traveler: warm, human, unmasked (see hero anim mapping in
  // pixelquest.js — these anim names are the contract for the artist)
  hero: {
    src: "hero_traveler_sheet.png", // external art wins; bake is the placeholder
    bake: "hero",
    frameW: 48,
    frameH: 60,
    // frame order matches the 8-frame imported sheet: 0 idle · 1 hesitate ·
    // 2 walk1 · 3 walk2 · 4 lookAtOrb · 5 talk · 6 celebrate · 7 rest
    anims: {
      idle: { frames: [0], fps: 1 },
      walk: { frames: [2, 3], fps: 7 },
      lookUp: { frames: [4], fps: 1 },
      lookAtOrb: { frames: [4], fps: 1 },
      hesitate: { frames: [1], fps: 1 },
      stepBack: { frames: [1], fps: 1 },
      celebrateSmall: { frames: [6], fps: 3 },
      rest: { frames: [7], fps: 1 },
    },
    anchor: "bottom-center",
    scale: 1,
    piSafe: true,
    fallback: "procedural",
  },
  // -------- dedicated fluid 6-frame walk cycle (used only while walking; the
  // traveler sheet above still handles idle/pose/reaction anims). frameH 49 so
  // the character matches the traveler's 48px height (no size pop).
  heroWalk: {
    src: "hero_walking_sheet.png",
    frameW: 48,
    frameH: 49,
    anims: { walk: { frames: [0, 1, 2, 3, 4, 5], fps: 12 } },
    anchor: "bottom-center",
    scale: 1,
    piSafe: true,
    fallback: "procedural",
  },
  // -------- the last living note: 5 baked power states + a musical-note
  // glyph. A biome-hued halo is drawn procedurally BEHIND it at render time
  // so it still recolors per world (see the orb asset branch in adventure).
  orb: {
    src: "orb_note_states.png",
    bake: "orb",
    frameW: 48,
    frameH: 48,
    anims: {
      dim: { frames: [0], fps: 1 },
      awake: { frames: [1], fps: 1 },
      attracting: { frames: [2], fps: 1 },
      charged: { frames: [3], fps: 1 },
      radiant: { frames: [4], fps: 1 },
    },
    anchor: "center",
    scale: 0.62, // a small companion note, not a giant medallion (source stays 48px for detail)
    piSafe: true,
    fallback: "procedural",
  },
  // -------- music fragments (cyan energy core + biome halo stays
  // procedural until art lands; slot reserved)
  fragment: { src: "fragments_music_sheet.png", frameW: 32, frameH: 32, anims: { float: { frames: [0, 1, 2, 3, 4, 5, 6, 7], fps: 6 } }, anchor: "center", scale: 1, piSafe: true, fallback: "procedural" },
  // -------- props (baked pixel-art forms — no more rectangles)
  // props are sub-regions (rect: [sx,sy,sw,sh]) of the shared atlas
  // meadow_props_sheet.png — `atlas`+`rect` is external art; `bake` remains
  // the placeholder if the sheet is absent
  // Props render from their baked pixel-art forms for now. The Art Pack ships a
  // per-biome {biome}_props.png strip (640x96), but each biome's layout differs,
  // so wiring real per-biome prop slices is a later polish; the layered bands
  // already carry the scenery (cottages in mid, fences in foreground).
  lantern: { src: "lantern.png", bake: "lantern", frameW: 28, frameH: 46, anims: { lit: { frames: [0, 1], fps: 2 } }, anchor: "bottom-left", scale: 1, piSafe: true, fallback: "procedural" },
  house: { src: "house.png", bake: "cottage", frameW: 84, frameH: 80, anims: { idle: { frames: [0], fps: 1 } }, anchor: "bottom-left", scale: 1, piSafe: true, fallback: "procedural" },
  flower: { src: "flower.png", bake: "flower", frameW: 16, frameH: 22, anims: { sway: { frames: [0, 1, 2], fps: 3 } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  grass: { src: "grass.png", bake: "grass", frameW: 24, frameH: 16, anims: { sway: { frames: [0, 1], fps: 3 } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  sign: { src: "sign.png", bake: "sign", frameW: 28, frameH: 40, anims: { idle: { frames: [0], fps: 1 } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  door: { src: "door.png", frameW: 32, frameH: 48, anims: { closed: { frames: [0], fps: 1 }, open: { frames: [1], fps: 1 } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  gate: { src: "gate.png", frameW: 66, frameH: 62, anims: { closed: { frames: [0], fps: 1 }, open: { frames: [1], fps: 1 } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  bridge: { src: "bridge.png", frameW: 100, frameH: 42, anims: { idle: { frames: [0], fps: 1 } }, anchor: "bottom-left", scale: 1, piSafe: true, fallback: "procedural" },
  shrine: { src: "shrine.png", frameW: 44, frameH: 58, anims: { idle: { frames: [0], fps: 1 } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  // -------- per-biome foliage/trees (3 variants each, picked per placed tree)
  // + a universal rock set. `v` anim frames = the variant slots. neon skips
  // frame 1 (its pink mushroom cap was eaten by the magenta key — recolor to fix).
  meadowFoliage: { src: "meadow_pines_strip.png", frameW: 64, frameH: 84, anims: { v: { frames: [0, 1, 2] } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  neonFoliage: { src: "neon_forest_mushrooms_strip.png", frameW: 64, frameH: 84, anims: { v: { frames: [0, 2] } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  moonlitFoliage: { src: "moonlit_town_foliage_strip.png", frameW: 64, frameH: 84, anims: { v: { frames: [0, 1, 2] } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  arcadeFoliage: { src: "arcade_ruins_props_strip.png", frameW: 64, frameH: 84, anims: { v: { frames: [0, 1, 2] } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  castleFoliage: { src: "castle_approach_trees_strip.png", frameW: 64, frameH: 84, anims: { v: { frames: [0, 1, 2] } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  rocks: { src: "rocks_strip.png", frameW: 52, frameH: 40, anims: { v: { frames: [0, 1, 2] } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  // -------- per-biome gateway landmarks (the destination the hero passes). The
  // arcade gate is intentionally omitted — its pink/magenta parts were eaten by
  // the key (needs a recolored re-export), so arcade keeps the procedural landmark.
  meadowGate: { src: "gateMeadow.png", frameW: 112, frameH: 104, anims: { idle: { frames: [0] } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  neonGate: { src: "gateNeon.png", frameW: 112, frameH: 104, anims: { idle: { frames: [0] } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  moonlitGate: { src: "gateMoonlit.png", frameW: 112, frameH: 104, anims: { idle: { frames: [0] } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
  castleGate: { src: "gateCastle.png", frameW: 132, frameH: 108, anims: { idle: { frames: [0] } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },
};

// Parallax plates per biome: seamless horizontal-tiling strips. `src` (PNG)
// wins; `bake` is the placeholder. `layer` routes where it draws (sky /
// far / mid / foreground); sky is top-anchored, the rest bottom-anchored to
// groundBase + yOffset. `factor` is the scroll multiplier (depth).
export const PARALLAX_MANIFEST = {
  // Every world uses a single full-scene BACKDROP (the imported art is opaque
  // illustration scenes, not stackable transparent bands). Each sits in the sky
  // slot with backdrop:true, so drawMountains/drawForeground skip their
  // procedural layers. Swap art via the import script + reloadAssets().
  "meadow-road": [
    { id: "meadow-backdrop", layer: "sky", src: "meadow-road_backdrop.png", backdrop: true, width: 1440, height: 480, factor: 0.08, piSafe: false },
  ],
  "neon-forest": [
    { id: "neon-backdrop", layer: "sky", src: "neon-forest_backdrop.png", backdrop: true, width: 1440, height: 480, factor: 0.08, piSafe: false },
  ],
  "moonlit-town": [
    { id: "town-backdrop", layer: "sky", src: "moonlit-town_backdrop.png", backdrop: true, width: 1440, height: 480, factor: 0.08, piSafe: false },
  ],
  "arcade-ruins": [
    { id: "arcade-backdrop", layer: "sky", src: "arcade-ruins_backdrop.png", backdrop: true, width: 1440, height: 480, factor: 0.08, piSafe: false },
  ],
  "castle-approach": [
    { id: "castle-backdrop", layer: "sky", src: "castle-approach_backdrop.png", backdrop: true, width: 1440, height: 480, factor: 0.08, piSafe: false },
  ],
};

// Per-biome prop placement recipes for the PropField (world-anchored spans;
// only activates for props whose sheets are READY, so today with only the
// baked lantern demo it stays quiet unless renderMode uses it).
export const PROP_RECIPES = {
  "meadow-road": [
    // e.g. { asset: "flower", every: [26, 44], layer: "ground", canRelease: true },
  ],
  "neon-forest": [],
  "moonlit-town": [],
  "arcade-ruins": [],
  "castle-approach": [],
};

// ------------------------------------------------------------ baked demos
// Runtime-generated sheets proving the pipeline end-to-end with zero
// external files. Replace by setting `src` in the manifest — src wins.
const BAKERS = {
  // 5 orb power states + a musical-note glyph, 18×18 each: dim → radiant
  orb(c, entry) {
    const g = c.getContext("2d");
    const cx0 = 9;
    const disc = (ox, r, style) => {
      g.fillStyle = style;
      for (let dy = -r; dy <= r; dy++) {
        const half = Math.floor(Math.sqrt(r * r - dy * dy));
        g.fillRect(ox + cx0 - half, 9 + dy, half * 2 + 1, 1);
      }
    };
    for (let f = 0; f < 5; f++) {
      const ox = f * entry.frameW;
      const power = f / 4;
      disc(ox, 4 + Math.round(power * 3), `rgba(255,205,95,${0.12 + power * 0.14})`); // glow
      disc(ox, 3, `rgba(255,196,86,${0.55 + power * 0.35})`); // body
      g.fillStyle = `rgba(255,242,205,${0.8 + power * 0.2})`;
      g.fillRect(ox + cx0 - 1, 8, 2, 2); // core
      // a tiny musical note inside — this is the "last living note"
      g.fillStyle = `rgba(90,60,30,${0.55 + power * 0.35})`;
      g.fillRect(ox + cx0 + 1, 6, 1, 3); // note stem
      g.fillRect(ox + cx0 - 1, 8, 2, 1); // note head
      g.fillStyle = "rgba(255,255,248,0.95)";
      g.fillRect(ox + cx0 - 1, 7, 1, 1); // glint
      if (f >= 1) {
        g.fillStyle = `rgba(255,224,146,${0.3 + power * 0.4})`;
        const rr = 5 + Math.round(power * 2);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          g.fillRect(ox + cx0 + Math.round(Math.cos(a) * rr), 9 + Math.round(Math.sin(a) * rr), 1, 1);
        }
      }
      if (f >= 3) {
        g.fillStyle = `rgba(255,238,176,${0.5 + power * 0.4})`;
        const spokes = f === 3 ? 4 : 8;
        for (let i = 0; i < spokes; i++) {
          const a = (i / spokes) * Math.PI * 2;
          g.fillRect(ox + cx0 + Math.round(Math.cos(a) * 7), 9 + Math.round(Math.sin(a) * 7), 1, 1);
          if (f === 4) g.fillRect(ox + cx0 + Math.round(Math.cos(a) * 8), 9 + Math.round(Math.sin(a) * 8), 1, 1);
        }
      }
    }
  },

  // THE TRAVELER — 24×30, 6 frames: idle, idle-blink, walk1, walk2,
  // look-at-orb, celebrate. A small warm hooded human with a face, a cream
  // scarf, a short cape, a backpack, a belt, and a lantern-staff. Readable
  // from across the room; not masked, not armored.
  hero(c, entry) {
    const g = c.getContext("2d");
    const W = entry.frameW;
    const cx = 12; // figure centre within each frame
    const C = {
      hoodD: "rgb(116,40,42)", hood: "rgb(158,58,54)", hoodL: "rgb(188,82,70)",
      skin: "rgb(236,196,156)", skinS: "rgb(206,162,122)", eye: "rgb(46,32,42)",
      cloak: "rgb(150,52,54)", cloakL: "rgb(180,74,66)", cloakD: "rgb(110,36,42)",
      cape: "rgb(118,38,44)", scarf: "rgb(238,218,180)", scarfS: "rgb(206,182,142)",
      belt: "rgb(212,170,88)", packD: "rgb(96,66,40)", packL: "rgb(134,98,60)",
      boot: "rgb(66,48,38)", staff: "rgb(96,70,44)", lamp: "rgba(255,214,130,0.95)",
    };
    const R = (ox, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(ox + x, y, w, h); };
    // pose: legs "stand"|"w1"|"w2", arms "down"|"up", eyes "open"|"shut"|"up"
    const frame = (fi, legs, arms, eyes) => {
      const ox = fi * W;
      // short cape behind the body
      R(ox, cx - 5, 12, 3, 12, C.cape);
      R(ox, cx - 6, 15, 2, 7, C.cape);
      // backpack on his back (left)
      R(ox, cx - 6, 14, 3, 6, C.packD);
      R(ox, cx - 6, 14, 1, 6, C.packL);
      R(ox, cx - 5, 13, 2, 1, C.packL);
      // legs
      if (legs === "stand") {
        R(ox, cx - 3, 24, 2, 5, C.cloakD); R(ox, cx + 1, 24, 2, 5, C.cloakD);
        R(ox, cx - 3, 28, 3, 1, C.boot); R(ox, cx + 1, 28, 3, 1, C.boot);
      } else if (legs === "w1") {
        R(ox, cx - 4, 24, 2, 5, C.cloakD); R(ox, cx + 2, 24, 2, 4, C.cloakD);
        R(ox, cx - 5, 28, 3, 1, C.boot); R(ox, cx + 2, 27, 3, 1, C.boot);
      } else {
        R(ox, cx - 1, 24, 2, 5, C.cloakD); R(ox, cx + 1, 25, 2, 4, C.cloakD);
        R(ox, cx - 2, 28, 3, 1, C.boot); R(ox, cx + 1, 28, 3, 1, C.boot);
      }
      // cloak body (torso), lit on the right edge
      R(ox, cx - 4, 12, 9, 13, C.cloak);
      R(ox, cx + 4, 13, 1, 11, C.cloakL);
      R(ox, cx - 4, 12, 1, 12, C.cloakD);
      // belt
      R(ox, cx - 4, 19, 9, 1, C.belt);
      // scarf at the neck, trailing a little to the left
      R(ox, cx - 4, 11, 8, 2, C.scarf);
      R(ox, cx - 6, 12, 2, 1, C.scarfS);
      R(ox, cx - 5, 11, 1, 2, C.scarf);
      // arms
      if (arms === "up") {
        R(ox, cx - 5, 7, 2, 5, C.cloak); R(ox, cx + 4, 7, 2, 5, C.cloak);
        R(ox, cx - 5, 6, 2, 1, C.skin); R(ox, cx + 4, 6, 2, 1, C.skin);
      } else {
        R(ox, cx - 4, 13, 2, 7, C.cloak); // left arm
        R(ox, cx + 3, 13, 2, 7, C.cloak); // right arm holds the staff
        R(ox, cx + 3, 19, 2, 1, C.skin); // right hand
      }
      // head + hood
      R(ox, cx - 4, 3, 8, 2, C.hoodD); // hood crown
      R(ox, cx - 5, 4, 10, 3, C.hood);
      R(ox, cx - 5, 4, 1, 4, C.hoodD); R(ox, cx + 4, 4, 1, 4, C.hood);
      R(ox, cx - 5, 7, 1, 2, C.hood); R(ox, cx + 4, 7, 1, 2, C.hoodD);
      // face
      const fy = eyes === "up" ? 6 : 7;
      R(ox, cx - 3, 6, 6, 4, C.skin);
      R(ox, cx + 2, 6, 1, 4, C.skinS); // cheek shade
      R(ox, cx - 3, 9, 6, 1, C.skinS); // chin
      // eyes
      if (eyes === "shut") {
        R(ox, cx - 2, fy + 1, 1, 1, C.eye); R(ox, cx + 1, fy + 1, 1, 1, C.eye);
      } else {
        R(ox, cx - 2, fy, 1, 2, C.eye); R(ox, cx + 1, fy, 1, 2, C.eye);
        R(ox, cx - 2, fy, 1, 1, "rgba(255,255,255,0.5)"); // catchlight
      }
      // hood front brim shadow
      R(ox, cx - 4, 5, 8, 1, C.hoodD);
      // lantern-staff on the right (not during celebrate)
      if (arms !== "up") {
        R(ox, cx + 6, 8, 1, 18, C.staff);
        R(ox, cx + 5, 8, 3, 1, C.staff); // hook
        R(ox, cx + 5, 9, 3, 3, C.lamp); // lantern glass
        R(ox, cx + 6, 10, 1, 1, "rgba(255,248,220,0.95)"); // flame
      }
    };
    frame(0, "stand", "down", "open");
    frame(1, "stand", "down", "shut"); // idle blink
    frame(2, "w1", "down", "open");
    frame(3, "w2", "down", "open");
    frame(4, "stand", "down", "up"); // looking toward the orb
    frame(5, "stand", "up", "open"); // small celebration
  },

  // hanging lantern, 2 flicker frames, 14×22
  lantern(c, entry) {
    const g = c.getContext("2d");
    for (let f = 0; f < 2; f++) {
      const ox = f * entry.frameW;
      g.fillStyle = "rgb(34,28,34)";
      g.fillRect(ox + 2, 2, 2, 20); // post
      g.fillRect(ox + 2, 2, 8, 1); // arm
      g.fillRect(ox + 4, 3, 1, 1); // brace
      g.fillRect(ox + 1, 21, 4, 1); // plinth
      g.fillRect(ox + 8, 3, 1, 1); // hanger
      g.fillRect(ox + 7, 4, 3, 1); // cap
      g.fillRect(ox + 7, 9, 3, 1); // base
      g.fillStyle = f ? "rgba(255,196,110,0.95)" : "rgba(255,180,90,0.8)"; // glass
      g.fillRect(ox + 7, 5, 3, 4);
      g.fillStyle = "rgba(255,240,200,0.95)"; // flame
      g.fillRect(ox + 8, 6, 1, f ? 2 : 1);
    }
  },

  // a small cottage, 30×26: stone base, timber, pitched roof, warm window,
  // little chimney — reads clearly as "someone's home"
  cottage(c) {
    const g = c.getContext("2d");
    g.fillStyle = "rgb(58,44,38)"; // walls
    g.fillRect(4, 12, 22, 14);
    g.fillStyle = "rgb(74,58,48)"; // lit wall edge
    g.fillRect(4, 12, 1, 14);
    g.fillStyle = "rgb(40,30,26)"; // stone footing
    g.fillRect(4, 23, 22, 3);
    // pitched roof
    g.fillStyle = "rgb(44,32,40)";
    for (let i = 0; i < 8; i++) g.fillRect(2 + i, 12 - i, 26 - i * 2, 1);
    g.fillStyle = "rgb(60,46,54)";
    for (let i = 0; i < 8; i++) g.fillRect(2 + i, 12 - i, 2, 1); // roof lit edge
    // door
    g.fillStyle = "rgb(30,22,20)";
    g.fillRect(8, 18, 4, 8);
    g.fillStyle = "rgb(70,54,44)";
    g.fillRect(8, 18, 4, 1);
    // warm window with mullions
    g.fillStyle = "rgba(255,198,112,0.95)";
    g.fillRect(16, 16, 6, 5);
    g.fillStyle = "rgb(40,30,26)";
    g.fillRect(18, 16, 1, 5);
    g.fillRect(16, 18, 6, 1);
    // chimney
    g.fillStyle = "rgb(40,30,26)";
    g.fillRect(21, 5, 3, 5);
  },

  // a small flower, 7×9, 3 sway frames — a fragment source (glowing tip)
  flower(c, entry) {
    const g = c.getContext("2d");
    for (let f = 0; f < 3; f++) {
      const ox = f * entry.frameW;
      const lean = f - 1; // -1,0,1
      g.fillStyle = "rgb(38,70,42)"; // stem
      g.fillRect(ox + 3, 4, 1, 5);
      g.fillStyle = "rgb(52,92,54)"; // leaf
      g.fillRect(ox + 1 + (lean > 0 ? 1 : 0), 6, 2, 1);
      // petals
      g.fillStyle = "rgb(226,120,150)";
      g.fillRect(ox + 2 + lean, 1, 3, 3);
      g.fillStyle = "rgb(248,164,190)";
      g.fillRect(ox + 2 + lean, 1, 1, 1);
      // glowing centre (the note-light)
      g.fillStyle = "rgba(255,236,150,0.95)";
      g.fillRect(ox + 3 + lean, 2, 1, 1);
    }
  },

  // a grass clump, 9×7, 2 sway frames
  grass(c, entry) {
    const g = c.getContext("2d");
    for (let f = 0; f < 2; f++) {
      const ox = f * entry.frameW;
      const s = f ? 1 : -1;
      g.fillStyle = "rgb(40,74,46)";
      g.fillRect(ox + 4, 2, 1, 5); // tall centre blade
      g.fillStyle = "rgb(32,60,38)";
      g.fillRect(ox + 2 + (s > 0 ? 1 : 0), 3, 1, 4);
      g.fillRect(ox + 6 - (s > 0 ? 1 : 0), 3, 1, 4);
      g.fillRect(ox + 1, 4, 1, 3);
      g.fillRect(ox + 7, 4, 1, 3);
      g.fillStyle = "rgb(52,92,54)";
      g.fillRect(ox + 4, 2, 1, 1); // lit tip
    }
  },

  // a wooden path marker / sign, 11×15
  sign(c) {
    const g = c.getContext("2d");
    g.fillStyle = "rgb(74,54,36)"; // post
    g.fillRect(5, 5, 2, 10);
    g.fillStyle = "rgb(96,72,48)"; // board
    g.fillRect(1, 3, 9, 5);
    g.fillStyle = "rgb(120,92,60)";
    g.fillRect(1, 3, 9, 1);
    g.fillStyle = "rgb(54,40,28)"; // an arrow carved into it (points onward)
    g.fillRect(3, 5, 4, 1);
    g.fillRect(6, 4, 1, 3);
  },
};

// ---------------------------------------------------- parallax plate bakers
// Seamless horizontally-tiling canvas strips (period divides width), drawn
// bottom-anchored to groundBase. Meadow palette baked in — this is the
// Meadow Road art slice; other biomes stay procedural until their plates land.
const PARALLAX_BAKERS = {
  // far mountains: two layered blue ridges, moonlit rims
  meadowFar(c, ld) {
    const g = c.getContext("2d");
    const W = ld.width;
    const H = ld.height;
    const ridge = (x, base, a2, a3, ph) =>
      Math.round(base + a2 * Math.sin((2 * Math.PI * 2 * x) / W + ph) + a3 * Math.sin((2 * Math.PI * 3 * x) / W + ph * 1.7));
    // back ridge (farther, lighter)
    for (let x = 0; x < W; x++) {
      const y = ridge(x, H * 0.42, H * 0.16, H * 0.09, 0.6);
      g.fillStyle = "rgb(40,42,66)";
      g.fillRect(x, y, 1, H - y);
      g.fillStyle = "rgb(64,66,96)"; // moonlit rim
      g.fillRect(x, y, 1, 1);
    }
    // front ridge (nearer, darker)
    for (let x = 0; x < W; x++) {
      const y = ridge(x, H * 0.6, H * 0.2, H * 0.1, 2.3);
      g.fillStyle = "rgb(26,28,48)";
      g.fillRect(x, y, 1, H - y);
      g.fillStyle = "rgb(48,50,78)";
      g.fillRect(x, y, 1, 1);
    }
  },
  // mid hills: rolling green, a treeline of little pines, one lit cottage,
  // a couple of distant warm village lights
  meadowMid(c, ld) {
    const g = c.getContext("2d");
    const W = ld.width;
    const H = ld.height;
    const hill = (x) =>
      Math.round(H * 0.5 + H * 0.14 * Math.sin((2 * Math.PI * 2 * x) / W) + H * 0.08 * Math.sin((2 * Math.PI * 3 * x) / W + 0.7));
    for (let x = 0; x < W; x++) {
      const y = hill(x);
      g.fillStyle = "rgb(24,48,30)";
      g.fillRect(x, y, 1, H - y);
      g.fillStyle = "rgb(40,74,46)"; // grassy rim
      g.fillRect(x, y, 1, 1);
    }
    // little pine silhouettes along the crest
    g.fillStyle = "rgb(14,30,20)";
    for (let tx = 12; tx < W - 12; tx += 19) {
      const ty = hill(tx) - 1;
      for (let k = 0; k < 6; k++) g.fillRect(tx - k, ty - 5 + k, 1 + k * 2, 1); // triangle
      g.fillRect(tx, ty, 1, 2); // trunk
    }
    // a distant cottage with a warm window (seam-safe position)
    const hx = Math.round(W * 0.62);
    const hy = hill(hx);
    g.fillStyle = "rgb(20,34,24)";
    g.fillRect(hx - 4, hy - 7, 9, 7); // body
    for (let i = 0; i < 4; i++) g.fillRect(hx - 5 + i, hy - 7 - i, 11 - i * 2, 1); // roof
    g.fillStyle = "rgba(255,196,110,0.95)"; // window
    g.fillRect(hx - 1, hy - 5, 2, 2);
    // a couple of faint far village lights
    g.fillStyle = "rgba(255,206,130,0.8)";
    g.fillRect(Math.round(W * 0.2), hill(Math.round(W * 0.2)) - 1, 1, 1);
    g.fillRect(Math.round(W * 0.86), hill(Math.round(W * 0.86)) - 1, 1, 1);
  },
};

// ------------------------------------------------------------- AssetStore
export class AssetStore {
  constructor() {
    // each entry tracks status ("loading"|"ready"|"missing") AND source
    // ("external"|"baked"|"procedural") so the debug panel can be honest
    this.entries = {};
    for (const [id, def] of Object.entries(ASSET_MANIFEST)) {
      this.entries[id] = { def, sheet: null, status: "loading", source: "procedural" };
    }
    this.parallax = {}; // "biome/idx" -> { def, img, status, source }
    this.atlases = {}; // shared sheet filename -> { img, status, cbs }
  }

  // kick off loads + bakes; safe to call once at construction
  init() {
    for (const [id, e] of Object.entries(this.entries)) this.#loadEntry(id, e);
    for (const [biome, layers] of Object.entries(PARALLAX_MANIFEST)) {
      layers.forEach((ldef, i) => {
        const key = `${biome}/${i}`;
        this.parallax[key] = this.parallax[key] || { def: ldef, img: null, status: "loading", source: "procedural" };
        this.#loadPlate(this.parallax[key]);
      });
    }
  }

  #loadEntry(id, e) {
    const def = e.def;
    // atlas sub-region of a shared props sheet (loaded once, shared)
    if (def.atlas) {
      e.status = "loading";
      const onReady = (img) => {
        e.sheet = img;
        e.status = "ready";
        e.source = "external";
      };
      const onFail = () => {
        if (def.bake) this.#bake(id, e);
        else {
          e.status = "missing";
          e.source = "procedural";
        }
      };
      let a = this.atlases[def.atlas];
      if (a?.status === "ready") return onReady(a.img);
      if (a?.status === "missing") return onFail();
      if (!a) {
        a = this.atlases[def.atlas] = { img: null, status: "loading", cbs: [] };
        const img = new Image();
        img.onload = () => {
          a.img = img;
          a.status = "ready";
          a.cbs.forEach((c) => c.onReady(img));
        };
        img.onerror = () => {
          a.status = "missing";
          a.cbs.forEach((c) => c.onFail());
        };
        img.src = ASSET_BASE + def.atlas + "?t=" + Date.now();
      }
      a.cbs.push({ onReady, onFail });
      return;
    }
    if (def.src) {
      e.status = "loading";
      const img = new Image();
      img.onload = () => {
        e.sheet = img;
        e.status = "ready";
        e.source = "external"; // imported PNG is the source of truth
      };
      img.onerror = () => {
        if (def.bake) this.#bake(id, e); // fall back to the baked placeholder
        else {
          e.status = "missing";
          e.source = "procedural";
        }
      };
      img.src = ASSET_BASE + def.src + "?t=" + Date.now(); // cache-bust for hot reload
    } else if (def.bake) {
      this.#bake(id, e);
    } else {
      e.status = "missing";
      e.source = "procedural";
    }
  }

  #loadPlate(rec) {
    const ldef = rec.def;
    if (ldef.src) {
      rec.status = "loading";
      const img = new Image();
      img.onload = () => {
        rec.img = img;
        rec.status = "ready";
        rec.source = "external";
      };
      img.onerror = () => {
        if (ldef.bake) this.#bakePlate(rec);
        else {
          rec.status = "missing";
          rec.source = "procedural";
        }
      };
      img.src = ASSET_BASE + ldef.src + "?t=" + Date.now();
    } else if (ldef.bake) {
      this.#bakePlate(rec);
    } else {
      rec.status = "missing";
      rec.source = "procedural";
    }
  }

  // re-attempt every external load at runtime — drop a PNG then call this
  // (via pqAdventure.reloadAssets()) to see new art without a page reload
  reload() {
    this.atlases = {}; // drop cached sheets so they re-fetch
    for (const [id, e] of Object.entries(this.entries)) if (e.def.src || e.def.atlas) this.#loadEntry(id, e);
    for (const rec of Object.values(this.parallax)) if (rec.def.src) this.#loadPlate(rec);
  }

  #bakePlate(rec) {
    const c = document.createElement("canvas");
    c.width = rec.def.width;
    c.height = rec.def.height;
    PARALLAX_BAKERS[rec.def.bake]?.(c, rec.def);
    rec.img = c;
    rec.status = "ready";
    rec.source = "baked";
  }

  // is a specific parallax LAYER ("sky"|"far"|"mid"|"foreground") ready?
  hasReadyLayer(biome, layer) {
    const layers = PARALLAX_MANIFEST[biome] || [];
    return layers.some((ld, i) => ld.layer === layer && this.parallax[`${biome}/${i}`]?.status === "ready");
  }
  // is a full-scene BACKDROP present + ready for this biome? (a single opaque
  // wallpaper that stands in for sky+mountains+foreground; when true the caller
  // skips its procedural mountains/foreground so nothing draws over the scene)
  hasBackdrop(biome) {
    const layers = PARALLAX_MANIFEST[biome] || [];
    return layers.some((ld, i) => ld.backdrop && this.parallax[`${biome}/${i}`]?.status === "ready");
  }
  // draw all ready plates of a biome in a given layer
  drawParallaxLayer(o, biome, layer, scrollX, pw, groundBase) {
    const layers = PARALLAX_MANIFEST[biome] || [];
    let drew = false;
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].layer !== layer) continue;
      if (this.drawParallax(o, biome, i, scrollX, pw, groundBase)) drew = true;
    }
    return drew;
  }

  #bake(id, e) {
    const def = e.def;
    const frames = Math.max(...Object.values(def.anims).flatMap((a) => a.frames)) + 1;
    const c = document.createElement("canvas");
    c.width = def.frameW * frames;
    c.height = def.frameH;
    BAKERS[def.bake]?.(c, def);
    e.sheet = c;
    e.status = "ready";
    e.source = "baked";
  }

  ready(id) {
    return this.entries[id]?.status === "ready";
  }
  sourceOf(id) {
    return this.entries[id]?.source || "procedural";
  }
  // full honest inventory for the debug panel / console
  summary() {
    const sprites = Object.entries(this.entries).map(([id, e]) => ({ id, status: e.status, source: e.source }));
    const plates = Object.entries(this.parallax).map(([key, r]) => ({ id: key, status: r.status, source: r.source }));
    const count = (arr, s) => arr.filter((a) => a.source === s).length;
    const all = [...sprites, ...plates];
    return { sprites, plates, external: count(all, "external"), baked: count(all, "baked"), procedural: all.length - count(all, "external") - count(all, "baked") };
  }

  // pixel-perfect animated sprite draw onto the low-res offscreen.
  // t drives the animation clock; anchor resolves x/y meaning.
  drawSprite(o, id, animName, t, x, y, opts = {}) {
    const e = this.entries[id];
    if (!e || e.status !== "ready") return false;
    const def = e.def;
    // artScale keeps sprites the same on-screen size at any render resolution:
    // art is authored at the 320px reference height and drawn down when the
    // canvas is smaller (Pi runs a lower pixelHeight — assets adapt, no re-import).
    const scale = (opts.scale ?? def.scale) * (this.artScale ?? 1);
    // source rect: either an atlas sub-region, or a strip frame (fi*frameW)
    let sx, sy, sw, sh;
    if (def.rect && e.source === "external") {
      [sx, sy, sw, sh] = def.rect;
    } else {
      const anim = def.anims[animName] || def.anims[Object.keys(def.anims)[0]];
      // opts.frame selects a frame INDEX directly (caller drives cadence — e.g.
      // the hero's walk steps with his stride, not a fixed fps); otherwise the
      // animation clock `t` advances at the anim's fps.
      const fi = opts.frame != null
        ? anim.frames[((opts.frame % anim.frames.length) + anim.frames.length) % anim.frames.length]
        : anim.frames[Math.floor(t * anim.fps) % anim.frames.length];
      sw = def.frameW;
      sh = def.frameH;
      sx = fi * def.frameW;
      sy = 0;
    }
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    let dx = x;
    let dy = y;
    const anchor = opts.anchor ?? def.anchor;
    if (anchor === "bottom-center") {
      dx = x - (w >> 1);
      dy = y - h;
    } else if (anchor === "bottom-left") {
      dy = y - h;
    } else if (anchor === "center") {
      dx = x - (w >> 1);
      dy = y - (h >> 1);
    }
    const prevSmooth = o.imageSmoothingEnabled;
    o.imageSmoothingEnabled = false; // crisp pixels, never blurry
    if (opts.alpha != null) {
      o.save();
      o.globalAlpha = opts.alpha;
      o.drawImage(e.sheet, sx, sy, sw, sh, dx, dy, w, h);
      o.restore();
    } else {
      o.drawImage(e.sheet, sx, sy, sw, sh, dx, dy, w, h);
    }
    o.imageSmoothingEnabled = prevSmooth;
    return true;
  }

  // horizontally-tiled parallax plate; bottom-anchored to groundBase
  // (+yOffset) unless layer:"sky" (top-anchored to 0)
  drawParallax(o, biome, idx, scrollX, pw, groundBase) {
    const rec = this.parallax[`${biome}/${idx}`];
    if (!rec || rec.status !== "ready") return false;
    const img = rec.img;
    const as = this.artScale ?? 1; // scale plates with the render resolution too
    const w = Math.max(1, Math.round(img.width * as));
    const h = Math.max(1, Math.round(img.height * as));
    const off = (((Math.round(scrollX * rec.def.factor) % w) + w) % w); // safe modulo
    const y = rec.def.layer === "sky" ? 0 : Math.round(groundBase) - h + Math.round((rec.def.yOffset || 0) * as);
    const prevSmooth = o.imageSmoothingEnabled;
    o.imageSmoothingEnabled = false;
    for (let x = -off; x < pw; x += w) o.drawImage(img, 0, 0, img.width, img.height, x, y, w, h);
    o.imageSmoothingEnabled = prevSmooth;
    return true;
  }

  status() {
    const out = {};
    for (const [id, e] of Object.entries(this.entries)) out[id] = `${e.status} (${e.source})`;
    return out;
  }
}

// ------------------------------------------------------------ prop field
// World-anchored asset props built from PROP_RECIPES for the active biome.
// Only recipes whose sheet is ready produce props; everything else stays
// with the procedural roadside systems. Props can be fragment SOURCES.
export class PropField {
  constructor(pq, assets) {
    this.pq = pq;
    this.assets = assets;
    this.props = [];
    this.biome = null;
  }
  rebuild(biomeName, worldLen, rnd = Math.random) {
    this.biome = biomeName;
    this.props.length = 0;
    for (const recipe of PROP_RECIPES[biomeName] || []) {
      if (!this.assets.ready(recipe.asset)) continue;
      const [lo, hi] = recipe.every;
      for (let x = 20 + rnd() * hi; x < worldLen - 20; x += lo + rnd() * (hi - lo)) {
        this.props.push({
          x,
          asset: recipe.asset,
          layer: recipe.layer || "ground",
          scale: recipe.scale || 1,
          anim: recipe.anim || Object.keys(ASSET_MANIFEST[recipe.asset].anims)[0],
          canRelease: !!recipe.canRelease,
          brightness: 1,
          _srcGlow: 0,
          story: recipe.story || "decor",
        });
      }
    }
  }
  draw(o, layer, parallaxFactor = 0.7) {
    const pq = this.pq;
    const L = pq.worldLen;
    const off = pq.scrollX * parallaxFactor;
    for (const p of this.props) {
      if (p.layer !== layer) continue;
      const sx = Math.round((((p.x - off) % L) + L) % L);
      if (sx < -30 || sx > pq.pw + 30) continue;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      this.assets.drawSprite(o, p.asset, p.anim, pq.t, sx, gy, { scale: p.scale });
    }
  }
  // fragment-source candidates near the hero (mirrors #worldSource contract)
  sourcesNear(heroX, range, parallaxFactor = 0.7) {
    const pq = this.pq;
    const L = pq.worldLen;
    const off = pq.scrollX * parallaxFactor;
    const out = [];
    for (const p of this.props) {
      if (!p.canRelease) continue;
      const sx = (((p.x - off) % L) + L) % L;
      if (sx > heroX - range && sx < heroX + 30) out.push({ x: sx, y: pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) - 6, obj: p });
    }
    return out;
  }
}

// ------------------------------------------------------------ glow queue
// A capped batch of additive light requests flushed once per frame with
// composite "lighter" — one save/restore total, Pi-friendly. pi_safe skips.
export class GlowQueue {
  constructor(cap = 24) {
    this.cap = cap;
    this.items = []; // reused between frames
    this.count = 0;
  }
  push(x, y, r, rgb, a) {
    if (this.count >= this.cap) return;
    const it = this.items[this.count] || (this.items[this.count] = {});
    it.x = x;
    it.y = y;
    it.r = r;
    it.rgb = rgb;
    it.a = a;
    this.count++;
  }
  flush(o, pixelDisc) {
    if (!this.count) return;
    o.save();
    o.globalCompositeOperation = "lighter";
    for (let i = 0; i < this.count; i++) {
      const it = this.items[i];
      o.fillStyle = `rgba(${it.rgb},${it.a})`;
      pixelDisc(o, Math.round(it.x), Math.round(it.y), Math.round(it.r));
    }
    o.restore();
    this.count = 0;
  }
}

// ------------------------------------------------------------ perf meter
export class PerfMeter {
  constructor() {
    this.fps = 60;
    this.frameMs = 16.7;
    this._last = 0;
  }
  tick(now) {
    if (this._last) {
      const ms = now - this._last;
      this.frameMs += (ms - this.frameMs) * 0.05;
      this.fps += (1000 / Math.max(1, ms) - this.fps) * 0.05;
    }
    this._last = now;
  }
}
