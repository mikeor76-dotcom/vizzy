// Vizzy visualizer registry — the single source of truth for what modes
// exist, how they're organized, and what they support. The UI (debug panel),
// the controller, keyboard input, and future hardware knobs all read this;
// nothing hardcodes mode lists anywhere else.
//
// `render(ctx, analyser, w, h, now)` and `fade` are attached by main.js at
// startup (the renderer instances live there); everything else is static
// metadata, so this module stays import-safe for the controller.
//
// `auto` is the mode's AutoGain profile (src/autogain.js): model "linear"
// (sensitivity scales the raw signal) or "agc" (the mode has its own internal
// peak-tracking gain; sensitivity is a trim), target drive on peaks, optional
// clamp. `auto: null` = self-governing/fixed — AutoGain leaves it alone.
//
// Two content categories: METERS (analytical readouts that show you the
// signal) and SCENES (immersive artistic visuals). `favorites` is the special
// starred-modes view.

export const CATEGORIES = [
  { id: "meters", name: "Meters" },
  { id: "scenes", name: "Scenes" },
  { id: "favorites", name: "Favorites" },
];

export const REGISTRY = [
  // ------------------------------------------------------------- meters
  {
    id: "bars",
    name: "Bars",
    category: "meters",
    stable: true,
    presets: ["Default"],
    idle: false, // draws only while the mic is live (raw analyser view)
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "colorbars",
    name: "Color Bars",
    category: "meters",
    stable: true,
    presets: ["Default"],
    idle: false,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "spectrum",
    name: "Spectrum",
    category: "meters",
    stable: true,
    presets: ["Default"],
    idle: false,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "wave",
    name: "Wave",
    category: "meters",
    stable: true,
    presets: ["Default"],
    idle: false,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "radial",
    name: "Radial",
    category: "meters",
    stable: true,
    presets: ["Default"],
    idle: false,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "blue-power-meters",
    name: "Blue Meters",
    category: "meters",
    stable: true,
    presets: ["Classic Blue", "Dark Glass", "Minimal", "Night Mode"],
    idle: true,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "oscilloscope",
    name: "Oscilloscope",
    category: "meters",
    stable: true,
    presets: ["Green Phosphor", "Amber Trace", "Blue Trace", "White Studio"],
    idle: true, // flat trace with a faint hum
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "waterfall",
    name: "Waterfall",
    category: "meters",
    stable: true,
    presets: ["Studio Blue", "Amber Heat", "Monochrome", "Deep Space"],
    idle: true,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "studio-monitor",
    name: "Studio Monitor",
    category: "meters",
    stable: true,
    presets: ["Mastering", "Minimal", "Blue Studio", "Amber Studio"],
    idle: true,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  // ------------------------------------------------------------- scenes
  {
    id: "classical",
    name: "Classical",
    category: "scenes",
    stable: true,
    presets: ["Default"],
    idle: true, // sways gently before any audio plays
    auto: null,
  },
  {
    id: "synthwave",
    name: "Synthwave",
    category: "scenes",
    stable: true,
    presets: ["Default"],
    idle: true,
    auto: null,
  },
  {
    id: "milkdrop",
    name: "MilkDrop",
    category: "scenes",
    stable: false, // butterchurn/WebGL2 — needs a perf pass on the Pi
    presets: ["Auto Cycle", "Hard Cuts", "Hold"],
    idle: true, // presets keep flowing before audio arrives
    auto: null,
  },
  {
    id: "galaxy",
    name: "Galaxy",
    category: "scenes",
    stable: false, // still evolving
    presets: ["Default"],
    idle: true,
    auto: { model: "agc", target: 0.62 },
  },
  {
    id: "aurora",
    name: "Aurora",
    category: "scenes",
    stable: true,
    presets: ["Aurora Green", "Solar Violet", "Ice Blue", "Ember"],
    idle: true, // curtains breathe gently before any audio
    auto: { model: "agc", target: 0.62 },
  },
  {
    id: "ferrofluid",
    name: "Ferrofluid",
    category: "scenes",
    stable: true,
    presets: ["Chrome Cyan", "Magma", "Violet", "Mercury"],
    idle: true, // the mass breathes softly before any audio
    auto: { model: "agc", target: 0.62 },
  },
  {
    id: "pixelquest",
    name: "Pixel Quest",
    category: "scenes",
    stable: false,
    presets: ["Default"],
    idle: true,
    auto: { model: "agc", target: 0.62, clamp: [1.0, 1.6] },
  },
];

export const byId = (id) => REGISTRY.find((m) => m.id === id);
