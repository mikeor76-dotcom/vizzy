#!/usr/bin/env bun
/**
 * One-off: prepare the Pixel Quest opening-sequence assets from the drop folder
 * into the project. Story plates are downscaled; FX strips get their magenta key
 * removed and their empty top/bottom trimmed (keeping full width so frames stay
 * sliceable by index). Also writes opening_story_sequence.json as a reference.
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DROP = "/Users/mikeorourke/Desktop/pixelquest_drop";
const ROOT = "/Users/mikeorourke/Documents/RPG/vizzy/public/assets/pixelquest";
const STORY_OUT = path.join(ROOT, "opening_story");
const FX_OUT = path.join(ROOT, "opening_fx");

const PLATES = [
  "01_silent_world.png", "02_first_note.png", "03_music_awakens.png",
  "04_orb_forms.png", "05_orb_chooses_him.png", "06_bring_music_back.png",
];
const FX = ["music_fragments_strip.png", "orb_forming_strip.png", "pulse_rings_strip.png", "golden_path_tile.png", "sparkles_strip.png"];

const isMagenta = (r, g, b) => r > 150 && b > 120 && g < Math.min(r, b) - 45;

await mkdir(STORY_OUT, { recursive: true });
await mkdir(FX_OUT, { recursive: true });

// --- story plates: downscale to 1280x720 (16:9), opaque -------------------
for (const f of PLATES) {
  const src = path.join(DROP, f);
  await sharp(src).resize(1280, 720, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(path.join(STORY_OUT, f));
  console.log(`plate  ${f}  -> 1280x720`);
}

// --- FX strips: key magenta, trim vertical margins, downscale --------------
for (const f of FX) {
  const src = path.join(DROP, f);
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  let y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (isMagenta(data[i], data[i + 1], data[i + 2])) { data[i + 3] = 0; }
    else if (data[i + 3] > 20) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const pad = 6;
  y0 = Math.max(0, y0 - pad); y1 = Math.min(H - 1, y1 + pad);
  const ch = Math.max(1, y1 - y0 + 1);
  // target width ~1000 (path band a bit wider so it spans the road)
  const targetW = f.includes("sparkles") ? 1200 : 1000;
  const scale = targetW / W;
  await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: 0, top: y0, width: W, height: ch })
    .resize(targetW, Math.max(1, Math.round(ch * scale)), { kernel: "nearest" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(FX_OUT, f));
  console.log(`fx     ${f}  keyed, trimmed ${W}x${H} -> ${targetW}x${Math.round(ch * scale)}`);
}

// --- sequence JSON (mirror of the in-code data model) ---------------------
const SEQUENCE = [
  { id: "silent_world", image: "01_silent_world.png", titleCard: "THE WORLD FELL SILENT", durationMs: 3000, overlay: "none" },
  { id: "first_note", image: "02_first_note.png", titleCard: "HE STILL HEARD IT", durationMs: 3000, overlay: "first_note" },
  { id: "music_awakens", image: "03_music_awakens.png", titleCard: "MUSIC AWAKENS", durationMs: 3500, overlay: "music_particles" },
  { id: "orb_forms", image: "04_orb_forms.png", titleCard: "THE LAST LIVING NOTE", durationMs: 4000, overlay: "orb_forming" },
  { id: "orb_chooses_him", image: "05_orb_chooses_him.png", titleCard: "THE ORB CHOSE HIM", durationMs: 3500, overlay: "orb_glow" },
  { id: "bring_music_back", image: "06_bring_music_back.png", titleCard: "BRING MUSIC BACK", durationMs: 4000, overlay: "golden_path" },
];
await writeFile(path.join(STORY_OUT, "opening_story_sequence.json"), JSON.stringify(SEQUENCE, null, 2) + "\n");
console.log("wrote opening_story_sequence.json");
console.log("done.");
