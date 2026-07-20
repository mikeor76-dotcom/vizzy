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
// `nowPlaying` is the now-playing overlay placement (src/npoverlay.js):
// style faceplate/dock/chip/label/banner/lower/sides/off + optional
// pos/transient — chosen per mode so song info lands where the composition
// can afford it. `inset: true` (faceplate analyzers) makes main.js ease the
// mode's render region rightward so the text column is ceded, not covered.
//
// Two content categories: METERS (analytical readouts that show you the
// signal) and SCENES (immersive artistic visuals).

export const CATEGORIES = [
  { id: "meters", name: "Meters" },
  { id: "scenes", name: "Scenes" },
];

export const REGISTRY = [
  // ------------------------------------------------------------- meters
  {
    id: "bars",
    name: "Bars",
    category: "meters",
    // faceplate: the hi-fi treatment — ARTIST/TITLE/elapsed in a quiet left
    // column; `inset` makes main.js ease the bars rightward to cede it
    nowPlaying: { style: "faceplate", inset: true },
    stable: true,
    presets: ["Default"],
    idle: false, // draws only while the mic is live (raw analyser view)
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "colorbars",
    name: "Color Bars",
    category: "meters",
    nowPlaying: { style: "faceplate", inset: true },
    stable: true,
    presets: ["Default"],
    idle: false,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "spectrum",
    name: "Spectrum",
    category: "meters",
    nowPlaying: { style: "faceplate", inset: true },
    stable: true,
    presets: ["Default"],
    idle: false,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "wave",
    name: "Wave",
    category: "meters",
    nowPlaying: { style: "chip", pos: "tl" },
    stable: true,
    presets: ["Default"],
    idle: false,
    // self-governing: it normalizes on time-domain EXCURSION, which "linear"
    // (a frequency-bin measure) solved for wrongly — that's why it barely moved
    auto: null,
  },
  {
    id: "radial",
    name: "Radial",
    category: "meters",
    // faceplate like the other analyzers (the user's reference shows the ring
    // with the same left column); the ring is centered, so no inset needed
    nowPlaying: { style: "faceplate" },
    stable: true,
    presets: ["Default"],
    idle: false,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "blue-power-meters",
    name: "Blue Meters",
    category: "meters",
    nowPlaying: { style: "label", pos: "tr" },
    stable: true,
    presets: ["Classic Blue", "Dark Glass", "Minimal", "Night Mode"],
    idle: true,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "oscilloscope",
    name: "Oscilloscope",
    category: "meters",
    nowPlaying: { style: "label", pos: "tl" },
    stable: true,
    presets: ["Green Phosphor", "Amber Trace", "Blue Trace", "White Studio"],
    idle: true, // flat trace with a faint hum
    // self-governing: auto-ranges on time-domain EXCURSION, which "linear"
    // (a frequency-bin measure) solved for wrongly — the trace sat at ~5% tall
    auto: null,
  },
  {
    id: "flames",
    name: "Flame Spectrum",
    category: "meters",
    nowPlaying: { style: "banner" },
    stable: false, // heat automaton — needs a perf pass on the Pi
    presets: ["Inferno", "Blue Gas", "Witchfire Green", "White Heat"],
    idle: true, // pilot flames gutter along the hearth before any audio
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "harmony",
    name: "Harmony Wheel",
    category: "meters",
    nowPlaying: { style: "off" },
    stable: false, // needs a look on the Pi panel
    presets: ["Spectral", "Gold Engraving", "Nebula"],
    idle: true, // the ring rests at "listening…" before any audio
    // self-governing: chroma.js runs its own tonality gate and normalizes the
    // pitch-class vector per frame — AutoGain has nothing to say about harmony
    auto: null,
    // asks main.js for the 8192-fft analyser: the shared 2048 cannot resolve a
    // semitone below ~C5, so a chroma built on it would be fiction
    needsChroma: true,
  },
  {
    id: "notefall",
    name: "Note-Fall",
    category: "meters",
    nowPlaying: { style: "off" },
    stable: false, // needs a look on the Pi panel
    presets: ["Pitch Hue", "Register", "Mono Gold"],
    idle: true, // the keyboard breathes over an empty roll before any audio
    // self-governing like harmony: chroma's tonality gate + note confidences
    // decide what appears — AutoGain has no note to say about pitch
    auto: null,
    needsChroma: true,
  },
  {
    id: "waterfall",
    name: "Waterfall",
    category: "meters",
    nowPlaying: { style: "off" },
    stable: true,
    presets: ["Studio Blue", "Amber Heat", "Monochrome", "Deep Space"],
    idle: true,
    auto: { model: "linear", target: 0.8, clamp: [0.6, 5] },
  },
  {
    id: "studio-monitor",
    name: "Studio Monitor",
    category: "meters",
    nowPlaying: { style: "label", pos: "tr" },
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
    nowPlaying: { style: "lower", transient: true },
    stable: true,
    presets: ["Default"],
    idle: true, // sways gently before any audio plays
    auto: null,
  },
  {
    id: "synthwave",
    name: "Synthwave",
    category: "scenes",
    nowPlaying: { style: "lower", transient: true },
    stable: true,
    presets: ["Default"],
    idle: true,
    auto: null,
  },
  {
    id: "milkdrop",
    name: "MilkDrop",
    category: "scenes",
    nowPlaying: { style: "lower", transient: true },
    stable: false, // butterchurn/WebGL2 — needs a perf pass on the Pi
    presets: ["Auto Cycle", "Hard Cuts", "Hold"],
    idle: true, // presets keep flowing before audio arrives
    auto: null,
  },
  {
    id: "galaxy",
    name: "Galaxy",
    category: "scenes",
    nowPlaying: { style: "lower", transient: true },
    stable: false, // still evolving
    presets: ["Default"],
    idle: true,
    auto: { model: "agc", target: 0.62 },
  },
  {
    id: "aurora",
    name: "Aurora",
    category: "scenes",
    nowPlaying: { style: "lower", transient: true },
    stable: true,
    presets: ["Aurora Green", "Solar Violet", "Ice Blue", "Ember"],
    idle: true, // curtains breathe gently before any audio
    auto: { model: "agc", target: 0.62 },
  },
  {
    id: "ferrofluid",
    name: "Ferrofluid",
    category: "scenes",
    nowPlaying: { style: "sides" },
    stable: true,
    presets: ["Chrome Cyan", "Magma", "Violet", "Mercury"],
    idle: true, // the mass breathes softly before any audio
    // self-governing: normalizes every spectral band against its own slow
    // peak, so it re-ranges to any music by itself
    auto: null,
  },
  {
    id: "skyline",
    name: "City Skyline",
    category: "scenes",
    nowPlaying: { style: "chip", pos: "tr" },
    stable: false, // batched-rect city — needs a perf pass on the Pi
    presets: ["Midnight Amber", "Cyberpunk Neon", "Blackout Storm", "Dawn"],
    idle: true, // the sleeping city: night owls + stars before any audio
    // self-governing: per-band auto-level behind a silence gate. It LOOKS like
    // the frequency-bin case linear was made for, but raw band levels differ
    // ~20x between bass and treble — one global sensitivity left the suburbs
    // at 0-3% lit on every genre measured. Each district ranges itself.
    auto: null,
  },
  {
    id: "lasers",
    name: "Laser Show",
    category: "scenes",
    nowPlaying: { style: "off" },
    stable: false, // additive polylines — needs a perf pass on the Pi
    presets: ["Club RGB", "Emerald Mono", "Sunset", "UV Violet"],
    idle: true, // the rig at rest: one faint fan through breathing haze
    // self-governing: normalized against its own peaks behind a silence gate
    auto: null,
  },
  {
    id: "cymatics",
    name: "Cymatics",
    category: "scenes",
    nowPlaying: { style: "label", pos: "mr" },
    stable: false, // 10k-grain sim — needs a perf pass on the Pi
    presets: ["Gold Sand", "Iron Filings", "Neon Cyan", "Ember"],
    idle: true, // the last figure holds, museum-still, glow breathing
    // self-governing: SilenceGate + own contrast-stretched energy ranging
    auto: null,
    // asks for the 8192-fft analyser (not the Chroma class): the plate's mode
    // is picked by the dominant peak quantized to SEMITONES, and the shared
    // 2048 can't resolve a semitone below ~C5
    needsChroma: true,
  },
  {
    id: "inkfluid",
    name: "Ink Fluid",
    category: "scenes",
    nowPlaying: { style: "lower", transient: true },
    stable: false, // real 2D fluid solver — needs a perf pass on the Pi
    presets: ["Bioluminescent", "Nebula", "Sumi-e", "Lava"],
    idle: true, // the ink fades to black over ~20s, then near-still darkness
    // self-governing: SilenceGate + per-band peaks + contrast-stretched energy
    auto: null,
    // asks for the 8192-fft analyser: note onsets bloom ink at their pitch
    // position — sparse music (solo piano) is note EVENTS, not bands
    needsChroma: true,
  },
  {
    id: "vectorcrt",
    name: "Vector CRT",
    category: "scenes",
    nowPlaying: { style: "off" },
    stable: false, // feedback-buffer persistence — needs a perf pass on the Pi
    presets: ["P1 Green", "P7 Blue", "Amber Mono"],
    idle: true, // the standby dot drifts with its burn-in ghost
    // self-governing: time-domain excursion range (the wave.js lesson) behind
    // a silence gate
    auto: null,
  },
  {
    id: "murmuration",
    name: "Murmuration",
    category: "scenes",
    nowPlaying: { style: "lower", transient: true },
    stable: false, // ~1000-boid sim — needs a perf pass on the Pi
    presets: ["Dusk", "Night Neon", "Dawn Silver", "Storm"],
    idle: true, // the flock sits on the reeds until music wakes it
    // self-governing: normalizes against its own slow peaks behind a silence
    // gate, so it re-ranges to any music by itself
    auto: null,
  },
  {
    id: "pixelquest",
    name: "Pixel Quest",
    category: "scenes",
    nowPlaying: { style: "lower", transient: true },
    stable: false,
    presets: ["Default"],
    idle: true,
    auto: { model: "agc", target: 0.62, clamp: [1.0, 1.6] },
  },
  {
    id: "nowplaying",
    name: "Now Playing",
    category: "scenes",
    stable: false, // new — needs a look on the Pi panel
    presets: ["Default"],
    idle: true, // shows its listening state before any audio
    // self-governing: the only audio it reads is a decorative bass glow
    auto: null,
    // the mode IS the song info — the overlay never shows here
    nowPlaying: { style: "off" },
  },
];

export const byId = (id) => REGISTRY.find((m) => m.id === id);
