// Vizzy visualizer registry — the single source of truth for what modes
// exist, how they're organized, and what they support. The UI (debug panel),
// the controller, keyboard input, and future hardware knobs all read this;
// nothing hardcodes mode lists anywhere else.
//
// `render(ctx, analyser, w, h, now)` and `fade` are attached by main.js at
// startup (the renderer instances live there); everything else is static
// metadata, so this module stays import-safe for the controller.

export const CATEGORIES = [
  { id: "classic", name: "Classic" },
  { id: "hifi", name: "Hi-Fi" },
  // Future cinematic modes: Nebula, Starfield, Deep Space.
  { id: "cinematic", name: "Cinematic" },
  // Future worlds: Castle Journey, Boss Battle, Space Flight.
  { id: "worlds", name: "Worlds" },
  { id: "favorites", name: "Favorites" },
];

export const REGISTRY = [
  // ------------------------------------------------------------- classic
  {
    id: "bars",
    name: "Bars",
    category: "classic",
    stable: true,
    presets: ["Default"],
    idle: false, // draws only while the mic is live (raw analyser view)
    controls: { sensitivity: false },
  },
  {
    id: "colorbars",
    name: "Color Bars",
    category: "classic",
    stable: true,
    presets: ["Default"],
    idle: false,
    controls: { sensitivity: false },
  },
  {
    id: "spectrum",
    name: "Spectrum",
    category: "classic",
    stable: true,
    presets: ["Default"],
    idle: false,
    controls: { sensitivity: false },
  },
  {
    id: "classical",
    name: "Classical",
    category: "classic",
    stable: true,
    presets: ["Default"],
    idle: true, // sways gently before any audio plays
    controls: { sensitivity: false },
  },
  {
    id: "wave",
    name: "Wave",
    category: "classic",
    stable: true,
    presets: ["Default"],
    idle: false,
    controls: { sensitivity: false },
  },
  {
    id: "radial",
    name: "Radial",
    category: "classic",
    stable: true,
    presets: ["Default"],
    idle: false,
    controls: { sensitivity: false },
  },
  {
    id: "synthwave",
    name: "Synthwave",
    category: "classic",
    stable: true,
    presets: ["Default"],
    idle: true,
    controls: { sensitivity: false }, // fixed internal gain (FIXED_SENSITIVITY); dial does nothing here
  },
  // --------------------------------------------------------------- hi-fi
  {
    id: "analog-vu",
    name: "Analog VU",
    category: "hifi",
    stable: true,
    presets: ["Warm", "Studio", "Vintage", "Minimal"],
    idle: true, // needles rest at zero, backlight stays warm
    controls: { sensitivity: true },
  },
  {
    id: "blue-power-meters",
    name: "Blue Meters",
    category: "hifi",
    stable: true,
    presets: ["Classic Blue", "Dark Glass", "Minimal", "Night Mode"],
    idle: true,
    controls: { sensitivity: true },
  },
  {
    id: "oscilloscope",
    name: "Oscilloscope",
    category: "hifi",
    stable: true,
    presets: ["Green Phosphor", "Amber Trace", "Blue Trace", "White Studio"],
    idle: true, // flat trace with a faint hum
    controls: { sensitivity: true },
  },
  {
    id: "waterfall",
    name: "Waterfall",
    category: "hifi",
    stable: true,
    presets: ["Studio Blue", "Amber Heat", "Monochrome", "Deep Space"],
    idle: true,
    controls: { sensitivity: true },
  },
  {
    id: "studio-monitor",
    name: "Studio Monitor",
    category: "hifi",
    stable: true,
    presets: ["Mastering", "Minimal", "Blue Studio", "Amber Studio"],
    idle: true,
    controls: { sensitivity: true },
  },
  // ----------------------------------------------------------- cinematic
  {
    id: "galaxy",
    name: "Galaxy",
    category: "cinematic",
    stable: false, // still evolving
    presets: ["Default"],
    idle: true,
    controls: { sensitivity: true },
  },
  {
    id: "blackhole",
    name: "Event Horizon",
    category: "cinematic",
    stable: false,
    presets: ["Default"],
    idle: true,
    controls: { sensitivity: true },
  },
  // -------------------------------------------------------------- worlds
  {
    id: "pixelquest",
    name: "Pixel Quest",
    category: "worlds",
    stable: false,
    presets: ["Default"],
    idle: true,
    controls: { sensitivity: true },
  },
];

export const byId = (id) => REGISTRY.find((m) => m.id === id);
