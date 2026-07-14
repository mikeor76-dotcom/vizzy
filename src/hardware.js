// Hardware input abstraction for the future physical Vizzy device.
//
// The plan: a Raspberry Pi with rotary encoders and switches. A small
// daemon (Python/Node reading GPIO) will forward input events to the
// browser — via a local WebSocket, keyboard-emulation (uinput), or GPIO →
// keypress mapping. Whatever the transport, every event lands on the SAME
// controller methods the keyboard and debug panel use, so the app never
// knows or cares where input came from.
//
// Proposed physical mapping:
//   Encoder A rotate  → controller.previousCategory() / nextCategory()
//   Encoder A press   → controller.toggleLock()
//   Encoder B rotate  → controller.previousMode() / nextMode()
//   Encoder B press   → controller.toggleFavorite()
//   Encoder C press   → controller.cyclePreset()
//   (sensitivity is automatic now — see src/autogain.js — no knob needed)
//   Switch 1          → toggleMic()
//   Switch 2 (hold)   → controller.toggleControlsVisible()
//
// This module implements the browser side: a tiny event API plus an
// optional WebSocket listener that a GPIO daemon can connect to later.
// It is inert unless explicitly started.

const ACTION_MAP = {
  "category:next": (c) => c.nextCategory(),
  "category:prev": (c) => c.previousCategory(),
  "mode:next": (c) => c.nextMode(),
  "mode:prev": (c) => c.previousMode(),
  "mode:set": (c, arg) => c.setMode(arg),
  "preset:cycle": (c) => c.cyclePreset(),
  "favorite:toggle": (c) => c.toggleFavorite(),
  "lock:toggle": (c) => c.toggleLock(),
  "controls:toggle": (c) => c.toggleControlsVisible(),
};

export function createHardwareInput(controller, { toggleMic } = {}) {
  const dispatch = (action, arg) => {
    if (action === "mic:toggle" && toggleMic) return toggleMic();
    const fn = ACTION_MAP[action];
    if (fn) fn(controller, arg);
    else console.warn(`[vizzy-hardware] unknown action: ${action}`);
  };

  return {
    dispatch, // programmatic entry point: dispatch("mode:next")

    // Future: the Pi GPIO daemon connects here and sends JSON lines like
    // {"action": "mode:next"} or {"action": "mode:set", "arg": "galaxy"}.
    // Call connect() with the daemon's address when the hardware exists.
    connect(url = "ws://localhost:8765") {
      const ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const { action, arg } = JSON.parse(ev.data);
          dispatch(action, arg);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onerror = () => console.warn("[vizzy-hardware] daemon not reachable");
      return ws;
    },
  };
}
