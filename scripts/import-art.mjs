#!/usr/bin/env bun
/**
 * Pixel Quest — art import pipeline.
 *
 * Turns raw generated images (ChatGPT / GPT-4o, any format/size, white OR
 * magenta OR transparent background) into engine-ready pixel-art assets.
 * Four asset shapes, chosen by filename:
 *
 *   SPRITE SHEET  hero_traveler_sheet · orb_note_states · fragments_music_sheet
 *       → keys the background, detects each frame by its gaps, and RE-PACKS them
 *         onto an even grid at the exact size the engine slices.
 *   BACKDROP      {biome}_backdrop        (e.g. meadow-road_backdrop.png)
 *       → a full opaque scene. Downscaled to fill the canvas; drawn behind
 *         everything (the engine suppresses procedural mountains when present).
 *   BAND          {biome}_{sky|far|mid|foreground}   (transparent parallax strips)
 *   PROP GRID     {biome}_props            (kept as a grid; slice rects measured later)
 *
 *   1. Drop raw images in   public/assets/pixelquest/raw/
 *   2. Run                  bun run art:import
 *   3. In the app console    pqAdventure.reloadAssets()
 *
 * The background is auto-detected from the image corners (white / magenta /
 * solid) and removed by flooding IN from the edges — so background-colored
 * details INSIDE the art (white fur, magenta neon) are never erased.
 *
 * Flags: --colors N · --no-quantize · --key RRGGBB (force a key color) · --only NAME
 */
