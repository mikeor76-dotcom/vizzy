#!/usr/bin/env python3
"""Vizzy encoder diagnostic — find out whether the knob is doing ANYTHING.

Answers, in order, the three questions you actually have:
  1. Is the encoder sending a signal at all?
  2. Which GPIO pins is it really on?          (--scan)
  3. Does it decode into clean rotation?       (default watch mode)

    sudo systemctl stop vizzy-encoder            # release the pins first!

    sudo python3 deploy/encoder-diagnose.py --scan
        Watches EVERY usable GPIO. Turn the knob, press the button, and it
        tells you which pins moved — so a miswire (or wrong pin numbers in
        vizzy.env) shows up immediately.

    sudo python3 deploy/encoder-diagnose.py
        Watches the CONFIGURED pins (vizzy.env / the same defaults the daemon
        uses): prints every raw edge, every decoded detent, and the button.
        Turn exactly ONE detent to read off your VIZZY_ENCODER_DIVIDER.

    sudo systemctl start vizzy-encoder           # when you're done
"""
import os
import sys
import time
from collections import Counter

try:
    from gpiozero import Button, DigitalInputDevice, RotaryEncoder
except Exception as e:  # noqa: BLE001
    print(f"!! gpiozero import failed: {e}")
    print("   sudo apt install -y python3-gpiozero python3-lgpio")
    sys.exit(1)

PIN_CLK = int(os.environ.get("VIZZY_ENCODER_CLK", "17"))
PIN_DT = int(os.environ.get("VIZZY_ENCODER_DT", "27"))
PIN_SW = int(os.environ.get("VIZZY_ENCODER_SW", "22"))
PULLUP = os.environ.get("VIZZY_ENCODER_PULLUP", "true").lower() not in ("0", "false", "no")

# BCM pins broken out on the 40-pin header that are safe to watch as inputs.
# (0/1 are the HAT EEPROM; we leave those alone.)
SCAN_PINS = list(range(2, 28))


def ts():
    return time.strftime("%H:%M:%S") + f".{int((time.time() % 1) * 1000):03d}"


def scan():
    print(f"Watching GPIO {SCAN_PINS[0]}..{SCAN_PINS[-1]} with pull-ups enabled.\n")
    devices, edges, busy = {}, Counter(), []
    for p in SCAN_PINS:
        try:
            devices[p] = DigitalInputDevice(p, pull_up=True)
        except Exception as e:  # noqa: BLE001
            busy.append(f"GPIO{p} ({type(e).__name__})")
    if busy:
        print("  in use / unavailable, skipped: " + ", ".join(busy))
        print("  (if your pins are in that list, run: sudo systemctl stop vizzy-encoder)\n")

    def watch(pin):
        def cb():
            edges[pin] += 1
            print(f"  [{ts()}] GPIO{pin:<2} -> {devices[pin].value}   (edges: {edges[pin]})")
        return cb

    for p, d in devices.items():
        d.when_activated = watch(p)
        d.when_deactivated = watch(p)

    resting = {p: d.value for p, d in devices.items()}
    print(f"  {len(devices)} pins armed. Resting HIGH: "
          f"{[p for p, v in resting.items() if v]}\n")
    print("=> TURN THE KNOB a few clicks, then PRESS the button.")
    print("   (Ctrl-C when done — I'll summarize.)\n")
    try:
        while True:
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass

    print("\n" + "=" * 58)
    if not edges:
        print("NO PIN MOVED AT ALL.")
        print("  The Pi never saw the encoder. Most likely:")
        print("   * the common/GND pin isn't actually connected to a Pi GND")
        print("   * CLK/DT/SW aren't seated in the header (or a solder joint is cold)")
        print("   * the encoder itself is dead — check continuity: turning the")
        print("     shaft should make/break CLK->GND and DT->GND")
        return
    ranked = edges.most_common()
    print("PINS THAT MOVED (most active first):")
    for p, n in ranked:
        print(f"   GPIO{p:<3} {n:>5} edges")
    rot = [p for p, n in ranked if n >= 4][:2]
    btn = [p for p, n in ranked if p not in rot]
    print()
    if len(rot) >= 2:
        print(f"=> Rotation is on GPIO{rot[0]} and GPIO{rot[1]}  (CLK/DT — order decides direction)")
    elif len(rot) == 1:
        print(f"=> Only GPIO{rot[0]} moved while turning — the other rotation pin isn't connected.")
    if btn:
        print(f"=> Button is most likely GPIO{btn[0]}")
    print()
    print("Put these in /opt/vizzy/state/vizzy.env, then restart the daemon:")
    print(f"   VIZZY_ENCODER_CLK={rot[0] if rot else '?'}")
    print(f"   VIZZY_ENCODER_DT={rot[1] if len(rot) > 1 else '?'}")
    print(f"   VIZZY_ENCODER_SW={btn[0] if btn else '?'}")
    print("   sudo systemctl restart vizzy-encoder")
    print("(If rotation ends up backwards, set VIZZY_ENCODER_REVERSE=true.)")


def watch_configured():
    print(f"Configured pins:  CLK=GPIO{PIN_CLK}  DT=GPIO{PIN_DT}  SW=GPIO{PIN_SW}  pull_up={PULLUP}")
    try:
        enc = RotaryEncoder(PIN_CLK, PIN_DT, max_steps=0, wrap=False)
        btn = Button(PIN_SW, pull_up=PULLUP, bounce_time=0.05)
    except Exception as e:  # noqa: BLE001
        print(f"\n!! Could not claim those pins: {e}")
        print("   Is the daemon still holding them?  sudo systemctl stop vizzy-encoder")
        print("   Wrong pins? Find the real ones:  sudo python3 deploy/encoder-diagnose.py --scan")
        return

    state = {"steps": 0}

    def rotated(direction):
        state["steps"] += 1
        print(f"  [{ts()}] rotate {direction:<16} steps this run: {state['steps']}   encoder.steps={enc.steps}")

    enc.when_rotated_clockwise = lambda: rotated("CLOCKWISE →")
    enc.when_rotated_counter_clockwise = lambda: rotated("COUNTER-CLOCK ←")
    btn.when_pressed = lambda: print(f"  [{ts()}] BUTTON PRESSED  ✓")
    btn.when_released = lambda: print(f"  [{ts()}] button released")

    print("\n=> TURN THE KNOB. Every step prints below.")
    print("   Then: turn exactly ONE detent (one click) from a standstill and")
    print("   count the lines — that number is your VIZZY_ENCODER_DIVIDER.")
    print("   Then PRESS the button.  (Ctrl-C when done.)\n")
    try:
        while True:
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass

    print("\n" + "=" * 58)
    if state["steps"] == 0:
        print("NO ROTATION DETECTED on these pins.")
        print("  Either the wiring doesn't match these pin numbers, or there's no")
        print("  signal at all. Find out which:")
        print("     sudo python3 deploy/encoder-diagnose.py --scan")
    else:
        print(f"Rotation works ✓  ({state['steps']} steps seen)")
        print("  If one CLICK produced ~2 or ~4 lines, set VIZZY_ENCODER_DIVIDER to")
        print("  that number in /opt/vizzy/state/vizzy.env so one click = one mode.")


if __name__ == "__main__":
    print("\nVizzy encoder diagnostic")
    print("=" * 58)
    if "--scan" in sys.argv:
        scan()
    else:
        watch_configured()
    print()
