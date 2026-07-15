// Hardware input for the physical Vizzy device — the browser end.
//
// LIVE as of 2026-07: an EC11 rotary encoder on the Pi's GPIO. The chain is
//   deploy/vizzy-encoder.py  (gpiozero reads the encoder)
//     → POST /api/input      (loopback only)
//     → scripts/serve.mjs    (fans out over Server-Sent Events)
//     → connect() below      (EventSource → dispatch)
//     → controller methods   (the SAME ones the keyboard + panel call)
// SSE rather than a WebSocket: no dependency on either end, no extra port,
// and EventSource reconnects on its own if the daemon or server restarts.
//
// Physical mapping (deploy/encoder-setup.sh):
//   Encoder rotate → mode:prev / mode:next   (the whole lineup, wrapping)
//   Encoder press  → favorite:toggle         (star the one you like)
// Room to grow — every action below is already dispatchable, so a second
// encoder or a switch only needs the daemon to name it:
//   category:next/prev · preset:cycle · lock:toggle · controls:toggle · mic:toggle
// (sensitivity is automatic now — see src/autogain.js — no knob needed)

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

export function createHardwareInput(controller, { toggleMic, onEvent } = {}) {
  const dispatch = (action, arg) => {
    // onEvent sees EVERY action before it runs — the ?hwdebug=1 overlay uses
    // this to prove events are arriving even if a mapping is wrong
    if (onEvent) {
      try { onEvent(action, arg, !!ACTION_MAP[action] || action === "mic:toggle"); } catch {}
    }
    if (action === "mic:toggle" && toggleMic) return toggleMic();
    const fn = ACTION_MAP[action];
    if (fn) fn(controller, arg);
    else console.warn(`[vizzy-hardware] unknown action: ${action}`);
  };

  return {
    dispatch, // programmatic entry point: dispatch("mode:next")

    // Subscribe to physical-control events relayed by the appliance server.
    // Each SSE message is {"action":"mode:next"} / {"action":"mode:set","arg":"galaxy"}.
    // EventSource retries on its own, so a daemon or server restart heals.
    connect(url = "/api/input/stream") {
      const es = new EventSource(url);
      es.onmessage = (ev) => {
        try {
          const { action, arg } = JSON.parse(ev.data);
          dispatch(action, arg);
        } catch {
          /* ignore malformed frames */
        }
      };
      es.onopen = () => console.info("[vizzy-hardware] physical controls connected");
      return es;
    },
  };
}