import sharp from "sharp";
import { readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = path.resolve(HERE, "../public/assets/pixelquest");
const RAW_DIR = path.join(ASSET_DIR, "raw");

const BIOMES = ["meadow-road", "neon-forest", "moonlit-town", "arcade-ruins", "castle-approach"];
const SHEET_SPECS = {
  // sized for the 2x internal resolution (pixelHeight 320): 48x60 hero, 48px orb, etc.
  hero_traveler_sheet: { mode: "sheet", w: 384, h: 60, frames: 8, anchor: "bottom", colors: 32 },
  hero_walking_sheet: { mode: "sheet", w: 288, h: 49, frames: 6, anchor: "bottom", colors: 32 }, // fluid 6-frame walk; h=49 so the char is ~48px (matches the traveler idle)
  orb_note_states: { mode: "sheet", w: 240, h: 48, frames: 5, anchor: "center", colors: 32, tight: 0.34 },
  fragments_music_sheet: { mode: "sheet", w: 256, h: 32, frames: 8, anchor: "center", colors: 24 },
  // props & landmarks — magenta-keyed sprite strips, authored at the 320 reference.
  // w = frameW * frames (kept in sync with ASSET_MANIFEST frameW/frameH).
  lantern: { mode: "sheet", w: 56, h: 46, frames: 2, anchor: "bottom", colors: 32 },
  house: { mode: "sheet", w: 84, h: 80, frames: 1, anchor: "bottom", colors: 48 },
  flower: { mode: "sheet", w: 48, h: 22, frames: 3, anchor: "bottom", colors: 24 },
  grass: { mode: "sheet", w: 48, h: 16, frames: 2, anchor: "bottom", colors: 24 },
  sign: { mode: "sheet", w: 28, h: 40, frames: 1, anchor: "bottom", colors: 32 },
  door: { mode: "sheet", w: 64, h: 48, frames: 2, anchor: "bottom", colors: 32 },
  gate: { mode: "sheet", w: 132, h: 62, frames: 2, anchor: "bottom", colors: 40 },
  bridge: { mode: "sheet", w: 100, h: 42, frames: 1, anchor: "bottom", colors: 40 },
  shrine: { mode: "sheet", w: 44, h: 58, frames: 1, anchor: "bottom", colors: 40 },
  // per-biome foliage/trees (3 variants each) + a universal rock set. Trees are
  // taller than the 48px hero. w = frameW * frames.
  meadow_pines_strip: { mode: "sheet", w: 192, h: 84, frames: 3, anchor: "bottom", colors: 40 },
  neon_forest_mushrooms_strip: { mode: "sheet", w: 192, h: 84, frames: 3, anchor: "bottom", colors: 40 },
  moonlit_town_foliage_strip: { mode: "sheet", w: 192, h: 84, frames: 3, anchor: "bottom", colors: 40 },
  castle_approach_trees_strip: { mode: "sheet", w: 192, h: 84, frames: 3, anchor: "bottom", colors: 40 },
  arcade_ruins_props_strip: { mode: "sheet", w: 192, h: 84, frames: 3, anchor: "bottom", colors: 40 },
  rocks_strip: { mode: "sheet", w: 156, h: 40, frames: 3, anchor: "bottom", colors: 32 },
  // per-biome gateway landmarks (sliced from pixelquest_pack_gates grid).
  gateMeadow: { mode: "sheet", w: 112, h: 104, frames: 1, anchor: "bottom", colors: 48 },
  gateNeon: { mode: "sheet", w: 112, h: 104, frames: 1, anchor: "bottom", colors: 48 },
  gateMoonlit: { mode: "sheet", w: 112, h: 104, frames: 1, anchor: "bottom", colors: 48 },
  gateArcade: { mode: "sheet", w: 116, h: 104, frames: 1, anchor: "bottom", colors: 48 },
  gateCastle: { mode: "sheet", w: 132, h: 108, frames: 1, anchor: "bottom", colors: 48 },
  // cameo / easter-egg pack sprites (sliced from pixelquest_pack_* grids by
  // scripts/slice-packs.mjs). Single-frame; sizes match each sliced sprite's aspect.
  discoMoon: { mode: "sheet", w: 71, h: 72, frames: 1, anchor: "bottom", colors: 40 },
  recordMoon: { mode: "sheet", w: 71, h: 72, frames: 1, anchor: "bottom", colors: 40 },
  winkMoon: { mode: "sheet", w: 71, h: 72, frames: 1, anchor: "bottom", colors: 40 },
  windmill: { mode: "sheet", w: 87, h: 92, frames: 1, anchor: "bottom", colors: 48 },
  campfire: { mode: "sheet", w: 104, h: 92, frames: 1, anchor: "bottom", colors: 48 },
  brazier: { mode: "sheet", w: 67, h: 92, frames: 1, anchor: "bottom", colors: 48 },
  snail: { mode: "sheet", w: 148, h: 92, frames: 1, anchor: "bottom", colors: 48 },
  jukebox: { mode: "sheet", w: 81, h: 92, frames: 1, anchor: "bottom", colors: 48 },
  phoneBooth: { mode: "sheet", w: 79, h: 92, frames: 1, anchor: "bottom", colors: 48 },
  swordInStone: { mode: "sheet", w: 110, h: 92, frames: 1, anchor: "bottom", colors: 48 },
  secretDoor: { mode: "sheet", w: 139, h: 92, frames: 1, anchor: "bottom", colors: 48 },
  statue: { mode: "sheet", w: 118, h: 92, frames: 1, anchor: "bottom", colors: 48 },
  arcadeCabinet: { mode: "sheet", w: 76, h: 104, frames: 1, anchor: "bottom", colors: 48 },
  blueTimeBooth: { mode: "sheet", w: 57, h: 104, frames: 1, anchor: "bottom", colors: 48 },
  ghostTrap: { mode: "sheet", w: 88, h: 104, frames: 1, anchor: "bottom", colors: 48 },
  neonDinerSign: { mode: "sheet", w: 72, h: 104, frames: 1, anchor: "bottom", colors: 48 },
  magicMicrophone: { mode: "sheet", w: 62, h: 104, frames: 1, anchor: "bottom", colors: 48 },
  skyDragon: { mode: "sheet", w: 78, h: 74, frames: 1, anchor: "bottom", colors: 40 },
  pirateShip: { mode: "sheet", w: 72, h: 74, frames: 1, anchor: "bottom", colors: 40 },
  witchBroom: { mode: "sheet", w: 103, h: 74, frames: 1, anchor: "bottom", colors: 40 },
  wingedShadow: { mode: "sheet", w: 66, h: 74, frames: 1, anchor: "bottom", colors: 40 },
  bicycleRider: { mode: "sheet", w: 79, h: 74, frames: 1, anchor: "bottom", colors: 40 },
  spyRope: { mode: "sheet", w: 29, h: 74, frames: 1, anchor: "bottom", colors: 40 },
  meteorCassette: { mode: "sheet", w: 94, h: 74, frames: 1, anchor: "bottom", colors: 40 },
  sharkFin: { mode: "sheet", w: 104, h: 60, frames: 1, anchor: "bottom", colors: 40 },
  submarinePeriscope: { mode: "sheet", w: 72, h: 60, frames: 1, anchor: "bottom", colors: 40 },
  sportsCar: { mode: "sheet", w: 188, h: 60, frames: 1, anchor: "bottom", colors: 40 },
  boulder: { mode: "sheet", w: 81, h: 60, frames: 1, anchor: "bottom", colors: 40 },
  blackCat: { mode: "sheet", w: 86, h: 60, frames: 1, anchor: "bottom", colors: 40 },
  redBalloon: { mode: "sheet", w: 44, h: 60, frames: 1, anchor: "bottom", colors: 40 },
  cassetteTumbleweed: { mode: "sheet", w: 84, h: 60, frames: 1, anchor: "bottom", colors: 40 },
  giantCreature: { mode: "sheet", w: 156, h: 78, frames: 1, anchor: "bottom", colors: 40 },
  dinosaur: { mode: "sheet", w: 278, h: 78, frames: 1, anchor: "bottom", colors: 40 },
  robotDuo: { mode: "sheet", w: 140, h: 78, frames: 1, anchor: "bottom", colors: 40 },
  glamGuitarist: { mode: "sheet", w: 121, h: 78, frames: 1, anchor: "bottom", colors: 40 },
  keyboardPlayer: { mode: "sheet", w: 147, h: 78, frames: 1, anchor: "bottom", colors: 40 },
  tinyDrummer: { mode: "sheet", w: 162, h: 78, frames: 1, anchor: "bottom", colors: 40 },
  craneKick: { mode: "sheet", w: 130, h: 78, frames: 1, anchor: "bottom", colors: 40 },
  maskedShadow: { mode: "sheet", w: 120, h: 78, frames: 1, anchor: "bottom", colors: 40 },
  detectiveRain: { mode: "sheet", w: 121, h: 78, frames: 1, anchor: "bottom", colors: 40 },
  steamTrain: { mode: "sheet", w: 200, h: 78, frames: 1, anchor: "bottom", colors: 40 },
  ballroomWindow: { mode: "sheet", w: 140, h: 78, frames: 1, anchor: "bottom", colors: 40 },
  fedora: { mode: "sheet", w: 56, h: 40, frames: 1, anchor: "bottom", colors: 32 },
  sunglasses: { mode: "sheet", w: 77, h: 40, frames: 1, anchor: "bottom", colors: 32 },
  cape: { mode: "sheet", w: 38, h: 40, frames: 1, anchor: "bottom", colors: 32 },
  redShoes: { mode: "sheet", w: 59, h: 40, frames: 1, anchor: "bottom", colors: 32 },
  boombox: { mode: "sheet", w: 49, h: 40, frames: 1, anchor: "bottom", colors: 32 },
  powerGlove: { mode: "sheet", w: 35, h: 40, frames: 1, anchor: "bottom", colors: 32 },
  whip: { mode: "sheet", w: 48, h: 40, frames: 1, anchor: "bottom", colors: 32 },
  hoverboard: { mode: "sheet", w: 52, h: 40, frames: 1, anchor: "bottom", colors: 32 },
};
const BAND_SPECS = {
  sky: { w: 640, h: 180, key: false },
  far: { w: 320, h: 80, key: true },
  mid: { w: 640, h: 120, key: true },
  foreground: { w: 640, h: 80, key: true },
};
const BACKDROP = { mode: "backdrop", w: 1440, h: 480, colors: 80 }; // 2x for pixelHeight 320; wide enough to cover the 1280px canvas without tiling
const PROPS = { mode: "props", w: 640, h: 96, colors: 32 }; // pack props are a 640x96 horizontal strip

// ---- args ----------------------------------------------------------------
const args = process.argv.slice(2);
const getFlag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(n);
const OPT = {
  colors: getFlag("--colors") ? parseInt(getFlag("--colors"), 10) : null,
  quantize: !has("--no-quantize"),
  only: getFlag("--only")?.replace(/\.png$/i, ""),
  forceKey: getFlag("--key") ? [0, 2, 4].map((i) => parseInt(getFlag("--key").replace(/^#/, "").slice(i, i + 2), 16)) : null,
};

// ---- spec resolution -----------------------------------------------------
function specFor(base) {
  if (SHEET_SPECS[base]) return { kind: base, ...SHEET_SPECS[base] };
  const us = base.lastIndexOf("_");
  if (us < 0) return null;
  const biome = base.slice(0, us), tail = base.slice(us + 1);
  if (!BIOMES.includes(biome)) return null;
  if (tail === "backdrop") return { kind: `${biome} backdrop`, ...BACKDROP };
  if (tail === "props") return { kind: `${biome} props`, ...PROPS };
  if (BAND_SPECS[tail]) return { kind: `${biome} ${tail}`, mode: "band", colors: 48, ...BAND_SPECS[tail] };
  return null;
}

// ---- background detection + connectivity keying --------------------------
// Sample the border, decide whether the background is white / magenta / a
// solid color, and return predicates for "is background" (loose, for the
// flood) and "is definitely background" (tight, for enclosed pockets).
function detectKey(data, W, H) {
  if (OPT.forceKey) {
    const [kr, kg, kb] = OPT.forceKey;
    const d = (r, g, b) => Math.abs(r - kr) + Math.abs(g - kg) + Math.abs(b - kb);
    return { loose: (r, g, b) => d(r, g, b) < 150, tight: (r, g, b) => d(r, g, b) < 70, name: `#${getFlag("--key")}` };
  }
  // sample a dense ring around the whole border (content often touches an edge,
  // so a handful of corner samples can miss the real background)
  const pts = [];
  const at = (x, y) => { const i = (y * W + x) * 4; pts.push([data[i], data[i + 1], data[i + 2]]); };
  for (let k = 0; k <= 24; k++) { const fx = Math.round((k / 24) * (W - 1)), fy = Math.round((k / 24) * (H - 1)); at(fx, 0); at(fx, H - 1); at(0, fy); at(W - 1, fy); }
  const isWhite = (r, g, b) => Math.min(r, g, b) > 232;
  const isPureMagenta = (r, g, b) => r > 210 && g < 70 && b > 210; // deliberate chroma key
  const isMagenta = (r, g, b) => Math.min(r, b) > 90 && Math.min(r, b) - g > 55;
  const whiteN = pts.filter((p) => isWhite(...p)).length;
  const magN = pts.filter((p) => isPureMagenta(...p)).length;
  // magenta is a deliberate chroma key — its presence anywhere on the border wins
  if (magN >= 3) return { loose: isMagenta, tight: (r, g, b) => Math.min(r, b) > 150 && Math.min(r, b) - g > 120, name: "magenta" };
  if (whiteN >= pts.length * 0.55) return { loose: (r, g, b) => Math.min(r, g, b) > 224, tight: (r, g, b) => Math.min(r, g, b) > 242, name: "white" };
  // solid: average the corners
  const avg = [0, 1, 2].map((k) => Math.round(pts.reduce((s, p) => s + p[k], 0) / pts.length));
  const d = (r, g, b) => Math.abs(r - avg[0]) + Math.abs(g - avg[1]) + Math.abs(b - avg[2]);
  return { loose: (r, g, b) => d(r, g, b) < 140, tight: (r, g, b) => d(r, g, b) < 60, name: `solid(${avg})` };
}

function keyBackground(data, W, H, key) {
  const N = W * H, bg = new Uint8Array(N), stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x; if (bg[p]) return; const i = p * 4;
    if (key.loose(data[i], data[i + 1], data[i + 2])) { bg[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) { const p = stack.pop(), x = p % W, y = (p / W) | 0; push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1); }
  let keyed = 0;
  for (let p = 0; p < N; p++) { const i = p * 4; if (bg[p] || key.tight(data[i], data[i + 1], data[i + 2])) { if (data[i + 3] !== 0) keyed++; data[i + 3] = 0; } }
  return keyed;
}
const snapAlpha = (data, opaque) => { for (let i = 3; i < data.length; i += 4) data[i] = opaque ? 255 : (data[i] >= 128 ? 255 : 0); };
const encode = (buf, w, h, spec) => OPT.quantize
  ? sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png({ palette: true, colors: OPT.colors || spec.colors, dither: 0, effort: 10 })
  : sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 });
const outPath = (file) => path.join(ASSET_DIR, `${path.basename(file).replace(/\.[^.]+$/, "")}.png`);

// ---- sheet repack --------------------------------------------------------
function segmentFrames(cov, W, frames) {
  const spans = []; let s = -1;
  for (let x = 0; x <= W; x++) {
    const e = x === W ? true : cov[x] < 3;
    if (!e && s < 0) s = x;
    else if (e && s >= 0) { if (x - s > W * 0.012) spans.push([s, x - 1]); s = -1; }
  }
  if (spans.length === frames) return spans;
  if (spans.length > frames) {
    // detached bits (floating note glyphs, sparkles) become extra spans — keep
    // the `frames` widest (the characters), drop the little ones, re-sort by x.
    return spans.map((sp) => ({ sp, w: sp[1] - sp[0] })).sort((a, b) => b.w - a.w).slice(0, frames).map((o) => o.sp).sort((a, b) => a[0] - b[0]);
  }
  const even = []; // fewer spans than expected → even split
  for (let i = 0; i < frames; i++) even.push([Math.round((i * W) / frames), Math.round(((i + 1) * W) / frames) - 1]);
  return even;
}
// erode the light halo left by white-background anti-aliasing: near-white
// opaque pixels touching transparency get cut (2 passes). Kills the "white dots".
function defringe(data, W, H) {
  for (let pass = 0; pass < 2; pass++) {
    const kill = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] < 128) continue;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 178) continue; // only near-white edge pixels
      let edge = false;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || data[(ny * W + nx) * 4 + 3] < 128) { edge = true; break; }
      }
      if (edge) kill.push(i);
    }
    for (const i of kill) data[i + 3] = 0;
    // also drop tiny orphan specks (opaque pixel with <2 opaque neighbours)
    const orphan = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; if (data[i + 3] < 128) continue;
      let n = 0; for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && data[(ny * W + nx) * 4 + 3] >= 128) n++; }
      if (n < 2) orphan.push(i);
    }
    for (const i of orphan) data[i + 3] = 0;
  }
}

