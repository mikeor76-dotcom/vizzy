// Vizzy visualizer controller — the central state layer between ANY input
// (on-screen debug panel, keyboard, future rotary encoders on the Pi) and
// the renderer. Inputs never touch visualizers directly; they call methods
// here, the controller updates state, persists it, and notifies listeners
// (main.js applies changes to the renderer instances and UI).

import { CATEGORIES, REGISTRY, byId } from "./registry.js";

const STORE = {
  mode: "vizzy-mode",
  category: "vizzy-category",
  controls: "vizzy-controls-visible",
  npOverlay: "vizzy-np-overlay",
};

export class VisualizerController {
  constructor() {
    // true if a mode was previously chosen + saved — lets a kiosk ?mode= URL act
    // as a first-boot default only, so the remembered last mode wins after that.
    this.hadSavedMode = localStorage.getItem(STORE.mode) != null && byId(localStorage.getItem(STORE.mode)) != null;
    this.currentModeId = localStorage.getItem(STORE.mode) || "bars";
    if (!byId(this.currentModeId)) this.currentModeId = "bars";
    this.currentCategory = localStorage.getItem(STORE.category) || byId(this.currentModeId).category;
    // a persisted category can be stale (a category we've since renamed or
    // removed) — fall back to the current mode's own home category, never a
    // hardcoded id that might not exist either
    if (!CATEGORIES.some((c) => c.id === this.currentCategory)) this.currentCategory = byId(this.currentModeId).category;
    this.currentPreset = byId(this.currentModeId).presets[0];
    this.controlsVisible = localStorage.getItem(STORE.controls) !== "false";
    // now-playing overlay visibility. Like last-mode, the SERVER-injected value
    // wins on the appliance (kiosk Chromium drops localStorage); localStorage
    // drives it in a normal browser. Default: on.
    this.npOverlay =
      typeof window !== "undefined" && typeof window.__vizzyNpOverlay === "boolean"
        ? window.__vizzyNpOverlay
        : localStorage.getItem(STORE.npOverlay) !== "false";
    this.locked = false; // never persisted: a fresh boot is always unlocked
    this.overlayData = null;
    this.overlayUntil = 0;
    this.listeners = new Set();
  }

  // ------------------------------------------------------------ plumbing
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  #emit(what) {
    for (const fn of this.listeners) fn(what, this);
  }
  #loadJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }
  #persist() {
    localStorage.setItem(STORE.mode, this.currentModeId);
    localStorage.setItem(STORE.category, this.currentCategory);
    localStorage.setItem(STORE.controls, this.controlsVisible);
  }

  // ------------------------------------------------------------- queries
  get currentEntry() {
    return byId(this.currentModeId);
  }
  categoryName(id = this.currentCategory) {
    return CATEGORIES.find((c) => c.id === id)?.name || id;
  }
  modesInCategory(catId = this.currentCategory) {
    return REGISTRY.filter((m) => m.category === catId);
  }
  // navigable = has at least one mode (Hi-Fi stays visible in the panel but
  // the knobs skip it until it has instruments)
  #navigableCategories() {
    return CATEGORIES.filter((c) => this.modesInCategory(c.id).length > 0);
  }

  // ---------------------------------------------------------- navigation
  #deny() {
    this.showTemporaryOverlay({ line1: "LOCKED", line2: "press L to unlock" });
  }
  setCategory(catId, { andMode = true } = {}) {
    if (this.locked) return this.#deny();
    if (!CATEGORIES.some((c) => c.id === catId)) return;
    const modes = this.modesInCategory(catId);
    if (!modes.length) return; // nothing to show there yet
    this.currentCategory = catId;
    if (andMode && !modes.some((m) => m.id === this.currentModeId)) {
      this.currentModeId = modes[0].id;
      this.currentPreset = modes[0].presets[0];
    }
    this.#persist();
    this.#announce();
    this.#emit("mode");
  }
  #stepCategory(dir) {
    const cats = this.#navigableCategories();
    const ix = Math.max(0, cats.findIndex((c) => c.id === this.currentCategory));
    this.setCategory(cats[(ix + dir + cats.length) % cats.length].id);
  }
  nextCategory() {
    this.#stepCategory(1);
  }
  previousCategory() {
    this.#stepCategory(-1);
  }
  setMode(modeId) {
    if (this.locked) return this.#deny();
    const entry = byId(modeId);
    if (!entry) return;
    this.currentModeId = modeId;
    // the panel follows each mode into its home category
    this.currentCategory = entry.category;
    this.currentPreset = entry.presets[0];
    this.#persist();
    this.#announce();
    this.#emit("mode");
  }
  // ←/→ (and the future hardware encoder) traverse the FULL lineup, wrapping
  // across categories like a single knob — the panel follows each mode into
  // its home category via setMode. ↑/↓ still jump by category.
  #stepMode(dir) {
    if (this.locked) return this.#deny();
    const ix = Math.max(0, REGISTRY.findIndex((m) => m.id === this.currentModeId));
    this.setMode(REGISTRY[(ix + dir + REGISTRY.length) % REGISTRY.length].id);
  }
  nextMode() {
    this.#stepMode(1);
  }
  previousMode() {
    this.#stepMode(-1);
  }

  // --------------------------------------------------------- adjustments
  cyclePreset() {
    const presets = this.currentEntry.presets;
    const ix = presets.indexOf(this.currentPreset);
    this.currentPreset = presets[(ix + 1) % presets.length];
    this.#announce();
    this.#emit("preset");
  }
  toggleLock() {
    this.locked = !this.locked;
    this.showTemporaryOverlay({
      line1: this.locked ? "🔒 LOCKED" : "🔓 UNLOCKED",
      line2: this.currentEntry.name,
    });
    this.#emit("lock");
  }
  toggleControlsVisible() {
    this.controlsVisible = !this.controlsVisible;
    this.#persist();
    this.#emit("controls");
  }
  toggleNpOverlay() {
    this.npOverlay = !this.npOverlay;
    localStorage.setItem(STORE.npOverlay, this.npOverlay);
    this.showTemporaryOverlay({
      line1: this.npOverlay ? "♪ SONG INFO ON" : "SONG INFO OFF",
      line2: this.npOverlay ? "now-playing overlay enabled" : "hold the knob (or press N) to re-enable",
    });
    this.#emit("npoverlay");
  }

  // -------------------------------------------------------------- overlay
  // hi-fi-gear style feedback: shown for a moment on every change
  #announce() {
    this.showTemporaryOverlay({
      line1: this.categoryName().toUpperCase(),
      line2: this.currentEntry.name,
      line3: `Preset: ${this.currentPreset}`,
    });
  }
  showTemporaryOverlay(data, seconds = 2.4) {
    this.overlayData = data;
    this.overlayUntil = performance.now() + seconds * 1000;
    this.#emit("overlay");
  }
}
