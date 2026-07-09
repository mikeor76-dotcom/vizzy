// Cinematic Galaxy — a Cosmic Atlas Journey.
//
// The mode moves in a rhythm, not at one speed:
//
//   DRIFT    slow cinematic exploration of a beautiful region (20-45s)
//   BUILD    a destination glow emerges, energy gathers, next region preloads
//   JUMP     fast travel — long streaks, rushing dust, bloom flash hides the
//            crossfade into the next scene plate (2-6s)
//   ARRIVAL  deceleration into the new region, particles settle
//
// Music shapes the journey: energy shortens drifts and hastens jumps, strong
// beats in BUILD can launch the jump early, bass drives thrust and glow,
// treble sparkles, beats pulse the signal horizon.
//
// Backgrounds come from a local scene LIBRARY (public/assets/galaxy/):
//   nasa/<scene>/base.jpg + metadata.json      real astronomy plates
//   generated/<scene>/...                      curated cinematic plates
//   blackhole/<scene>/...                      rare black-hole encounters
// Scenes are Ken-Burns crop windows — never tiled, never seamed — chosen by
// metadata (mood, fogLevel, brightness, jumpSuitability), alternating foggy
// nebula regions with crisp open space. Missing metadata infers defaults and
// logs a warning. Nothing is generated during playback.

const TAU = Math.PI * 2;

export const GALAXY_DEFAULTS = {
  galaxyQuality: "auto",
  travelSpeed: 1,
  starDensity: 1,
  planetDetail: 1,
  debrisAmount: 1,
  beatReactivity: 1,
  bassThrust: 1,
  trebleSparkle: 1,
  heroMomentFrequency: 1,
  signalHorizonIntensity: 1,
  cinematicVignette: 1,
  subtleGrain: 1,
  assetBase: "/assets/galaxy/",
  backgroundDim: 0.42,
  sensitivity: 1.25, // master music-response gain (post auto-gain)
  debugLabel: true, // dev: show current scene / asset / journey state
  proceduralDebris: false, // rock silhouettes off by default (dust only)
  lowRes: "auto",
};

const AMBER = "255, 190, 96";
const GOLDWHITE = "255, 214, 160";
const BLUE = "140, 205, 255";
const WHITE = "240, 248, 255";
const LAVA = "255, 120, 40";

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const easeInOut = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- audio utils

class Smoother {
  constructor(attack, decay) {
    this.attack = attack;
    this.decay = decay;
    this.value = 0;
  }
  update(target) {
    const k = target > this.value ? this.attack : this.decay;
    this.value += (target - this.value) * k;
    return this.value;
  }
}

class BeatDetector {
  constructor(sensitivity, floor = 0.12) {
    this.history = new Float32Array(45);
    this.idx = 0;
    this.filled = 0;
    this.cooldown = 0;
    this.floor = floor;
    this.ratio = 1.45 - 0.25 * sensitivity;
  }
  update(value, dt) {
    this.cooldown -= dt;
    let sum = 0;
    for (let i = 0; i < this.filled; i++) sum += this.history[i];
    const avg = this.filled ? sum / this.filled : 0;
    this.history[this.idx] = value;
    this.idx = (this.idx + 1) % this.history.length;
    if (this.filled < this.history.length) this.filled++;
    if (this.cooldown <= 0 && this.filled > 10 && value > this.floor && value > avg * this.ratio) {
      this.cooldown = 0.16;
      return true;
    }
    return false;
  }
}

// ------------------------------------------------------- procedural textures