// magenta de-spill: soft edges over a magenta key pick up a pink/coral cast
// (R and B pushed up, G suppressed). Pull R and B back toward G where they
// exceed it, which restores gold/warm glow and leaves true blues mostly intact.
function despillMagenta(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const spill = (r + b) / 2 - g;
    if (spill > 0) { data[i] = Math.max(0, Math.round(r - spill * 0.85)); data[i + 2] = Math.max(0, Math.round(b - spill * 0.85)); }
  }
}

// find a frame's tight content bbox within its column span
function frameBox(data, W, H, x0, x1, alphaAt, tight) {
  let y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) { let hit = false; for (let x = x0; x <= x1; x++) if (alphaAt(x, y) > 40) { hit = true; break; } if (hit) { if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (y1 < 0) return null;
  if (tight) {
    const colc = [], rowc = []; let pc = 0, pr = 0;
    for (let x = x0; x <= x1; x++) { let c = 0; for (let y = y0; y <= y1; y++) if (alphaAt(x, y) > 120) c++; colc[x] = c; if (c > pc) pc = c; }
    for (let y = y0; y <= y1; y++) { let c = 0; for (let x = x0; x <= x1; x++) if (alphaAt(x, y) > 120) c++; rowc[y] = c; if (c > pr) pr = c; }
    const tc = tight * pc, tr = tight * pr;
    while (x0 < x1 && colc[x0] < tc) x0++;
    while (x1 > x0 && colc[x1] < tc) x1--;
    while (y0 < y1 && rowc[y0] < tr) y0++;
    while (y1 > y0 && rowc[y1] < tr) y1--;
  }
  return [x0, y0, x1, y1];
}

async function processSheet(file, spec) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const key = detectKey(data, W, H);
  keyBackground(data, W, H, key); // -> alpha 0 on background
  // de-fringe ONLY for white backgrounds (their AA leaves a light halo). Magenta
  // and transparent key cleanly, and de-fringing them just erodes real glow/sparkles.
  if (key.name === "white") defringe(data, W, H);
  else if (key.name === "magenta") despillMagenta(data, W, H); // kill the pink/coral halo
  const alphaAt = (x, y) => data[(y * W + x) * 4 + 3];
  const cov = new Array(W).fill(0);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (alphaAt(x, y) > 40) cov[x]++;
  const spans = segmentFrames(cov, W, spec.frames);

  const cellW = spec.w / spec.frames, pad = 1;
  // PASS 1: measure every frame, then pick ONE scale so all frames are the same
  // size (no per-frame size jitter — the root cause of the "whack" walk).
  const boxes = spans.map(([x0, x1]) => frameBox(data, W, H, x0, x1, alphaAt, spec.tight));
  let maxBw = 1, maxBh = 1;
  for (const b of boxes) { if (!b) continue; const bw = b[2] - b[0] + 1, bh = b[3] - b[1] + 1; if (bw > maxBw) maxBw = bw; if (bh > maxBh) maxBh = bh; }
  const maxW = cellW - pad * 2, maxH = spec.h - (spec.anchor === "bottom" ? 1 : 2);
  const gScale = Math.min(maxW / maxBw, maxH / maxBh);

  // PASS 2: place every frame at gScale, feet on a shared baseline (bbox bottom
  // → cell bottom) so the character never changes size or bobs between frames.
  const target = Buffer.alloc(spec.w * spec.h * 4);
  for (let f = 0; f < spec.frames; f++) {
    const b = boxes[f]; if (!b) continue;
    const [x0, y0, x1, y1] = b, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const crop = Buffer.alloc(bw * bh * 4);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const si = ((y0 + y) * W + (x0 + x)) * 4, di = (y * bw + x) * 4;
      crop[di] = data[si]; crop[di + 1] = data[si + 1]; crop[di + 2] = data[si + 2]; crop[di + 3] = data[si + 3];
    }
    const fw = Math.max(1, Math.round(bw * gScale)), fh = Math.max(1, Math.round(bh * gScale));
    const frame = await sharp(crop, { raw: { width: bw, height: bh, channels: 4 } }).resize(fw, fh, { kernel: "nearest", fit: "fill" }).raw().toBuffer();
    const left = Math.round(f * cellW + (cellW - fw) / 2);
    const top = spec.anchor === "bottom" ? spec.h - fh : Math.round((spec.h - fh) / 2);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const tx = left + x, ty = top + y;
      if (tx < 0 || ty < 0 || tx >= spec.w || ty >= spec.h) continue;
      const si = (y * fw + x) * 4;
      if (frame[si + 3] < 128) continue;
      const di = (ty * spec.w + tx) * 4;
      target[di] = frame[si]; target[di + 1] = frame[si + 1]; target[di + 2] = frame[si + 2]; target[di + 3] = 255;
    }
  }
  await encode(target, spec.w, spec.h, spec).toFile(outPath(file));
  return { detected: spans.length, frames: spec.frames };
}

