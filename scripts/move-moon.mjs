#!/usr/bin/env bun
// Move the baked moon inside a sky backdrop to a canonical position so that,
// during biome crossfades (two plates dissolving), the moons overlap
// concentrically instead of appearing side by side as a "double moon".
//
//   bun scripts/move-moon.mjs <file> <targetX1440> <targetY480>
//
// Target coords are given in the PROCESSED 1440x480 plate space and scaled to
// the file's actual size, so the same command works on raws too. Detection is
// the same bright-blob approach as fix-moon.mjs; the moon disc is copied
// verbatim, its glow halo is alpha-blended into the destination sky, and the
// vacated sky is inpainted from beside the old spot.
import sharp from "sharp";

const FILE = process.argv[2];
const TX = Math.round(parseFloat(process.argv[3]));
const TY = Math.round(parseFloat(process.argv[4]));
if (!FILE || !Number.isFinite(TX) || !Number.isFinite(TY)) {
  console.error("usage: bun scripts/move-moon.mjs <file> <targetX1440> <targetY480>");
  process.exit(1);
}
const { data, info } = await sharp(FILE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = (x, y) => (y * W + x) * 4;
const tx = Math.round((TX / 1440) * W);
const ty = Math.round((TY / 480) * H);

// ---- detect the moon blob (bright pixels in the upper sky, largest blob) ---
const rx0 = Math.floor(W * 0.08), rx1 = Math.floor(W * 0.9), ry1 = Math.floor(H * 0.42);
const mask = new Uint8Array(W * H);
for (let y = 0; y < ry1; y++)
  for (let x = rx0; x < rx1; x++) {
    const i = px(x, y);
    if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 105) mask[y * W + x] = 1;
  }
const label = new Int32Array(W * H).fill(-1);
let bestId = -1, bestN = 0, next = 0;
const stack = [];
for (let p = 0; p < W * ry1; p++) {
  if (!mask[p] || label[p] >= 0) continue;
  let n = 0;
  stack.push(p); label[p] = next;
  while (stack.length) {
    const q = stack.pop(); n++;
    const qx = q % W, qy = (q / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = qx + dx, ny = qy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const np = ny * W + nx;
      if (mask[np] && label[np] < 0) { label[np] = next; stack.push(np); }
    }
  }
  if (n > bestN) { bestN = n; bestId = next; }
  next++;
}
for (let p = 0; p < W * H; p++) mask[p] = label[p] === bestId ? 1 : 0;
if (bestN < 200) { console.error("no moon blob found — aborting, file untouched"); process.exit(1); }
let cx = 0, cy = 0;
for (let p = 0; p < W * H; p++) if (mask[p]) { cx += p % W; cy += (p / W) | 0; }
cx = Math.round(cx / bestN); cy = Math.round(cy / bestN);
let R = 0;
for (let p = 0; p < W * H; p++) {
  if (!mask[p]) continue;
  const d = Math.hypot((p % W) - cx, (((p / W) | 0)) - cy);
  if (d > R) R = d;
}
R = Math.ceil(R);
const GLOW = Math.round(R * 0.95);
console.log(`${FILE}: ${W}x${H} · moon at (${cx},${cy}) R=${R} → target (${tx},${ty})  Δ(${tx - cx},${ty - cy})`);
if (Math.abs(tx - cx) + Math.abs(ty - cy) < 3) { console.log("already at target — no change"); process.exit(0); }

const out = Buffer.from(data);
// ---- 1) inpaint the vacated moon + halo area from the sky beside it --------
const skyShift = (tx > cx ? -1 : 1) * Math.round((R + GLOW) * 1.3); // sample AWAY from the target
for (let dy = -(R + GLOW); dy <= R + GLOW; dy++)
  for (let dx = -(R + GLOW); dx <= R + GLOW; dx++) {
    if (Math.hypot(dx, dy) > R + GLOW) continue;
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const sx = Math.max(0, Math.min(W - 1, x + skyShift));
    const si = px(sx, y), di = px(x, y);
    out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255;
  }
// ---- 2) paste the moon at the target: disc verbatim, halo alpha-blended ----
for (let dy = -(R + GLOW); dy <= R + GLOW; dy++)
  for (let dx = -(R + GLOW); dx <= R + GLOW; dx++) {
    const rho = Math.hypot(dx, dy);
    if (rho > R + GLOW) continue;
    const sxp = cx + dx, syp = cy + dy;
    const txp = tx + dx, typ = ty + dy;
    if (sxp < 0 || syp < 0 || sxp >= W || syp >= H) continue;
    if (txp < 0 || typ < 0 || txp >= W || typ >= H) continue;
    const si = px(sxp, syp), di = px(txp, typ);
    // weight: solid over the disc, easing out across the halo so the glow
    // melts into whatever sky/clouds live at the destination
    const wgt = rho <= R ? 1 : Math.pow(1 - (rho - R) / GLOW, 1.6);
    out[di] = Math.round(data[si] * wgt + out[di] * (1 - wgt));
    out[di + 1] = Math.round(data[si + 1] * wgt + out[di + 1] * (1 - wgt));
    out[di + 2] = Math.round(data[si + 2] * wgt + out[di + 2] * (1 - wgt));
    out[di + 3] = 255;
  }

await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(FILE);
console.log(`wrote ${FILE}`);