function makePRNG(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function fbm(w, h, rnd, octaves) {
  const out = new Float32Array(w * h);
  let total = 0;
  for (const [, weight] of octaves) total += weight;
  for (const [cells, weight] of octaves) {
    const gw = cells;
    const gh = Math.max(2, Math.round((cells * h) / w) + 1);
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    for (let y = 0; y < h; y++) {
      const gy = (y / h) * (gh - 1);
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      for (let x = 0; x < w; x++) {
        const gx = (x / w) * gw;
        const x0 = Math.floor(gx) % gw;
        const x1 = (x0 + 1) % gw;
        const fx = gx - Math.floor(gx);
        const a = grid[y0 * gw + x0];
        const b = grid[y0 * gw + x1];
        const c = grid[(y0 + 1) * gw + x0];
        const d = grid[(y0 + 1) * gw + x1];
        out[y * w + x] += (a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy) * (weight / total);
      }
    }
  }
  return out;
}

function makeWorldTexture(type, seed, detail, targetPx = 448) {
  const w = Math.max(192, Math.min(768, Math.round(targetPx * detail)));
  const h = w / 2;
  const rnd = makePRNG(seed);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const n = fbm(w, h, rnd, [[6, 0.42], [14, 0.28], [30, 0.19], [64, 0.11]]);
  const f = fbm(w, h, rnd, [[44, 0.55], [96, 0.45]]);
  const put = (i, r, g, b) => {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = n[y * w + x];
      const i = (y * w + x) * 4;
      if (type === "gas") {
        const fv = f[y * w + x];
        const band = 0.5 + 0.5 * Math.sin((y / h) * TAU * 3.2 + v * 5 + (fv - 0.5) * 2.4);
        const wisp = 0.85 + fv * 0.3;
        put(i, (110 + band * 140) * wisp, (70 + band * 125) * wisp, (38 + band * 78) * wisp);
      } else {
        const g = 55 + v * 95;
        put(i, g, g * 0.97, g * 0.92);
      }
      const xl = n[y * w + ((x - 1 + w) % w)];
      const xr = n[y * w + ((x + 1) % w)];
      const yu = n[Math.max(0, y - 1) * w + x];
      const yd = n[Math.min(h - 1, y + 1) * w + x];
      const shade = 1 + (xl - xr + (yu - yd)) * (type === "gas" ? 0.9 : 1.3);
      d[i] = Math.min(255, d[i] * shade);
      d[i + 1] = Math.min(255, d[i + 1] * shade);
      d[i + 2] = Math.min(255, d[i + 2] * shade);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function makeHazePlate(seed) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const rnd = makePRNG(seed);
  for (let k = 0; k < 3; k++) {
    const x = 70 + rnd() * 116;
    const y = 70 + rnd() * 116;
    const r = 40 + rnd() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const warm = rnd() < 0.4;
    g.addColorStop(0, warm ? "rgba(255, 205, 140, 0.35)" : "rgba(130, 175, 255, 0.35)");
    g.addColorStop(0.5, warm ? "rgba(200, 140, 80, 0.12)" : "rgba(90, 120, 220, 0.12)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  return c;
}

function makeRockSprite(seed) {
  const rnd = makePRNG(seed);
  const size = 96;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const verts = 13;
  const pts = [];
  for (let i = 0; i < verts; i++) {
    const a = (i / verts) * TAU;
    const rr = (24 + rnd() * 16) * (0.8 + rnd() * 0.4);
    pts.push([48 + Math.cos(a) * rr, 48 + Math.sin(a) * rr]);
  }
  const path = () => {
    ctx.beginPath();
    ctx.moveTo((pts[0][0] + pts[verts - 1][0]) / 2, (pts[0][1] + pts[verts - 1][1]) / 2);
    for (let i = 0; i < verts; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % verts];
      ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    ctx.closePath();
  };
  path();
  const g = ctx.createLinearGradient(8, 4, 84, 92);
  g.addColorStop(0, "rgb(74, 70, 66)");
  g.addColorStop(0.45, "rgb(32, 30, 32)");
  g.addColorStop(1, "rgb(8, 9, 13)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  path();
  ctx.clip();
  for (let k = 0; k < 8; k++) {
    ctx.fillStyle = `rgba(6, 7, 10, ${0.3 + rnd() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(16 + rnd() * 64, 16 + rnd() * 64, 4 + rnd() * 9, 3 + rnd() * 7, rnd() * TAU, 0, TAU);
    ctx.fill();
  }
  for (let k = 0; k < 6; k++) {
    ctx.fillStyle = `rgba(125, 116, 102, ${0.1 + rnd() * 0.15})`;
    ctx.fillRect(16 + rnd() * 60, 16 + rnd() * 60, 2 + rnd() * 4, 1.5 + rnd() * 3);
  }
  ctx.restore();
  path();
  const rim = ctx.createLinearGradient(0, 0, size, size);
  rim.addColorStop(0, `rgba(${GOLDWHITE}, 0.5)`);
  rim.addColorStop(0.4, "rgba(0, 0, 0, 0)");
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  return c;
}

function makeDustPuff(seed) {
  const rnd = makePRNG(seed);
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  for (let k = 0; k < 7; k++) {
    const x = 14 + rnd() * 36;
    const y = 14 + rnd() * 36;
    const r = 6 + rnd() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const warm = rnd() < 0.3;
    g.addColorStop(0, warm ? "rgba(210, 180, 140, 0.16)" : "rgba(150, 175, 215, 0.15)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  for (let k = 0; k < 8; k++) {
    ctx.fillStyle = `rgba(220, 230, 245, ${0.15 + rnd() * 0.3})`;
    ctx.fillRect(10 + rnd() * 44, 10 + rnd() * 44, 1, 1);
  }
  return c;
}

// ---------------------------------------------------------------- camera

class CameraRig {
  constructor(amount = 1) {
    this.amount = amount;
    this.x = 0;
    this.y = 0;
    this.tx = 0;
    this.ty = 0;
    this.bx = 0;
    this.by = 0;
    this.zoom = 1;
    this.zoomT = 1;
    this.bank = 0;
    this.bankT = 0;
    this.timer = 5;
    this.shake = 0;
    this.push = 0;
  }
  update(dt, w, h, biasX, biasY) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 5 + Math.random() * 5;
      this.tx = (Math.random() * 2 - 1) * w * 0.06 * this.amount;
      this.ty = (Math.random() * 2 - 1) * h * 0.07 * this.amount;
      this.bankT = (Math.random() * 2 - 1) * 0.04 * this.amount;
    }
    const k = Math.min(1, dt * 0.3);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.bx += (biasX - this.bx) * Math.min(1, dt * 0.5);
    this.by += (biasY - this.by) * Math.min(1, dt * 0.5);
    this.zoom += (this.zoomT - this.zoom) * Math.min(1, dt * 0.6);
    this.bank += (this.bankT - this.bank) * k;
    this.shake *= Math.exp(-dt * 5);
    this.push *= Math.exp(-dt * 2.5);
  }
  get ox() {
    return this.x + this.bx + (Math.random() * 2 - 1) * this.shake;
  }
  get oy() {
    return this.y + this.by + (Math.random() * 2 - 1) * this.shake;
  }
  get scale() {
    return this.zoom * (1 + this.push * 0.055);
  }
}

// -------------------------------------------------------------- scene library

const META_DEFAULTS = {
  title: "",
  sourceType: "manual",
  credit: "",
  sourceUrl: "",
  mood: "open_space",
  fogLevel: 0.2,
  brightness: 0.5,
  defaultDriftSeconds: 30,
  jumpSuitability: 0.8,
  panDirection: "diagonal",
  zoomMin: 1.0,
  zoomMax: 1.12,
  bassGlow: 1.0,
  trebleSparkle: 1.0,
  beatFlare: 1.0,
};

function inferMeta(name) {
  const n = name.toLowerCase();
  const meta = { ...META_DEFAULTS, title: name };
  if (n.includes("nebula")) Object.assign(meta, { mood: "nebula", fogLevel: 0.65, bassGlow: 1.3 });
  else if (n.includes("hole") || n.includes("bh")) Object.assign(meta, { mood: "black_hole", fogLevel: 0.25 });
  else if (n.includes("planet")) Object.assign(meta, { mood: "planet_flyby", fogLevel: 0.1 });
  else if (n.includes("cluster")) Object.assign(meta, { mood: "star_cluster", fogLevel: 0.12 });
  else if (n.includes("dust") || n.includes("lane")) Object.assign(meta, { mood: "dust_lane", fogLevel: 0.4 });
  else Object.assign(meta, { mood: "open_space", fogLevel: 0.05 });
  return meta;
}

// asset-aware behavior: every mood renders differently. Dense star plates get
// almost no live star overlay and gentle zoom; nebulae allow stronger motion;
// planets only appear where a flyby belongs.
const MOOD_RULES = {
  open_space: { stars: 1, zoomCap: 1.12, dimExtra: 0 },
  star_cluster: { stars: 0.18, zoomCap: 1.05, dimExtra: 0.08 },
  dust_lane: { stars: 0.5, zoomCap: 1.08, dimExtra: 0.03 },
  nebula: { stars: 0.6, zoomCap: 1.12, dimExtra: 0 },
  planet_flyby: { stars: 0.8, zoomCap: 1.1, dimExtra: 0 },
  black_hole: { stars: 0.6, zoomCap: 1.08, dimExtra: 0.04 },
};

function ruleFor(meta) {
  return MOOD_RULES[meta.mood] || MOOD_RULES.open_space;
}

// per-category motion: how a scene moves, how far the flyby pushes in, and
// how much overlay activity it tolerates before feeling cluttered
const MOTION_PROFILES = {
  open_space: { zoomTarget: 1.14, overlay: 1.2, pan: 1 },
  nebula_corridor: { zoomTarget: 1.2, overlay: 0.8, pan: 1.5 },
  nebula_close: { zoomTarget: 1.28, overlay: 0.7, pan: 0.9 },
  deep_field: { zoomTarget: 1.15, overlay: 0.35, pan: 0.7 },
  star_cluster: { zoomTarget: 1.08, overlay: 0.4, pan: 0.7 },
  planet_flyby: { zoomTarget: 1.45, overlay: 0.7, pan: 1 },
  galaxy_panorama: { zoomTarget: 1.22, overlay: 0.8, pan: 1.2 },
  jump_transition: { zoomTarget: 1.1, overlay: 1.4, pan: 2 },
};

function categoryOf(meta) {
  if (meta.category && MOTION_PROFILES[meta.category]) return meta.category;
  return { open_space: "open_space", nebula: "nebula_corridor", star_cluster: "star_cluster", planet_flyby: "planet_flyby", dust_lane: "galaxy_panorama", black_hole: "nebula_close" }[meta.mood] || "open_space";
}

function profileOf(meta) {
  return MOTION_PROFILES[meta.motionProfile] || MOTION_PROFILES[categoryOf(meta)];
}

// point-of-interest estimation for plates without focusX/Y metadata:
// weighted centroid of the brightest regions — never mechanically centered
function estimateFocus(img) {
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 24;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0, 48, 24);
  const d = x.getImageData(0, 0, 48, 24).data;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.5 + d[i + 1] * 0.35 + d[i + 2] * 0.15;
    const wgt = Math.pow(lum / 255, 3);
    sx += ((i / 4) % 48) * wgt;
    sy += (((i / 4) / 48) | 0) * wgt;
    sw += wgt;
  }
  if (sw < 1) return { x: 0.5, y: 0.45 };
  return { x: clamp01(sx / sw / 48), y: clamp01(sy / sw / 24) };
}

const PAN_VECTORS = {
  left: [-1, 0],
  right: [1, 0],
  diagonal: [0.8, -0.55],
  push: [0, 0],
};

// one active Ken-Burns view: a crop window inside a plate, slowly panning and
// zooming. Never tiles, never wraps, never shows an edge.
class SceneView {
  constructor(entry, w, h) {
    this.entry = entry; // { img, meta } or null for pure deep space
    this.meta = entry
      ? entry.meta
      : { ...META_DEFAULTS, title: "Deep Space", sourceType: "procedural", mood: "open_space", fogLevel: 0.03, brightness: 0.35 };
    this.life = 0;
    this.ax = 0.22 + Math.random() * 0.56;
    this.ay = 0.22 + Math.random() * 0.56;
    const pv = PAN_VECTORS[this.meta.panDirection] || PAN_VECTORS.diagonal;
    const flip = Math.random() < 0.5 ? 1 : -1;
    const panMul = profileOf(this.meta).pan;
    this.panX = pv[0] * 0.0045 * flip * panMul;
    this.panY = pv[1] * 0.0045 * panMul;
    this.glideDir = Math.random() < 0.5 ? 1 : -1;
    const rule = ruleFor(this.meta);
    this.zoomA = this.meta.zoomMin ?? 1;
    // never zoom a plate past its mood's cap (dense starfields become noise)
    this.zoomB = Math.min(
      (this.meta.zoomMax ?? 1.12) + (this.meta.panDirection === "push" ? 0.06 : 0),
      this.meta.maxCropZoom ?? 99,
      rule.zoomCap
    );
    // optional safeCropRegion {x,y,w,h} in 0..1 keeps the window inside it
    const scr = this.meta.safeCropRegion;
    if (scr) {
      this.ax = scr.x + 0.1 * scr.w + Math.random() * scr.w * 0.8;
      this.ay = scr.y + 0.1 * scr.h + Math.random() * scr.h * 0.8;
    }
    // one continuous push-in per scene: it starts wide and travels to this
    // depth; when the push completes, the journey jumps to the next image
    this.push = 0;
    this.pushDur = Math.min(60, Math.max(24, this.meta.preferredDuration || this.meta.defaultDriftSeconds || 30));
    this.zoomEnd = Math.min(
      this.meta.maxCropZoom ?? 1.6,
      1.6,
      Math.max(this.zoomB, this.meta.zoomTarget ?? profileOf(this.meta).zoomTarget)
    );
    // effective (eased) camera state — the journey drives these
    this.zoomEff = this.zoomA;
    this.axEff = this.ax;
    this.ayEff = this.ay;
  }
  update(dt) {
    this.life += dt;
    this.ax = Math.max(0.05, Math.min(0.95, this.ax + this.panX * dt));
    this.ay = Math.max(0.05, Math.min(0.95, this.ay + this.panY * dt));
  }
  // the scene's camera is one slow dive into the image: wide on arrival,
  // centering the focus point as it deepens. Bass adds momentum; `active`
  // is false while this scene is still incoming (hold wide until current).
  updateJourney(dt, state, P, bass, w, h, active = true) {
    if (active) this.push = clamp01(this.push + (dt * (0.55 + bass * 0.5)) / this.pushDur);
    const pz = easeInOut(this.push);
    let zoomT = lerp(this.zoomA, this.zoomEnd, pz);
    const f = this.focusAnchor(w, h);
    // the deeper we go, the more the subject takes the center
    let axT = lerp(this.ax, f.ax, pz);
    let ayT = lerp(this.ay, f.ay, pz);
    if (state === "flyby" && this.entry) axT = clamp01(axT + (P - 0.5) * 0.26 * this.glideDir);
    const k = Math.min(1, dt * (0.35 + bass * 0.45));
    this.zoomEff += (zoomT - this.zoomEff) * k;
    this.axEff += (axT - this.axEff) * k;
    this.ayEff += (ayT - this.ayEff) * k;
  }
  // where the crop anchor must sit so the focus point is centered in view
  focusAnchor(w, h) {
    if (!this.entry) return { ax: this.ax, ay: this.ay };
    const img = this.entry.img;
    const fx = this.meta.focusX ?? (this.meta._focus ? this.meta._focus.x : 0.5);
    const fy = this.meta.focusY ?? (this.meta._focus ? this.meta._focus.y : 0.45);
    let cropH = img.height / this.zoomEff;
    let cropW = cropH * (w / h);
    if (cropW > img.width * 0.96) {
      cropW = img.width * 0.96;
      cropH = cropW * (h / w);
    }
    return {
      ax: clamp01((fx * img.width - cropW / 2) / Math.max(1, img.width - cropW)),
      ay: clamp01((fy * img.height - cropH / 2) / Math.max(1, img.height - cropH)),
    };
  }
  draw(ctx, w, h, alpha, camX, camY) {
    if (!this.entry || alpha <= 0.01) return;
    const img = this.entry.img;
    const zoom = this.zoomEff * (this.musicZoom || 1);
    let cropH = img.height / zoom;
    let cropW = cropH * (w / h);
    if (cropW > img.width * 0.96) {
      cropW = img.width * 0.96;
      cropH = cropW * (h / w);
    }
    const sx = this.axEff * (img.width - cropW);
    const sy = this.ayEff * (img.height - cropH);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, sx, sy, cropW, cropH, -w * 0.03 - camX * 0.05, -h * 0.03 - camY * 0.05, w * 1.06, h * 1.06);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------ journey director

// the travel rhythm: slow exploration -> energy build -> fast jump -> arrival
class JourneyDirector {
  constructor() {
    this.state = "arrival";
    this.t = 0;
    this.dur = 2;
    // the scene's push-in is the real clock: flyby holds until the zoom lands
    this.readyToJump = false;
  }
  P() {
    return clamp01(this.t / this.dur);
  }
  update(dt, energy) {
    // high energy shortens the calm states; the jump itself runs on its clock
    const rate =
      this.state === "drift" ? 0.75 + energy * 0.95 : this.state === "build" || this.state === "approach" ? 0.9 + energy * 0.5 : 1;
    this.t += dt * rate;
    if (this.t < this.dur) return null;
    this.t = 0;
    switch (this.state) {
      case "drift":
        this.state = "build";
        this.dur = 4 + Math.random() * 4;
        return "build";
      case "build":
        this.state = "approach";
        this.dur = 6 + Math.random() * 5;
        return "approach";
      case "approach":
        this.state = "flyby";
        this.dur = 6 + Math.random() * 5;
        return "flyby";
      case "flyby":
        if (!this.readyToJump) {
          this.t = this.dur; // hold at the end of the flyby until the zoom lands
          return null;
        }
        this.state = "jump";
        this.dur = 2 + Math.random() * 3;
        return "jump";
      case "jump":
        this.state = "arrival";
        this.dur = 4 + Math.random() * 4;
        return "arrival";
      default:
        this.state = "drift";
        this.dur = 30; // overwritten by the scene's drift duration
        return "drift";
    }
  }
  speedMul() {
    const P = easeInOut(this.P());
    switch (this.state) {
      case "drift":
        return 0.5;
      case "build":
        return 0.65 + P * 0.5;
      case "approach":
        return 1.1 + P * 0.5; // committed motion toward the subject
      case "flyby":
        return 0.85; // slow, gliding close pass
      case "jump":
        return 2.6 + Math.sin(this.P() * Math.PI) * 0.6;
      default:
        return lerp(2.0, 0.5, P); // arrival deceleration
    }
  }
  fgMul() {
    return { drift: 0.6, build: 1.0, approach: 1.5, flyby: 0.9, jump: 2.4, arrival: 1.2 }[this.state];
  }
}

// ---------------------------------------------------------------- the mode

export class Galaxy {
  constructor(opts = {}) {
    this.cfg = { ...GALAXY_DEFAULTS, ...opts };
    this.freq = new Uint8Array(1024);
    this.time = new Uint8Array(2048);
    this.bass = new Smoother(0.55, 0.08);
    this.mid = new Smoother(0.4, 0.06);
    this.treble = new Smoother(0.5, 0.1);
    this.loud = new Smoother(0.35, 0.05);
    this.beatBass = new BeatDetector(this.cfg.beatReactivity);
    this.beatMid = new BeatDetector(this.cfg.beatReactivity * 0.9, 0.1);
    this.camera = new CameraRig();
    this.journey = new JourneyDirector();
    this.flash = 0;
    this.surge = 0;
    this.jumpFlash = 0;
    this.glowTarget = { x: 0.7, y: 0.35 };
    this.lastNow = 0;
    this.frameAvg = 16.7;
    this.autoQuality = 1;
    this.w = 0;
    this.h = 0;
    this.momentTimer = 10;
    this.m = { debris: 1 };
    this.moment = null;
    this.momentT = 0;
    this.momentDur = 0;
    this.sceneCur = null;
    this.sceneNext = null;
    this.lastSceneName = "";
    this.recentAssets = []; // per-asset cooldown (last 4)
    this.recentCats = []; // per-category cooldown (no 3 alike in a row)
    this.hero = null; // large world shown in planet_flyby regions
    this.sceneMul = { bass: 1, treble: 1, flare: 1 };
    // asset library: NASA + curated plates, planets, river texture
    this.assets = { planets: [], moons: [] };
    this.library = [];
    this.loadAssets();
    // pools
    this.pulses = Array.from({ length: 12 }, () => ({ active: false }));
    this.comets = Array.from({ length: 8 }, () => ({ active: false }));
    this.glints = Array.from({ length: 6 }, () => ({ active: false }));
    this.fgRocks = Array.from({ length: 10 }, () => ({ active: false }));
    this.fgTimer = 2;
  }

  quality() {
    return this.cfg.galaxyQuality === "auto" ? this.autoQuality : this.cfg.galaxyQuality;
  }

  loadAssets() {
    const base = this.cfg.assetBase;
    const tryLoad = async (path, ok) => {
      try {
        const res = await fetch(base + path, { method: "HEAD" });
        if (!res.ok) return;
        const img = new Image();
        img.onload = () => ok(img);
        img.src = base + path;
      } catch {
        /* offline: procedural fallbacks carry the scene */
      }
    };
    for (const n of ["planet_a.jpg", "planet_b.jpg", "planet_c.jpg"]) tryLoad(n, (i) => this.assets.planets.push(i));
    tryLoad("moon_a.jpg", (i) => this.assets.moons.push(i));
    this.loadLibrary(base, tryLoad);
  }

  // manifest.json is the primary index: explicit paths + inline metadata.
  // Loading is LOUD — every asset logs success or failure, and missing
  // curated plates are reported instead of silently falling back.
  async loadLibrary(base, tryLoad) {
    let manifest = null;
    try {
      const res = await fetch(base + "manifest.json");
      if (res.ok) manifest = await res.json();
    } catch {
      /* fall through to legacy library */
    }
    if (manifest && Array.isArray(manifest.galaxy)) {
      let pending = manifest.galaxy.length;
      const done = () => {
        if (--pending === 0) this.logAssetSummary();
      };
      for (const entry of manifest.galaxy) {
        const meta = { ...META_DEFAULTS, ...entry };
        if (meta.enabled === false) {
          console.log(`[galaxy-assets] skipped (disabled): ${entry.path}`);
          done();
          continue;
        }
        const img = new Image();
        img.onload = () => {
          if (meta.focusX == null) meta._focus = estimateFocus(img);
          this.library.push({ img, meta, cat: meta.sourceType, name: entry.path.split("/").pop() });
          console.log(
            `[galaxy-assets] loaded: ${entry.path} (${categoryOf(meta)}, p${meta.priority ?? 5}${meta.hero ? ", hero" : ""})`
          );
          done();
        };
        img.onerror = () => {
          console.warn(`[galaxy-assets] MISSING: ${entry.path} — check manifest paths`);
          done();
        };
        img.src = entry.path;
      }
      return;
    }
    console.warn("[galaxy-assets] no manifest.json found — trying legacy library.json");
    let lib = null;
    try {
      const res = await fetch(base + "library.json");
      if (res.ok) lib = await res.json();
    } catch {
      /* none */
    }
    if (!lib) {
      this.assetsChecked = true;
      console.error("Galaxy assets not loaded — check manifest paths.");
      return;
    }
    for (const cat of ["nasa", "generated", "blackhole"]) {
      for (const name of lib[cat] || []) {
        let meta = null;
        try {
          const m = await fetch(`${base}${cat}/${name}/metadata.json`);
          if (m.ok) meta = { ...META_DEFAULTS, ...(await m.json()) };
        } catch {
          /* fall through */
        }
        if (!meta) {
          console.warn(`[galaxy-assets] ${cat}/${name}: missing metadata.json, inferring defaults`);
          meta = inferMeta(name);
        }
        tryLoad(`${cat}/${name}/base.jpg`, (img) => {
          this.library.push({ img, meta, cat, name });
          console.log(`[galaxy-assets] loaded (legacy): ${cat}/${name}/base.jpg`);
        });
      }
    }
    this.assetsChecked = true;
  }

  logAssetSummary() {
    this.assetsChecked = true;
    const curated = this.library.filter((s) => s.meta.sourceType !== "nasa").length;
    console.log(`[galaxy-assets] total loaded: ${this.library.length} (curated: ${curated}, nasa: ${this.library.length - curated})`);
    if (!this.library.length) {
      console.error("Galaxy assets not loaded — check manifest paths.");
    } else if (!curated) {
      console.warn(
        "[galaxy-assets] no CURATED plates loaded — drop files per public/assets/galaxy/generated/README_DROP_FILES_HERE.txt"
      );
    }
  }

  // ---------------------------------------------------------------- rebuild

  rebuild(ctx, w, h) {
    const cfg = this.cfg;
    this.w = w;
    this.h = h;
    const dim = Math.min(w, h);
    this.dim = dim;
    this.lowRes = cfg.lowRes === "auto" ? dim < 240 : !!cfg.lowRes;
    const detail = this.lowRes ? 0.35 : 1;
    this.lineScale = this.lowRes ? 2.2 : 1;
    this.axis = Math.atan2(-h * 0.95, w * 1.1);
    this.flowX = -Math.cos(this.axis);
    this.flowY = -Math.sin(this.axis);
    this.lightPos = { x: -w * 0.25, y: -h * 0.35 };

    const wideMul = Math.min(2, Math.max(1, (w / h) * 0.45));
    const mkTier = (count, speed, size, alpha) => {
      const arr = [];
      for (let i = 0; i < count; i++) {
        arr.push({
          x: Math.random() * (w + 80) - 40,
          y: Math.random() * (h + 80) - 40,
          speed: speed * (0.7 + Math.random() * 0.6),
          size: size * (0.7 + Math.random() * 0.7) * (this.lowRes ? 2.2 : 1),
          alpha,
          tw: Math.random() * TAU,
          twSp: 0.4 + Math.random() * 1.8,
          warm: Math.random() < 0.22,
          flash: 0,
          ja: (Math.random() - 0.5) * 0.5,
        });
      }
      return arr;
    };
    const density = cfg.starDensity * detail * wideMul;
    this.farTier = mkTier(Math.round(110 * density), 5, 0.8, 0.5);
    this.midTier = mkTier(Math.round(60 * density), 30, 1.2, 0.65);
    this.nearTier = mkTier(Math.round(18 * density), 110, 1.5, 0.8);
    this.dust = mkTier(Math.round(46 * density), 170, 0.9, 0.4);

    this.hazePlates = [makeHazePlate((Math.random() * 1e9) | 0), makeHazePlate((Math.random() * 1e9) | 0)];
    this.hazeSpots = [
      { x: w * 0.2, y: h * 0.32, s: dim * 1.15, a: 0.14, p: 0 },
      { x: w * 0.55, y: h * 0.1, s: dim * 0.7, a: 0.1, p: 1 },
    ];

    const unit = (stops) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      for (const [p, c] of stops) g.addColorStop(p, c);
      return g;
    };
    this.gradBloom = unit([[0, `rgba(${WHITE}, 0.65)`], [0.4, `rgba(${BLUE}, 0.25)`], [1, `rgba(${BLUE}, 0)`]]);
    this.gradGlow = unit([[0, `rgba(${GOLDWHITE}, 0.8)`], [0.4, `rgba(${AMBER}, 0.3)`], [1, `rgba(${AMBER}, 0)`]]);
    this.gradGlint = unit([[0, `rgba(${WHITE}, 1)`], [0.3, `rgba(${GOLDWHITE}, 0.8)`], [1, `rgba(${AMBER}, 0)`]]);
    this.vignette = unit([[0.62, "rgba(2, 4, 12, 0)"], [1, "rgba(2, 4, 12, 0.24)"]]);
    this.vigSX = w * 0.68;
    this.vigSY = h * 0.88;
    this.bgGrad = ctx.createLinearGradient(0, 0, w, h);
    this.bgGrad.addColorStop(0, "rgba(2, 3, 8, 0.32)");
    this.bgGrad.addColorStop(0.55, "rgba(5, 9, 22, 0.3)");
    this.bgGrad.addColorStop(1, "rgba(8, 12, 30, 0.3)");

    this.rockSprites = [0, 1, 2, 3].map(() => makeRockSprite((Math.random() * 1e9) | 0));
    this.dustPuffs = [makeDustPuff((Math.random() * 1e9) | 0), makeDustPuff((Math.random() * 1e9) | 0)];

    const tile = document.createElement("canvas");
    tile.width = tile.height = 160;
    const tc = tile.getContext("2d");
    const img = tc.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 100 + Math.random() * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 16;
    }
    tc.putImageData(img, 0, 0);
    this.grain = ctx.createPattern(tile, "repeat");

    this.sceneCur = new SceneView(this.pickPlate(), w, h);
    this.onArrival();
    this.journey.state = "drift";
    this.journey.t = 0;
    this.journey.dur = (this.sceneCur.meta.defaultDriftSeconds || 30) * 0.6;
  }

  // ------------------------------------------------------------ scene picking

  pickPlate() {
    if (!this.library.length) return null;
    // per-asset cooldown: nothing repeats within the last 4 scenes (window
    // shrinks with a small library so a 2-plate lineup still alternates)
    const recent = this.recentAssets.slice(-Math.min(4, this.library.length - 1));
    let pool = this.library.filter((s) => !recent.includes(s.name));
    // per-category cooldown: never a third similar scene in a row
    if (this.recentCats.length >= 2) {
      const [a, b] = this.recentCats.slice(-2);
      if (a === b) {
        const varied = pool.filter((s) => categoryOf(s.meta) !== b);
        if (varied.length) pool = varied;
      }
    }
    // alternate: after a foggy region, go somewhere clear
    const curFog = this.sceneCur ? this.sceneCur.meta.fogLevel : 0;
    if (curFog > 0.45) {
      const clear = pool.filter((s) => s.meta.fogLevel < 0.45);
      if (clear.length) pool = clear;
    }
    // black-hole regions are rare encounters
    pool = pool.filter((s) => s.meta.mood !== "black_hole" || Math.random() < 0.15);
    if (!pool.length) pool = this.library;
    // hero plates carry the show
    const heroes = pool.filter((s) => s.meta.hero);
    if (heroes.length && Math.random() < 0.75) pool = heroes;
    // weight by curation priority x jump suitability
    const wgt = (s) => (s.meta.priority ?? 5) * (s.meta.jumpSuitability ?? 0.8);
    let total = 0;
    for (const s of pool) total += wgt(s);
    let r = Math.random() * total;
    for (const s of pool) {
      r -= wgt(s);
      if (r <= 0) return s;
    }
    return pool[pool.length - 1];
  }

  pickScene() {
    // pure deep-space rest scenes still mix in as breathers
    const entry = Math.random() < 0.14 ? null : this.pickPlate();
    if (entry) {
      this.recentAssets.push(entry.name);
      if (this.recentAssets.length > 4) this.recentAssets.shift();
    }
    this.recentCats.push(entry ? categoryOf(entry.meta) : "open_space");
    if (this.recentCats.length > 3) this.recentCats.shift();
    return new SceneView(entry, this.w, this.h);
  }

  onBuildStart() {
    this.sceneNext = this.pickScene(); // prepared in memory before the jump
    const side = Math.random() < 0.5 ? 0.24 : 0.76;
    this.glowTarget = { x: side + (Math.random() - 0.5) * 0.1, y: 0.25 + Math.random() * 0.35 };
  }

  onJumpStart() {
    // a jump must always have somewhere to go — without this the arrival
    // keeps the old scene (push already 1) and re-jumps to itself forever
    if (!this.sceneNext) this.sceneNext = this.pickScene();
    this.jumpFlash = 1;
    this.surge = Math.min(2, this.surge + 1.3);
    this.camera.shake = 2;
  }

  onArrival() {
    if (this.sceneNext) {
      this.sceneCur = this.sceneNext;
      this.sceneNext = null;
    }
    const meta = this.sceneCur.meta;
    console.log(
      `[galaxy] scene -> ${meta.title || "Deep Space"} (${categoryOf(meta)} / ${meta.sourceType} / p${meta.priority ?? 5}${meta.hero ? " / hero" : ""})`
    );
    // procedural worlds are OPT-IN per scene: metadata must explicitly ask.
    // Plates that contain their own planet never get one stacked on top.
    if (meta.spawnPlanet === true && !meta.hasPlanet) {
      const photo = this.assets.planets.length
        ? this.assets.planets[(Math.random() * this.assets.planets.length) | 0]
        : null;
      this.hero = {
        tex: photo || makeWorldTexture("gas", (Math.random() * 1e9) | 0, Math.max(0.3, this.cfg.planetDetail), 500),
        xN: Math.random() < 0.5 ? 0.24 : 0.76,
        yN: 0.32 + Math.random() * 0.2,
        r: Math.min(this.h * (0.34 + Math.random() * 0.14), this.w * 0.26),
        // physical rings only when the scene's metadata asks for them
        ring: meta.physicalRings === true,
        ringTilt: (Math.random() - 0.5) * 0.9,
        rot: Math.random(),
        rotSpeed: 0.008 + Math.random() * 0.008,
        driftPhase: Math.random() * TAU,
        fade: 0,
      };
    } else {
      this.hero = null;
    }
  }

  // ---------------------------------------------------------------- audio

  analyze(analyser, dt) {
    if (analyser) {
      analyser.getByteFrequencyData(this.freq);
      analyser.getByteTimeDomainData(this.time);
    } else {
      this.freq.fill(0);
      this.time.fill(128);
    }
    const band = (lo, hi) => {
      let s = 0;
      for (let i = lo; i < hi; i++) s += this.freq[i];
      return s / ((hi - lo) * 255);
    };
    // adaptive gain: normalize against a slow-decaying loudness peak so a
    // quiet mic drives the same visual range as loud audio
    const rawLoud0 = band(1, 372);
    this.peak = Math.max((this.peak || 0.3) * (1 - dt * 0.04), rawLoud0, 0.06);
    const gain = Math.min(4, 0.55 / this.peak) * this.cfg.sensitivity;
    const rawBass = Math.min(1, band(1, 11) * gain);
    const rawMid = Math.min(1, band(11, 92) * gain);
    this.bass.update(rawBass);
    this.mid.update(rawMid);
    this.treble.update(Math.min(1, band(92, 372) * 1.6 * gain));
    this.loud.update(Math.min(1, rawLoud0 * gain));

    if (analyser && this.beatBass.update(rawBass, dt)) {
      this.flash = 1;
      this.camera.push = this.cfg.bassThrust;
      this.surge = Math.min(1.8, this.surge + (rawBass > 0.5 ? 1.05 : 0.55) * this.cfg.bassThrust);
      if (rawBass > 0.55) this.camera.shake = 3;
      this.emitPulse();
      if (rawBass > 0.5) {
        this.emitPulse();
        this.spawnFgRock();
      }
      this.spawnGlint();
      if (rawBass > 0.6) for (let i = 0; i < 3; i++) this.spawnComet();
      else if (Math.random() < 0.3) this.spawnComet();
      // flyby beats punch the camera in a touch and glint the frame
      if (this.journey.state === "flyby" && this.sceneCur) {
        this.sceneCur.zoomEff = Math.min(1.62, this.sceneCur.zoomEff + 0.008);
        this.spawnGlint();
      }
      // a strong beat near the end of the zoom launches the jump early
      if (this.journey.state === "flyby" && this.sceneCur && this.sceneCur.push > 0.8 && rawBass > 0.5) {
        this.sceneCur.push = 1;
        this.journey.t = this.journey.dur;
        this.surge = Math.min(2.2, this.surge + 0.6);
      }
    }
    if (analyser && this.beatMid.update(rawMid, dt) && Math.random() < 0.4) {
      this.spawnPulse(Math.random() * this.w, Math.random() * this.h * 0.7, 2);
    }
    if (this.treble.value > 0.55 && Math.random() < 0.02 * this.cfg.trebleSparkle) this.spawnComet();
    this.flash *= Math.exp(-dt * 6);
  }

  // ---------------------------------------------------------------- events

  emitPulse() {
    const r = Math.random();
    if (r < 0.3 && this.hero) {
      const a = Math.random() * TAU;
      this.spawnPulse(this.hero.sx + Math.cos(a) * this.hero.r, this.hero.sy + Math.sin(a) * this.hero.r, 2);
    } else if (r < 0.5) {
      const [x, y] = this.riverPos(Math.random(), (Math.random() - 0.5) * this.h * 0.3);
      this.spawnPulse(x, y, 2);
    } else if (r < 0.75) {
      this.spawnPulse(Math.random() * this.w * 1.2 - this.w * 0.1, Math.random() * this.h * 0.8, Math.random() < 0.25 ? 1 : 2);
    } else {
      this.spawnPulse(Math.random() * this.w, Math.random() * this.h * 0.8, 2);
    }
  }

  spawnPulse(x, y, kind) {
    for (const p of this.pulses) {
      if (!p.active) {
        p.active = true;
        p.x = x;
        p.y = y;
        p.r = this.dim * 0.02;
        p.maxR = this.dim * (0.18 + Math.random() * 0.3);
        p.kind = kind;
        p.warm = Math.random() < 0.55;
        p.seed = Math.random() * TAU;
        return;
      }
    }
  }

  spawnComet() {
    for (const m of this.comets) {
      if (!m.active) {
        m.active = true;
        m.warm = Math.random() < 0.5;
        const off = (Math.random() - 0.5) * 0.5;
        const speed = this.w * (0.45 + Math.random() * 0.4);
        m.vx = Math.cos(this.axis + Math.PI + off) * speed;
        m.vy = Math.sin(this.axis + Math.PI + off) * speed;
        m.x = m.vx > 0 ? -20 : this.w + 20;
        m.y = Math.random() * this.h * 0.6;
        m.maxLife = 0.7 + Math.random() * 0.6;
        m.life = m.maxLife;
        return;
      }
    }
  }

  spawnGlint() {
    for (const g of this.glints) {
      if (!g.active) {
        g.active = true;
        g.x = Math.random() * this.w;
        g.v = (Math.random() < 0.5 ? -1 : 1) * this.w * (0.25 + Math.random() * 0.3);
        g.life = 1;
        return;
      }
    }
  }

  spawnFgRock() {
    for (const r of this.fgRocks) {
      if (!r.active) {
        const speed = this.w * (0.38 + Math.random() * 0.35);
        r.active = true;
        // rock silhouettes are opt-in; the default near field is soft dust
        r.big = this.cfg.proceduralDebris && Math.random() < 0.12;
        r.dust = !this.cfg.proceduralDebris || (!r.big && Math.random() < 0.25);
        r.kind = Math.floor(Math.random() * 4);
        r.s = r.big ? 4.5 + Math.random() * 3.5 : 1.4 + Math.random() * 2.4;
        r.vx = Math.cos(this.axis + Math.PI) * speed;
        r.vy = Math.sin(this.axis + Math.PI) * speed;
        r.x = r.vx > 0 ? -60 : this.w + 60;
        r.y = Math.random() * this.h;
        r.rot = Math.random() * TAU;
        r.spin = (Math.random() - 0.5) * 1.5;
        return r;
      }
    }
    return null;
  }

  updateMoments(dt) {
    const MOMENTS = ["meteor-field", "flyby-swarm", "horizon-run", "debris-surge"];
    if (this.moment) {
      this.momentT += dt;
      if (this.momentT >= this.momentDur) this.moment = null;
    } else {
      this.momentTimer -= dt * (0.7 + this.loud.value * 0.7) * this.cfg.heroMomentFrequency;
      if (this.momentTimer <= 0) {
        this.moment = MOMENTS[Math.floor(Math.random() * MOMENTS.length)];
        this.momentT = 0;
        this.momentDur = 5 + Math.random() * 4;
        this.momentTimer = 10 + Math.random() * 12;
        if (this.moment === "meteor-field") for (let i = 0; i < 5; i++) this.spawnComet();
        if (this.moment === "flyby-swarm") for (let i = 0; i < 4; i++) this.spawnFgRock();
        if (this.moment === "debris-surge") {
          this.surge = Math.min(1.6, this.surge + 1);
          for (let i = 0; i < 3; i++) this.spawnFgRock();
        }
        if (this.moment === "horizon-run") for (let i = 0; i < 3; i++) this.spawnGlint();
      }
    }
    const env = this.moment ? Math.min(1, this.momentT * 2, (this.momentDur - this.momentT) * 1.2) : 0;
    const debrisT = 1 + (this.moment === "flyby-swarm" || this.moment === "debris-surge" || this.moment === "meteor-field" ? env * 1.5 : 0);
    this.m.debris = lerp(this.m.debris, debrisT, Math.min(1, dt * 1.5));
  }

  // ---------------------------------------------------------------- render

  render(ctx, analyser, w, h, now) {
    if (w !== this.w || h !== this.h) this.rebuild(ctx, w, h);
    const rawMs = this.lastNow ? now - this.lastNow : 16.7;
    const dt = Math.min(Math.max(rawMs, 0) / 1000, 0.05);
    this.lastNow = now;
    const t = now / 1000;

    if (rawMs > 0 && rawMs < 500 && this.cfg.galaxyQuality === "auto") {
      this.frameAvg += (rawMs - this.frameAvg) * 0.04;
      if (this.frameAvg > 26 && this.autoQuality > 0.35) this.autoQuality -= 0.02;
      else if (this.frameAvg < 19 && this.autoQuality < 1) this.autoQuality = Math.min(1, this.autoQuality + 0.004);
    }

    this.analyze(analyser, dt);
    this.updateMoments(dt);

    // the journey: drift -> build -> jump -> arrival. The scene's push-in is
    // the clock — when the zoom completes, we travel to the next image.
    this.journey.readyToJump = this.sceneCur.push >= 1;
    if (
      this.sceneCur.push >= 1 &&
      (this.journey.state === "drift" || this.journey.state === "build" || this.journey.state === "approach")
    ) {
      // zoom landed before the flyby phase: fast-forward so the jump fires —
      // making sure a destination was picked (normally build's job)
      if (!this.sceneNext) this.onBuildStart();
      this.journey.state = "flyby";
      this.journey.t = this.journey.dur;
    }
    const evt = this.journey.update(dt, this.loud.value);
    if (evt === "build") this.onBuildStart();
    else if (evt === "jump") this.onJumpStart();
    else if (evt === "arrival") this.onArrival();
    else if (evt === "drift")
      this.journey.dur =
        (this.sceneCur.meta.preferredDuration || this.sceneCur.meta.defaultDriftSeconds || 30) * (0.75 + Math.random() * 0.5);
    else if (evt === "approach" || evt === "flyby")
      console.log(`[galaxy] ${evt} -> ${this.sceneCur.meta.title || "Deep Space"} (${categoryOf(this.sceneCur.meta)})`);
    const J = this.journey;
    const fade = J.state === "jump" ? easeInOut(J.P()) : 0;

    this.sceneCur.update(dt);
    if (this.sceneNext) this.sceneNext.update(dt);
    // the journey drives the scene camera: approach pushes toward the focus
    // point, flyby glides across it, bass adds momentum
    this.sceneCur.updateJourney(dt, J.state, J.P(), this.bass.value * this.cfg.bassThrust, w, h, true);
    if (this.sceneNext) this.sceneNext.updateJourney(dt, "drift", 0, 0, w, h, false);

    // scene-reactive multipliers crossfade with the plates
    const mCur = this.sceneCur.meta;
    const mNext = this.sceneNext ? this.sceneNext.meta : mCur;
    this.sceneMul.bass = lerp(mCur.bassGlow, mNext.bassGlow, fade);
    this.sceneMul.treble = lerp(mCur.trebleSparkle, mNext.trebleSparkle, fade);
    this.sceneMul.flare = lerp(mCur.beatFlare, mNext.beatFlare, fade);
    // asset-aware star overlay: dense star plates get almost none of ours
    // (metadata starDensity overrides the mood default when present)
    const starCur = mCur.starDensity ?? ruleFor(mCur).stars;
    const starNext = mNext.starDensity ?? ruleFor(mNext).stars;
    this.sceneStarMul = lerp(starCur, starNext, fade);
    const dimExtra = lerp(ruleFor(mCur).dimExtra, ruleFor(mNext).dimExtra, fade);

    const effFog = lerp(mCur.fogLevel, mNext.fogLevel, fade);

    this.surge *= Math.exp(-dt * 1.5);
    this.jumpFlash *= Math.exp(-dt * 2.2);
    const energy = this.loud.value;
    const travel =
      this.cfg.travelSpeed *
      J.speedMul() *
      (0.34 + this.bass.value * 1.7 * this.cfg.bassThrust + energy * 0.7 + this.surge * 1.7 + this.camera.push * 0.5);
    const bright = Math.min(1.4, 0.4 + energy * 1.2 + this.flash * 0.28 + this.jumpFlash * 0.3);
    // the whole image breathes with the bass and punches on kicks
    const musicZoom = 1 + this.bass.value * 0.028 + this.flash * 0.014;
    this.sceneCur.musicZoom = musicZoom;
    if (this.sceneNext) this.sceneNext.musicZoom = musicZoom;

    // camera: build pushes toward the destination glow; jump zooms; arrival settles
    const stateZoom =
      J.state === "drift"
        ? 0.99
        : J.state === "build"
          ? 1 + easeInOut(J.P()) * 0.03
          : J.state === "approach"
            ? 1.02
            : J.state === "flyby"
              ? 1.03
              : J.state === "jump"
                ? 1.08
                : lerp(1.05, 0.99, easeInOut(J.P()));
    this.camera.zoomT = stateZoom + Math.sin(t * 0.07) * 0.008;
    let biasX = 0;
    let biasY = 0;
    if (J.state === "build" || J.state === "jump") {
      biasX = (this.glowTarget.x * w - w / 2) * 0.08 * (J.state === "build" ? J.P() : 1);
      biasY = (this.glowTarget.y * h - h / 2) * 0.08 * (J.state === "build" ? J.P() : 1);
    }
    this.camera.update(dt, w, h, biasX, biasY);

    // -------- background scenes (crossfade during the jump)
    const dimB = lerp(mCur.brightness, mNext.brightness, fade);
    this.sceneCur.draw(ctx, w, h, 1, this.camera.x, this.camera.y);
    if (this.sceneNext) this.sceneNext.draw(ctx, w, h, fade, this.camera.x, this.camera.y);
    // beats pulse brightness inside cloudy regions; clusters stay capped darker
    const dim = Math.max(0.12, (0.62 - dimB * 0.4) * this.cfg.backgroundDim * 2 + dimExtra - energy * 0.1 - this.flash * 0.1 * effFog);
    ctx.fillStyle = `rgba(3, 5, 12, ${dim})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = this.bgGrad;
    ctx.fillRect(0, 0, w, h);
    if (!this.sceneCur.entry && !this.sceneNext) {
      // pure deep-space rest scene: nothing but darkness, stars and dust
    }

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(this.camera.bank);
    ctx.scale(this.camera.scale, this.camera.scale);
    ctx.translate(-w / 2 + this.camera.ox, -h / 2 + this.camera.oy);

    const starMul = this.sceneStarMul ?? 1;
    this.drawTier(ctx, this.farTier, t, dt, travel * 0.18, bright * 0.75, false, starMul);
    this.drawHaze(ctx, bright);
    this.drawHero(ctx, t, dt, bright, fade);
    this.drawBuildGlow(ctx, bright);
    this.drawTier(ctx, this.midTier, t, dt, travel * 0.7, bright, false, starMul);
    // motion layers keep a floor — travel must stay readable everywhere
    this.drawTier(ctx, this.nearTier, t, dt, travel * 2.2, bright, true, Math.max(0.6, starMul));
    this.drawTier(ctx, this.dust, t, dt, travel * 3.4, bright * 0.7, true, Math.max(0.6, starMul));
    // strong plates breathe with fewer overlays; open space lets them work
    this.drawFgRocks(ctx, dt, bright, J.fgMul() * profileOf(this.sceneCur.meta).overlay);
    this.drawPulses(ctx, dt, bright);
    this.drawComets(ctx, dt);

    ctx.restore();

    // beat exposure pulse: a soft additive wash so kicks read at a glance
    if (this.flash > 0.03) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(${GOLDWHITE}, ${this.flash * 0.06 * this.cfg.beatReactivity})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    // jump bloom: brightness hides the plate transition
    if (this.jumpFlash > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(this.glowTarget.x * w, this.glowTarget.y * h);
      ctx.scale(this.dim * 1.3, this.dim * 1.3);
      ctx.globalAlpha = this.jumpFlash * 0.4;
      ctx.fillStyle = this.gradGlow;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    this.drawSignalHorizon(ctx, w, h, t, dt, bright);
    this.drawDebugLabel(ctx, w, h);
    if (this.cfg.cinematicVignette > 0) {
      ctx.save();
      ctx.globalAlpha = this.cfg.cinematicVignette;
      ctx.translate(w / 2, h / 2);
      ctx.scale(this.vigSX, this.vigSY);
      ctx.fillStyle = this.vignette;
      ctx.fillRect(-w / 2 / this.vigSX, -h / 2 / this.vigSY, w / this.vigSX, h / this.vigSY);
      ctx.restore();
    }
    this.drawGrain(ctx, w, h);
  }

  // ------------------------------------------------------------ layer draws

  drawTier(ctx, tier, t, dt, speed, bright, streaks, densityMul = 1) {
    const fx = this.flowX * speed;
    const fy = this.flowY * speed;
    ctx.lineCap = "round";
    const count = Math.floor(tier.length * Math.max(0.4, this.quality()) * densityMul);
    for (let i = 0; i < count; i++) {
      const s = tier[i];
      const cj = Math.cos(s.ja);
      const sj = Math.sin(s.ja);
      s.x += (fx * cj - fy * sj) * s.speed * dt;
      s.y += (fx * sj + fy * cj) * s.speed * dt;
      if (s.x < -50) s.x = this.w + 40;
      if (s.x > this.w + 50) s.x = -40;
      if (s.y < -50) s.y = this.h + 40;
      if (s.y > this.h + 50) s.y = -40;
      // star glints belong to sparse scenes; dense plates carry their own stars
      if (
        densityMul > 0.55 &&
        this.treble.value > 0.5 &&
        Math.random() < this.treble.value * 0.008 * this.cfg.trebleSparkle * this.sceneMul.treble
      )
        s.flash = 1;
      s.flash *= 0.9;
      const tw = 0.75 + 0.25 * Math.sin(s.tw + t * s.twSp);
      const a = Math.min(1, s.alpha * tw * bright + s.flash * 0.5);
      const color = s.warm ? GOLDWHITE : s.flash > 0.3 ? BLUE : WHITE;
      if (streaks) {
        const len = Math.min(70, speed * s.speed * 0.05) * (0.7 + (s.ja + 0.25) * 1.2);
        const tx = this.flowX * cj - this.flowY * sj;
        const ty = this.flowX * sj + this.flowY * cj;
        ctx.strokeStyle = `rgba(${color}, ${a * 0.3})`;
        ctx.lineWidth = s.size * 0.7;
        ctx.beginPath();
        ctx.moveTo(s.x - tx * len * 0.25, s.y - ty * len * 0.25);
        ctx.lineTo(s.x - tx * len, s.y - ty * len);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${color}, ${a * 0.9})`;
        ctx.lineWidth = s.size * (1 + s.flash);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - tx * len * 0.25, s.y - ty * len * 0.25);
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(${color}, ${a})`;
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
    }
  }

  drawHaze(ctx, bright) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const hz of this.hazeSpots) {
      const px = hz.x - this.camera.x * 0.15;
      const py = hz.y - this.camera.y * 0.15;
      ctx.globalAlpha = hz.a * bright;
      ctx.drawImage(this.hazePlates[hz.p], px - hz.s / 2, py - hz.s / 2, hz.s, hz.s);
    }
    ctx.restore();
  }

  riverPos(tt, perp) {
    const x0 = -this.w * 0.15;
    const y0 = this.h * 1.1;
    const x1 = this.w * 1.15;
    const y1 = -this.h * 0.15;
    const x = lerp(x0, x1, tt) + Math.cos(this.axis + Math.PI / 2) * perp;
    const y = lerp(y0, y1, tt) + Math.sin(this.axis + Math.PI / 2) * perp;
    return [x, y];
  }

  // the destination glow that emerges during BUILD — where we're headed
  drawBuildGlow(ctx, bright) {
    const J = this.journey;
    if (J.state !== "build") return;
    const P = easeInOut(J.P());
    const x = this.glowTarget.x * this.w;
    const y = this.glowTarget.y * this.h;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(x, y);
    const s = this.dim * (0.12 + P * 0.2) * (1 + this.bass.value * 0.3);
    ctx.scale(s, s);
    ctx.globalAlpha = P * (0.3 + this.bass.value * 0.35) * bright;
    ctx.fillStyle = this.gradGlint;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // the large world greeting you in planet_flyby regions
  drawHero(ctx, t, dt, bright, fade) {
    const hero = this.hero;
    if (!hero) return;
    hero.fade = Math.min(1, hero.fade + dt * 0.5);
    const alpha = hero.fade * (1 - fade); // jumps leave the world behind
    if (alpha <= 0.01) return;
    hero.rot = (hero.rot + dt * hero.rotSpeed * (1 + this.mid.value * 0.4)) % 1;
    const x = hero.xN * this.w + Math.sin(t * 0.05 + hero.driftPhase) * this.w * 0.012 + this.camera.x * 0.35;
    const y = hero.yN * this.h + Math.cos(t * 0.04 + hero.driftPhase) * this.h * 0.015 + this.camera.y * 0.35;
    const r = hero.r;
    const la = Math.atan2(this.lightPos.y - y, this.lightPos.x - x);
    hero.sx = x;
    hero.sy = y;
    const tex = hero.tex;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const atmoR = r * (1.28 + this.bass.value * 0.2 * this.cfg.bassThrust);
    const ag = ctx.createRadialGradient(x, y, r * 0.92, x, y, atmoR);
    ag.addColorStop(0, `rgba(${BLUE}, ${0.24 * bright * alpha})`);
    ag.addColorStop(1, `rgba(${BLUE}, 0)`);
    ctx.fillStyle = ag;
    ctx.beginPath();
    ctx.arc(x, y, atmoR, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (hero.ring) this.drawRing(ctx, hero, x, y, r, alpha, bright, true);

    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    const s = (2 * r) / tex.height;
    const u = hero.rot * tex.width;
    ctx.save();
    ctx.scale(s, s);
    ctx.drawImage(tex, -u - tex.width, -tex.height / 2);
    ctx.drawImage(tex, -u, -tex.height / 2);
    ctx.drawImage(tex, tex.width - u, -tex.height / 2);
    ctx.restore();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha * (0.1 + this.mid.value * 0.18);
    ctx.fillStyle = `rgba(${GOLDWHITE}, 0.35)`;
    ctx.beginPath();
    ctx.arc(Math.cos(la) * r * 0.45, Math.sin(la) * r * 0.45, r * 0.75, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = alpha;
    const sg = ctx.createRadialGradient(Math.cos(la) * r * 0.55, Math.sin(la) * r * 0.55, r * 0.15, 0, 0, r * 1.12);
    sg.addColorStop(0, "rgba(0, 0, 0, 0)");
    sg.addColorStop(0.6, "rgba(3, 5, 12, 0.2)");
    sg.addColorStop(1, "rgba(2, 3, 8, 0.94)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(la);
    ctx.globalAlpha = alpha;
    const rimA = (0.22 + this.treble.value * 0.2 * this.cfg.trebleSparkle + this.flash * 0.3 * this.cfg.beatReactivity) * bright;
    ctx.strokeStyle = `rgba(${WHITE}, ${rimA})`;
    ctx.lineWidth = Math.max(1.2, r * 0.014);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.995, -1.2, 1.2);
    ctx.stroke();
    ctx.restore();

    if (hero.ring) this.drawRing(ctx, hero, x, y, r, alpha, bright, false);
    ctx.globalAlpha = 1;
  }

  drawRing(ctx, d, x, y, r, fade, bright, farHalf) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(d.ringTilt);
    ctx.strokeStyle = `rgba(${GOLDWHITE}, ${(0.2 + this.mid.value * 0.15) * fade * bright})`;
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.55, r * 0.37, 0, farHalf ? Math.PI : 0, farHalf ? TAU : Math.PI);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${AMBER}, ${0.09 * fade * bright})`;
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.78, r * 0.43, 0, farHalf ? Math.PI : 0, farHalf ? TAU : Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  drawFgRocks(ctx, dt, bright, densityMul) {
    this.fgTimer -= dt * this.m.debris * this.cfg.debrisAmount * densityMul * (0.7 + this.surge + this.loud.value);
    if (this.fgTimer <= 0) {
      this.spawnFgRock();
      this.fgTimer = 1.9 + Math.random() * 3;
    }
    const speedMul = 0.8 + this.surge * 0.8 + this.bass.value * 0.5;
    for (const r of this.fgRocks) {
      if (!r.active) continue;
      r.x += r.vx * dt * (r.big ? 0.6 : 1) * speedMul;
      r.y += r.vy * dt * (r.big ? 0.6 : 1) * speedMul;
      r.rot += r.spin * dt;
      if (r.x < -this.w * 0.35 || r.x > this.w * 1.35 || r.y < -this.h * 0.45 || r.y > this.h * 1.45) {
        r.active = false;
        continue;
      }
      const s = r.s * (this.lowRes ? 1.6 : 1);
      ctx.save();
      ctx.translate(r.x, r.y);
      if (r.dust) {
        const img = this.dustPuffs[r.kind % this.dustPuffs.length];
        ctx.rotate(r.rot * 0.3);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(img, -32 * s, -32 * s, 64 * s, 64 * s);
      } else {
        const img = this.rockSprites[r.kind];
        const depthA = Math.min(0.95, 0.35 + r.s * 0.12);
        ctx.rotate(r.rot);
        ctx.globalAlpha = depthA * 0.2;
        ctx.drawImage(img, -24 * s - r.vx * 0.028, -24 * s - r.vy * 0.028, 48 * s, 48 * s);
        ctx.globalAlpha = depthA * 0.45;
        ctx.drawImage(img, -24 * s - r.vx * 0.013, -24 * s - r.vy * 0.013, 48 * s, 48 * s);
        ctx.globalAlpha = depthA;
        ctx.drawImage(img, -24 * s, -24 * s, 48 * s, 48 * s);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  drawPulses(ctx, dt, bright) {
    for (const p of this.pulses) {
      if (!p.active) continue;
      p.r += dt * this.dim * (p.kind === 2 ? 0.22 : 0.5 + this.bass.value * 0.5);
      const a = 1 - p.r / p.maxR;
      if (a <= 0) {
        p.active = false;
        continue;
      }
      const color = p.warm ? AMBER : BLUE;
      if (p.kind === 1) {
        ctx.strokeStyle = `rgba(${color}, ${a * 0.4 * bright * this.sceneMul.flare})`;
        ctx.lineWidth = this.lineScale;
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
          const ang = p.seed + (i / 7) * TAU;
          ctx.moveTo(p.x + Math.cos(ang) * p.r * 0.55, p.y + Math.sin(ang) * p.r * 0.55);
          ctx.lineTo(p.x + Math.cos(ang) * p.r, p.y + Math.sin(ang) * p.r);
        }
        ctx.stroke();
      } else {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(p.x, p.y);
        ctx.scale(p.r, p.r);
        ctx.globalAlpha = a * 0.5 * bright * this.sceneMul.flare;
        ctx.fillStyle = this.gradBloom;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  drawComets(ctx, dt) {
    for (const m of this.comets) {
      if (!m.active) continue;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.life -= dt;
      if (m.life <= 0) {
        m.active = false;
        continue;
      }
      const a = m.life / m.maxLife;
      ctx.strokeStyle = `rgba(${m.warm ? AMBER : BLUE}, ${a * 0.5})`;
      ctx.lineWidth = this.lineScale * 1.5;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 0.09, m.y - m.vy * 0.09);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${WHITE}, ${a * 0.9})`;
      ctx.lineWidth = this.lineScale;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 0.03, m.y - m.vy * 0.03);
      ctx.stroke();
    }
  }

  drawSignalHorizon(ctx, w, h, t, dt, bright) {
    const intensity = this.cfg.signalHorizonIntensity;
    if (intensity <= 0) return;
    const y0 = h * 0.9;
    const amp = h * 0.07 * (0.2 + this.loud.value * 1.4) * (1 + this.flash * 0.7) * intensity;
    const samples = this.lowRes ? 48 : 140;
    const step = this.time.length / samples;
    const idle = this.loud.value < 0.02;
    for (let pass = this.quality() < 0.55 ? 1 : 0; pass < 2; pass++) {
      ctx.strokeStyle =
        pass === 0
          ? `rgba(${AMBER}, ${(0.1 + this.bass.value * 0.14 + this.treble.value * 0.1) * bright})`
          : `rgba(${GOLDWHITE}, ${(0.5 + this.loud.value * 0.4) * bright})`;
      ctx.lineWidth = (pass === 0 ? 3 + this.bass.value * 5 : 1 + this.bass.value * 0.9) * this.lineScale;
      ctx.beginPath();
      for (let i = 0; i < samples; i++) {
        const x = (i / (samples - 1)) * w;
        const v = idle
          ? Math.sin(i * 0.3 + t * 1.4) * 0.1 + Math.sin(i * 0.11 - t * 0.9) * 0.06
          : (this.time[Math.floor(i * step)] - 128) / 128;
        const y = y0 + v * (idle ? h * 0.012 : amp);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (!idle) {
      ctx.strokeStyle = `rgba(${BLUE}, ${0.5 * bright})`;
      ctx.lineWidth = this.lineScale;
      ctx.beginPath();
      for (let i = 0; i < samples; i += 2) {
        const v = (this.time[Math.floor(i * step)] - 128) / 128;
        if (Math.abs(v) > 0.55) {
          const x = (i / (samples - 1)) * w;
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y0 + v * amp * 1.4);
        }
      }
      ctx.stroke();
      if (this.quality() > 0.5) {
        ctx.strokeStyle = `rgba(${GOLDWHITE}, ${0.35 * bright})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k < 9; k++) {
          const x = ((k + 0.5) / 9) * w;
          const v = this.freq[8 + k * 24] / 255;
          if (v > 0.25) {
            ctx.moveTo(x, y0 - 2);
            ctx.lineTo(x, y0 - 2 - v * h * 0.05 * intensity);
          }
        }
        ctx.stroke();
      }
      if (this.treble.value > 0.35) {
        ctx.fillStyle = `rgba(${WHITE}, ${this.treble.value * 0.7})`;
        for (let k = 0; k < 4; k++) {
          ctx.fillRect(Math.random() * w, y0 + (Math.random() - 0.5) * 6, 1.5, 1.5);
        }
      }
    }
    for (const g of this.glints) {
      if (!g.active) continue;
      g.x += g.v * dt;
      g.life -= dt * 0.8;
      if (g.life <= 0 || g.x < -20 || g.x > w + 20) {
        g.active = false;
        continue;
      }
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(g.x, y0);
      ctx.scale(14, 14);
      ctx.globalAlpha = g.life * 0.8;
      ctx.fillStyle = this.gradGlint;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  // dev diagnostics: current scene + journey state, and a loud on-screen
  // error when the asset library came up empty
  drawDebugLabel(ctx, w, h) {
    if (!this.cfg.debugLabel) return;
    ctx.save();
    ctx.font = "11px monospace";
    ctx.textBaseline = "bottom";
    const meta = this.sceneCur ? this.sceneCur.meta : null;
    const label = meta
      ? `Galaxy: ${meta.sourceType} / ${categoryOf(meta)} p${meta.priority ?? 5}${meta.hero ? " hero" : ""} / ${meta.title || "Deep Space"} / ${this.journey.state.toUpperCase()} / zoom ${Math.round(this.sceneCur.push * 100)}%`
      : "Galaxy: loading…";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.fillText(label, 8, h - 6);
    if (this.assetsChecked && !this.library.length) {
      ctx.font = "bold 13px monospace";
      ctx.fillStyle = "rgba(255, 120, 120, 0.95)";
      ctx.fillText("Galaxy assets not loaded — check manifest paths.", 8, 22);
    }
    ctx.restore();
  }

  drawGrain(ctx, w, h) {
    if (this.lowRes || this.cfg.subtleGrain <= 0 || this.quality() < 0.7) return;
    ctx.save();
    ctx.globalAlpha = 0.05 * this.cfg.subtleGrain;
    ctx.translate(-Math.random() * 160, -Math.random() * 160);
    ctx.fillStyle = this.grain;
    ctx.fillRect(0, 0, w + 160, h + 160);
    ctx.restore();
  }
}