// ---- flat: backdrop / band / props ---------------------------------------
async function processFlat(file, spec) {
  const { data, info } = await sharp(file).ensureAlpha().resize(spec.w, spec.h, { kernel: "nearest", fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let keyed = 0;
  if (spec.mode === "backdrop") {
    // a backdrop is normally an opaque dark scene, but some art comes on a
    // white/magenta chroma background — key that out so the engine's dark sky
    // shows behind instead of a white block.
    const key = detectKey(data, info.width, info.height);
    if (key.name === "white" || key.name === "magenta") { keyed = keyBackground(data, info.width, info.height, key); snapAlpha(data, false); }
    else { snapAlpha(data, true); keyed = "opaque"; }
  } else if (spec.key === false) { snapAlpha(data, true); keyed = "opaque"; } // the sky band stays opaque
  else { keyed = keyBackground(data, info.width, info.height, detectKey(data, info.width, info.height)); snapAlpha(data, false); }
  await encode(data, info.width, info.height, spec).toFile(outPath(file));
  return { keyed };
}

async function processImage(file) {
  const base = path.basename(file).replace(/\.[^.]+$/, "");
  const spec = specFor(base);
  if (!spec) return { base, skipped: "unrecognized name — see header for the naming convention" };
  const extra = spec.mode === "sheet" ? await processSheet(file, spec) : await processFlat(file, spec);
  return { base, kind: spec.kind, size: `${spec.w}x${spec.h}`, ...extra };
}

// ---- driver --------------------------------------------------------------
async function main() {
  if (!existsSync(RAW_DIR)) { await mkdir(RAW_DIR, { recursive: true }); console.log(`Created ${path.relative(process.cwd(), RAW_DIR)}/ — drop images there and re-run.`); return; }
  let files = (await readdir(RAW_DIR)).filter((f) => /\.(png|jpe?g|webp|avif|gif|tiff?)$/i.test(f)).map((f) => path.join(RAW_DIR, f));
  if (OPT.only) files = files.filter((f) => path.basename(f).replace(/\.[^.]+$/, "") === OPT.only);
  if (files.length === 0) { console.log(`No images in raw/${OPT.only ? ` matching "${OPT.only}"` : ""}.`); return; }

  console.log(`Importing ${files.length} image(s)${OPT.quantize ? `  (quantize ${OPT.colors || "default"})` : "  (full color)"}\n`);
  const touched = new Set();
  for (const f of files) {
    let r; try { r = await processImage(f); } catch (e) { r = { base: path.basename(f), skipped: `error: ${e.message}` }; }
    if (r.skipped) { console.log(`  ⤫  ${r.base.padEnd(28)} ${r.skipped}`); continue; }
    const detail = r.detected != null ? `frames ${r.detected}/${r.frames}${r.detected !== r.frames ? " (even-split fallback!)" : ""}` : `keyed:${r.keyed}`;
    console.log(`  ✓  ${r.base.padEnd(28)} ${String(r.kind).padEnd(22)} ${r.size.padEnd(9)} ${detail}`);
    const b = BIOMES.find((x) => r.base.startsWith(x + "_")); if (b) touched.add(b);
  }
  console.log(`\nWrote to ${path.relative(process.cwd(), ASSET_DIR)}/`);
  if (touched.size) console.log(`Biomes updated: ${[...touched].join(", ")}`);
  console.log(`Now run  pqAdventure.reloadAssets()  in the app console.`);
}
main();
