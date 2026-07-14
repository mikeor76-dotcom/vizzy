// Vizzy visualizer registry — the single source of truth for what modes
// exist, how they're organized, and what they support. The UI (debug panel),
// the controller, keyboard input, and future hardware knobs all read this;
// nothing hardcodes mode lists anywhere else.
//
// `render(ctx, analyser, w, h, now)` and `fade` are attached by main.js at
// startup (the renderer instances live there); everything else is static
// metadata, so this module stays import-safe for the controller.
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
    controls: { sensitivity: false },
  },
  {
    id: "colorbars",
    name: "Color Bars",
    category: "meters",
    stable: true,
    presets: ["Default"],
    idle: false,
    controls: { sensitivity: false },
  },
  {
    id: "spectrum",
    name: "Spectrum",
    category: "meters",
    stable: true,
    presets: ["Default"],
    idle: false,
    controls: { sensitivity: false },
  },
  {
    id: "wave",
    name: "Wave",
    category: "meters",
    stable: true,
    presets: ["Default"],
    idle: false,
    controls: { sensitivity: false },
  },
  {
    id: "radial",
    name: "Radial",
    category: "meters",
    stable: true,
    presets: ["Default"],
    idle: false,
    controls: { sensitivity: false },
  },
  {
    id: "blue-power-meters",
    name: "Blue Meters",
    category: "meters",
    stable: true,
    presets: ["Classic Blue", "Dark Glass", "Minimal", "Night Mode"],
    idle: true,
    controls: { sensitivity: true },
  },
  {
    id: "oscilloscope",
    name: "Oscilloscope",
    category: "meters",
    stable: true,
    presets: ["Green Phosphor", "Amber Trace", "Blue Trace", "White Studio"],
    idle: true, // flat trace with a faint hum
    controls: { sensitivity: true },
  },
  {
    id: "waterfall",
    name: "Waterfall",
    category: "meters",
    stable: true,
    presets: ["Studio Blue", "Amber Heat", "Monochrome", "Deep Space"],
    idle: true,
    controls: { sensitivity: true },
  },
  {
    id: "studio-monitor",
    name: "Studio Monitor",
    category: "meters",
    stable: true,
    presets: ["Mastering", "Minimal", "Blue Studio", "Amber Studio"],
    idle: true,
    controls: { sensitivity: true },
  },
  // ------------------------------------------------------------- scenes
  {
    id: "classical",
    name: "Classical",
    category: "scenes",
    stable: true,
    presets: ["Default"],
    idle: true, // sways gently before any audio plays
    controls: { sensitivity: false },
  },
  {
    id: "synthwave",
    name: "Synthwave",
    category: "scenes",
    stable: true,
    presets: ["Default"],
    idle: true,
    controls: { sensitivity: false }, // fixed internal gain (FIXED_SENSITIVITY); dial does nothing here
  },
  {
    id: "milkdrop",
    name: "MilkDrop",
    category: "scenes",
    stable: false, // butterchurn/WebGL2 — needs a perf pass on the Pi
    presets: ["Auto Cycle", "Hard Cuts", "Hold"],
    idle: true, // presets keep flowing before audio arrives
    controls: { sensitivity: false }, // butterchurn normalizes levels internally
  },
  {
    id: "galaxy",
    name: "Galaxy",
    category: "scenes",
    stable: false, // still evolving
    presets: ["Default"],
    idle: true,
    controls: { sensitivity: true },
  },
  {
    id: "aurora",
    name: "Aurora",
    category: "scenes",
    stable: true,
    presets: ["Aurora Green", "Solar Violet", "Ice Blue", "Ember"],
    idle: true, // curtains breathe gently before any audio
    controls: { sensitivity: true },
  },
  {
    id: "pixelquest",
    name: "Pixel Quest",
    category: "scenes",
    stable: false,
    presets: ["Default"],
    idle: true,
    controls: { sensitivity: true },
  },
];

export const byId = (id) => REGISTRY.find((m) => m.id === id);
