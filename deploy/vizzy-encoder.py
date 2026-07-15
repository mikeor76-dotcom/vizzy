#!/usr/bin/env python3
"""Vizzy EC11 rotary-encoder daemon — the physical controls for the appliance.

  rotate  ->  previous / next visualization (the whole lineup, wrapping)
  press   ->  favorite the current visualization (star it)

It reads the encoder with gpiozero and POSTs an action to the Vizzy app server,
which relays it to the browser over SSE (see scripts/serve.mjs /api/input and
src/hardware.js). Nothing here talks to the browser directly, and nothing needs
pip: gpiozero + lgpio ship with Raspberry Pi OS Bookworm (and lgpio is the
backend that actually works on the Pi 5's RP1), while the POST is stdlib
urllib. Install with:  sudo bash deploy/encoder-setup.sh

Wiring (bare EC11, the common case — pins are configurable, see env below):
    EC11 CLK (A)  -> GPIO17  (pin 11)
    EC11 DT  (B)  -> GPIO27  (pin 13)
    EC11 SW       -> GPIO22  (pin 15)
    EC11 GND / C  -> any GND (pin 9)
  With the common pin to GND we use the Pi's internal pull-ups, so no + wire
  and no resistors are needed. A breakout board with a "+" pin also works this
  way; if yours pulls to 3V3 instead, set VIZZY_ENCODER_PULLUP=false.

Env (systemd reads /opt/vizzy/state/vizzy.env):
    VIZZY_APP_PORT           app port (default 3000)
    VIZZY_ENCODER_CLK/DT/SW  BCM pin numbers (default 17 / 27 / 22)
    VIZZY_ENCODER_DIVIDER    steps per detent (default 1; try 2 or 4 if one
                             click jumps several visualizations)
    VIZZY_ENCODER_PULLUP     true (default) = common pin wired to GND
    VIZZY_ENCODER_REVERSE    true = swap rotation direction
"""
import json
import os
import sys
import threading
import urllib.error
import urllib.request

from gpiozero import Button, RotaryEncoder

PORT = os.environ.get("VIZZY_APP_PORT", "3000")
URL = os.environ.get("VIZZY_INPUT_URL", f"http://127.0.0.1:{PORT}/api/input")
PIN_CLK = int(os.environ.get("VIZZY_ENCODER_CLK", "17"))
PIN_DT = int(os.environ.get("VIZZY_ENCODER_DT", "27"))
PIN_SW = int(os.environ.get("VIZZY_ENCODER_SW", "22"))
DIVIDER = max(1, int(os.environ.get("VIZZY_ENCODER_DIVIDER", "1")))
PULLUP = os.environ.get("VIZZY_ENCODER_PULLUP", "true").lower() not in ("0", "false", "no")
REVERSE = os.environ.get("VIZZY_ENCODER_REVERSE", "false").lower() in ("1", "true", "yes")


def send(action):
    """POST one action. Never raises: the daemon must outlive a server restart."""
    body = json.dumps({"action": action}).encode()
    req = urllib.request.Request(
        URL, data=body, headers={"content-type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=1) as r:
            clients = json.loads(r.read() or b"{}").get("clients", 0)
            if clients == 0:
                print(f"[vizzy-encoder] {action} (no browser listening yet)", flush=True)
            else:
                print(f"[vizzy-encoder] {action}", flush=True)
    except urllib.error.URLError as e:
        print(f"[vizzy-encoder] {action} -> app not reachable ({e.reason})", flush=True)
    except Exception as e:  # noqa: BLE001 - a bad frame must never kill the knob
        print(f"[vizzy-encoder] {action} -> {e}", flush=True)


_steps = 0
_lock = threading.Lock()


def rotated(delta):
    """Accumulate quadrature steps and emit one action per detent."""
    global _steps
    if REVERSE:
        delta = -delta
    # the lock only guards the counter — send() does blocking HTTP, so it must
    # not run while held or a fast spin would stall the encoder callback thread
    actions = []
    with _lock:
        _steps += delta
        while abs(_steps) >= DIVIDER:
            step = 1 if _steps > 0 else -1
            _steps -= step * DIVIDER
            actions.append("mode:next" if step > 0 else "mode:prev")
    for action in actions:
        send(action)


def main():
    print(
        f"[vizzy-encoder] CLK=GPIO{PIN_CLK} DT=GPIO{PIN_DT} SW=GPIO{PIN_SW} "
        f"divider={DIVIDER} pullup={PULLUP} reverse={REVERSE} -> {URL}",
        flush=True,
    )
    try:
        encoder = RotaryEncoder(PIN_CLK, PIN_DT, max_steps=0, wrap=False)
        # bounce_time debounces the EC11's mechanical switch contacts
        button = Button(PIN_SW, pull_up=PULLUP, bounce_time=0.05)
    except Exception as e:  # noqa: BLE001
        print(f"[vizzy-encoder] GPIO setup failed: {e}", file=sys.stderr, flush=True)
        print(
            "[vizzy-encoder] check the pins, that the user is in the 'gpio' group, "
            "and that nothing else holds these lines.",
            file=sys.stderr,
            flush=True,
        )
        return 1

    encoder.when_rotated_clockwise = lambda: rotated(1)
    encoder.when_rotated_counter_clockwise = lambda: rotated(-1)
    button.when_pressed = lambda: send("favorite:toggle")

    print("[vizzy-encoder] ready — rotate to change, press to favorite", flush=True)
    from signal import pause

    pause()
    return 0


if __name__ == "__main__":
    sys.exit(main())
