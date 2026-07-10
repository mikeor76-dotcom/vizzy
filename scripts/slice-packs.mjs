#!/usr/bin/env bun
/**
 * One-off: slice the pixelquest cameo/easter-egg PACK SHEETS (labeled grids on a
 * flat magenta/green key) into individual sprite PNGs in raw/, and print the
 * SHEET_SPECS + ASSET_MANIFEST snippets to paste in.
 *
 * Segmentation: project content onto rows -> keep the TALL bands (sprites) and
 * drop the short ones (the text labels); within each sprite band, project onto
 * columns and split on the big gaps between sprites (small internal gaps are
 * merged so a sprite keeps its sparkles/detached bits).
 */
import sharp from "sharp";
import path from "node:path";
import { writeFileSync } from "node:fs";

const DROP = "/Users/mikeorourke/Desktop/pixelquest_drop";
const RAW = "/Users/mikeorourke/Documents/RPG/vizzy/public/assets/pixelquest/raw";
const OUT_SNIPPET = "/private/tmp/claude-501/-Users-mikeorourke-Documents-RPG/8fbb3052-aaac-4700-872c-4483fc946cfc/scratchpad";

// refH = authored height at the 320 reference (artScale scales it in-engine).
// rows = how many sprites are in each row band (top -> bottom), used to split
// each band at its widest valleys (robust against sprite-internal gaps).
const PACKS = [
  { file: "pixelquest_pack_moon.png", key: "magenta", refH: 72, colors: 40, rows: [3],
    names: ["discoMoon", "recordMoon", "winkMoon"] },
  { file: "pixelquest_pack_props.png", key: "magenta", refH: 92, colors: 48, rows: [3, 3, 3],
    names: ["windmill", "campfire", "brazier", "snail", "jukebox", "phoneBooth", "swordInStone", "secretDoor", "statue"] },
  { file: "pixelquest_pack_neon.png", key: "green", refH: 104, colors: 48, rows: [5],
    names: ["arcadeCabinet", "blueTimeBooth", "ghostTrap", "neonDinerSign", "magicMicrophone"] },
  { file: "pixelquest_pack_sky.png", key: "magenta", refH: 74, colors: 40, rows: [4, 3],
    names: ["skyDragon", "pirateShip", "witchBroom", "wingedShadow", "bicycleRider", "spyRope", "meteorCassette"] },
  { file: "pixelquest_pack_ground.png", key: "magenta", refH: 60, colors: 40, rows: [3, 3, 1],
    names: ["sharkFin", "submarinePeriscope", "sportsCar", "boulder", "blackCat", "redBalloon", "cassetteTumbleweed"] },
  { file: "pixelquest_pack_cast.png", key: "magenta", refH: 78, colors: 40, rows: [6, 5],
    names: ["giantCreature", "dinosaur", "robotDuo", "glamGuitarist", "keyboardPlayer", "tinyDrummer", "craneKick", "maskedShadow", "detectiveRain", "steamTrain", "ballroomWindow"] },
  { file: "pixelquest_pack_hero_kit.png", key: "magenta", refH: 40, colors: 32, rows: [4, 4],
    names: ["fedora", "sunglasses", "cape", "redShoes", "boombox", "powerGlove", "whip", "hoverboard"] },
  // single-sprite drops (not grids): one subject per file. rows:[1] keeps them
  // in the same pipeline so a re-slice regenerates them too.
  { file: "pixelquest_extra_dragonfly.png", key: "green", refH: 40, colors: 24, rows: [1],
    names: ["neonDragonfly"] },
  { file: "pixelquest_extra_marcher.png", key: "magenta", refH: 44, colors: 32, rows: [1],
    names: ["boomboxMarcher"] },
];

// optional CLI filter: `bun slice-packs.mjs sky cast` runs only packs whose
// filename contains one of the given substrings (default: all packs).
const FILTER = process.argv.slice(2);
const SELECTED = FILTER.length ? PACKS.filter((p) => FILTER.some((f) => p.file.includes(f))) : PACKS;

const isBg = (r, g, b, key) =>
  key === "magenta"
    ? r > 150 && b > 120 && g < Math.min(r, b) - 40 // magenta fill
    : g > 150 && r < g - 50 && b < g - 50;          // green fill

