#!/usr/bin/env bun
// One-off, repeatable: circularize the egg-shaped moon baked into the
// moonlit-town sky backdrop. Finds the bright moon blob in the upper sky,
// computes its centroid + per-angle boundary radius, then radially remaps the
// blob onto a PERFECT circle (interior texture preserved). Sky pixels the moon
// vacates are inpainted from the sky just right of the moon.
//
//   bun scripts/fix-moon.mjs [file]
//
// NOTE the import pipeline fill-resizes the 4:1 raw to the 3:1 backdrop spec,
// which vertically stretches everything ~33% — so a round moon in the raw
// comes out oval. After any re-import, run this on the PROCESSED file too:
//   bun scripts/import-art.mjs --only moonlit-town_backdrop
//   bun scripts/fix-moon.mjs public/assets/pixelquest/moonlit-town_backdrop.png
import sharp from "sharp";

const FILE = process.argv[2] || "public/assets/pixelquest/raw/moonlit-town_backdrop.png";
const { data, info } = await sharp(FILE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = (x, y) => (y * W + x) * 4;

// ---- 1) mask: bright blue-ish pixels in the upper-left sky quarter ---------
const rx0 = Math.floor(W * 0.18), rx1 = Math.floor(W * 0.45);
const ry0 = 0, ry1 = Math.floor(H * 0.4);
const mask = new Uint8Array(W * H);
for (let y = ry0; y < ry1; y++)
  for (let x = rx0; x < rx1; x++) {
    const i = px(x, y), r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = (r + g + b) / 3;
    if (lum > 105 && b >= r - 8) mask[y * W + x] = 1;
  }
// keep only the LARGEST connected component (stars are tiny separate blobs)
const label = new Int32Array(W * H).fill(-1);
let bestId = -1, bestN = 0, nextId = 0;
const stack = [];
for (let y = ry0; y < ry1; y++)
  for (let x = rx0; x < rx1; x++) {
    const p = y * W + x;
    if (!mask[p] || label[p] >= 0) continue;
    let n = 0;
    stack.push(p); label[p] = nextId;
    while (stack.length) {
      const q = stack.pop(); n++;
      const qx = q % W, qy = (q / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx;
        if (mask[np] && label[np] < 0) { label[np] = nextId; stack.push(np); }
      }
    }
    if (n > bestN) { bestN = n; bestId = nextId; }
    nextId++;
  }
for (let p = 0; p < W * H; p++) mask[p] = label[p] === bestId ? 1 : 0;
if (bestN < 100) { console.error("no moon blob found — aborting, file untouched"); process.exit(1); }

// ---- 2) centroid + per-angle boundary radius --------------------------------
let cx = 0, cy = 0, cn = 0;
for (let p = 0; p < W * H; p++) if (mask[p]) { cx += p % W; cy += (p / W) | 0; cn++; }
cx /= cn; cy /= cn;
const BINS = 96;
const binR = new Float32Array(BINS);
for (let p = 0; p < W * H; p++) {
  if (!mask[p]) continue;
  const dx = (p % W) - cx, dy = ((p / W) | 0) - cy;
  const d = Math.hypot(dx, dy);
  const b = ((Math.atan2(dy, dx) / (Math.PI * 2)) * BINS + BINS * 2.5) % BINS | 0;
  if (d > binR[b]) binR[b] = d;
}
for (let b = 0; b < BINS; b++) // fill any empty bins from neighbors
  if (!binR[b]) binR[b] = binR[(b + 1) % BINS] || binR[(b - 1 + BINS) % BINS] || 1;
const R = Math.round(binR.reduce((s, v) => s + v, 0) / BINS); // target radius = mean
console.log(`moon: ${info.width}x${info.height} file · blob ${bestN}px · centroid (${cx.toFixed(0)},${cy.toFixed(0)}) · radii ${Math.min(...binR).toFixed(0)}-${Math.max(...binR).toFixed(0)} → circle R=${R}`);

// ---- 3) rebuild: inpaint old blob, then paint the circularized moon --------
const out = Buffer.from(data);
const skyShift = Math.round(R * 2.6); // sample sky from right of the moon
for (let p = 0; p < W * H; p++) {
  if (!mask[p]) continue;
  const x = p % W, y = (p / W) | 0;
  const sx = Math.min(W - 1, x + skyShift);
  const si = px(sx, y), di = px(x, y);
  out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255;
}
// disc AND its glow halo: inside R the ray is scaled onto the old boundary;
// beyond R the halo is shifted along the ray so it hugs the new circle with no
// seam (srcRho is continuous — binR[b] exactly at rho = R).
const GLOW = Math.round(R * 0.95);
for (let dy = -(R + GLOW); dy <= R + GLOW; dy++)
  for (let dx = -(R + GLOW); dx <= R + GLOW; dx++) {
    const rho = Math.hypot(dx, dy);
    if (rho > R + GLOW) continue;
    const tx = Math.round(cx + dx), ty = Math.round(cy + dy);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    const b = ((Math.atan2(dy, dx) / (Math.PI * 2)) * BINS + BINS * 2.5) % BINS | 0;
    const srcRho = rho <= R ? (rho / R) * binR[b] : binR[b] + (rho - R);
    const sxF = cx + (rho > 0 ? (dx / rho) * srcRho : 0);
    const syF = cy + (rho > 0 ? (dy / rho) * srcRho : 0);
    const sx = Math.max(0, Math.min(W - 1, Math.round(sxF)));
    const sy = Math.max(0, Math.min(H - 1, Math.round(syF)));
    const si = px(sx, sy), di = px(tx, ty);
    out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255;
  }

await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(FILE);
console.log(`wrote ${FILE}`);
