// Keyboard input for Vizzy — one of several input sources (on-screen debug
// panel, keyboard, future hardware knobs). Everything routes through the
// controller; nothing here touches visualizers or the DOM directly.
//
//   ← / →     previous / next visualization within the current category
//   ↑ / ↓     previous / next category
//   [ / ]     sensitivity down / up
//   P         cycle preset
//   F         toggle favorite
//   L         lock/unlock the current visualization
//   H         show / hide the debug control panel
//   Space     start / stop the microphone
//
// Pixel Quest only (Biome System v1), while it's the active mode:
//   B         next biome        Shift+B   previous biome
//   1-5       force a specific biome (meadow/neon/moonlit/arcade/castle)
//   J         force the current biome's arrival moment right now
//   D         toggle the full-screen debug dashboard (graphics/perf/state)

export function initKeyboardControls(controller, { toggleMic, pixelquest }) {
  window.addEventListener("keydown", (e) => {
    // never steal keys from form fields (e.g. the sensitivity slider)
    if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName) && e.key !== "Escape") {
      if (e.key === " ") return; // space on a focused button/slider stays native
    }
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        // in Pixel Quest with the debug screen up, arrows page the debug app
        if (pixelquest && controller.currentModeId === "pixelquest" && pixelquest.debugScreenOpen()) {
          pixelquest.cycleDebugPage(1);
        } else {
          controller.nextMode();
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (pixelquest && controller.currentModeId === "pixelquest" && pixelquest.debugScreenOpen()) {
          pixelquest.cycleDebugPage(-1);
        } else {
          controller.previousMode();
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        controller.nextCategory();
        break;
      case "ArrowUp":
        e.preventDefault();
        controller.previousCategory();
        break;
      case "]":
        controller.increaseSensitivity();
        break;
      case "[":
        controller.decreaseSensitivity();
        break;
      case "p":
      case "P":
        controller.cyclePreset();
        break;
      case "f":
      case "F":
        controller.toggleFavorite();
        break;
      case "l":
      case "L":
        controller.toggleLock();
        break;
      case "h":
      case "H":
        controller.toggleControlsVisible();
        break;
      case " ":
        e.preventDefault();
        toggleMic();
        break;
      // Biome System v1 — Pixel Quest only, never touches global controls
      case "b":
      case "B":
        if (pixelquest && controller.currentModeId === "pixelquest") {
          if (e.shiftKey) pixelquest.previousBiome();
          else pixelquest.nextBiome();
        }
        break;
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
        if (pixelquest && controller.currentModeId === "pixelquest") {
          const id = pixelquest.allBiomeIds()[Number(e.key) - 1];
          if (id) pixelquest.forceBiome(id);
        }
        break;
      case "j":
      case "J":
        if (pixelquest && controller.currentModeId === "pixelquest") pixelquest.adventure.forceArrivalNow();
        break;
      case "d":
      case "D":
        if (pixelquest && controller.currentModeId === "pixelquest") pixelquest.toggleDebugScreen();
        break;
    }
  });
}