function runs(count, thresh) {
  const out = []; let s = -1;
  for (let i = 0; i < count.length; i++) {
    const on = count[i] > thresh;
    if (on && s < 0) s = i;
    else if (!on && s >= 0) { out.push([s, i - 1]); s = -1; }
  }
  if (s >= 0) out.push([s, count.length - 1]);
  return out;
}
// split the band's content extent [x0,x1] into n segments at the n-1 WIDEST
// low-content valleys — the gaps between sprites are the widest, so this ignores
// narrow sprite-internal gaps (sparkles, detached bits stay with their sprite).
function splitBand(colCount, x0, x1, n) {
  if (n <= 1) return [[x0, x1]];
  const gaps = []; let g = -1;
  for (let x = x0; x <= x1; x++) {
    const low = colCount[x] <= 2;
    if (low && g < 0) g = x;
    else if (!low && g >= 0) { gaps.push({ w: x - g, c: (g + x - 1) / 2 }); g = -1; }
  }
  const cuts = gaps.sort((a, b) => b.w - a.w).slice(0, n - 1).map((gp) => Math.round(gp.c)).sort((a, b) => a - b);
  const segs = []; let start = x0;
  for (const cut of cuts) { segs.push([start, cut]); start = cut + 1; }
  segs.push([start, x1]);
  return segs;
}

const specLines = [], manifestLines = [];

for (const pack of SELECTED) {
  const src = path.join(DROP, pack.file);
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const content = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!isBg(data[i], data[i + 1], data[i + 2], pack.key)) content[y * W + x] = 1;
  }
  const rowCount = new Int32Array(H);
  for (let y = 0; y < H; y++) { let c = 0; for (let x = 0; x < W; x++) if (content[y * W + x]) c++; rowCount[y] = c; }
  const bands = runs(rowCount, Math.max(4, W * 0.004)).filter(([a, b]) => b - a + 1 > 55); // drop short label bands
  if (bands.length !== pack.rows.length) {
    console.log(`\n⚠️  ${pack.file}: found ${bands.length} row-bands but expected ${pack.rows.length}`);
    bands.forEach(([a, b], i) => console.log(`     band ${i}: y ${a}..${b} (h ${b - a + 1})`));
    continue;
  }

  const found = [];
  for (let k = 0; k < bands.length; k++) {
    const [by0, by1] = bands[k];
    const colCount = new Int32Array(W);
    for (let x = 0; x < W; x++) { let c = 0; for (let y = by0; y <= by1; y++) if (content[y * W + x]) c++; colCount[x] = c; }
    let cx0 = 0, cx1 = W - 1;
    while (cx0 < W && colCount[cx0] <= 2) cx0++;
    while (cx1 > cx0 && colCount[cx1] <= 2) cx1--;
    for (const [sx0, sx1] of splitBand(colCount, cx0, cx1, pack.rows[k])) {
      let bx0 = sx1, bx1 = sx0, ty0 = by1, ty1 = by0;
      for (let y = by0; y <= by1; y++) for (let x = sx0; x <= sx1; x++) if (content[y * W + x]) {
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
      }
      if (bx1 >= bx0 && ty1 >= ty0) found.push([bx0, ty0, bx1, ty1]);
    }
  }

  if (found.length !== pack.names.length) {
    console.log(`\n⚠️  ${pack.file}: found ${found.length} sprites but expected ${pack.names.length} (${pack.names.join(", ")})`);
    found.forEach((b, i) => console.log(`     [${i}] ${b[2] - b[0] + 1}x${b[3] - b[1] + 1} @ (${b[0]},${b[1]})`));
    continue;
  }
  console.log(`\n✓ ${pack.file}  (${found.length} sprites, key=${pack.key})`);
  for (let i = 0; i < found.length; i++) {
    const [x0, y0, x1, y1] = found[i], pad = 2;
    const ex = Math.max(0, x0 - pad), ey = Math.max(0, y0 - pad);
    const cw = Math.min(W - ex, x1 - x0 + 1 + pad * 2), ch = Math.min(H - ey, y1 - y0 + 1 + pad * 2);
    const name = pack.names[i];
    await sharp(src).extract({ left: ex, top: ey, width: cw, height: ch }).toFile(path.join(RAW, `${name}.png`));
    const aspect = cw / ch;
    const specH = pack.refH, specW = Math.max(8, Math.round(specH * aspect));
    console.log(`   ${name.padEnd(20)} ${cw}x${ch}  -> spec ${specW}x${specH}`);
    specLines.push(`  ${name}: { mode: "sheet", w: ${specW}, h: ${specH}, frames: 1, anchor: "bottom", colors: ${pack.colors} },`);
    manifestLines.push(`  ${name}: { src: "${name}.png", frameW: ${specW}, frameH: ${specH}, anims: { idle: { frames: [0] } }, anchor: "bottom-center", scale: 1, piSafe: true, fallback: "procedural" },`);
  }
}

writeFileSync(path.join(OUT_SNIPPET, "specs-snippet.txt"), specLines.join("\n") + "\n");
writeFileSync(path.join(OUT_SNIPPET, "manifest-snippet.txt"), manifestLines.join("\n") + "\n");
console.log(`\nWrote ${specLines.length} sprites. Snippets in scratchpad/{specs,manifest}-snippet.txt`);
