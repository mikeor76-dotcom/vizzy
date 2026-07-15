#!/usr/bin/env bash
# One-time: enable the EC11 rotary encoder as Vizzy's physical control.
#   rotate -> previous / next visualization      press -> favorite it
#
# Run on the Pi from a checkout of this repo:  sudo bash deploy/encoder-setup.sh
# Re-run any time to change pins (see the env below) — it's idempotent.
#
# Wiring (bare EC11 — the common pin to GND, using the Pi's internal pull-ups,
# so no + wire and no resistors):
#     EC11 CLK (A)  -> GPIO17  (header pin 11)
#     EC11 DT  (B)  -> GPIO27  (header pin 13)
#     EC11 SW       -> GPIO22  (header pin 15)
#     EC11 GND / C  -> GND     (header pin 9)
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "!! run with sudo:  sudo bash deploy/encoder-setup.sh"; exit 1; }
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIZZY_USER="${SUDO_USER:-vizzy}"
VIZZY_ROOT="${VIZZY_ROOT:-/opt/vizzy}"
ENV_FILE="$VIZZY_ROOT/state/vizzy.env"

# 1) deps — both ship with Raspberry Pi OS Bookworm; lgpio is the backend that
#    actually works on the Pi 5's RP1 chip (RPi.GPIO does NOT).
echo "==> Checking GPIO libraries"
MISSING=()
python3 -c "import gpiozero" 2>/dev/null || MISSING+=(python3-gpiozero)
python3 -c "import lgpio" 2>/dev/null || MISSING+=(python3-lgpio)
if (( ${#MISSING[@]} )); then
  echo "    installing: ${MISSING[*]}"
  apt-get update -qq && apt-get install -y "${MISSING[@]}"
else
  echo "    gpiozero + lgpio present ✓"
fi

# 2) the daemon's user needs GPIO character-device access
if getent group gpio >/dev/null; then
  usermod -aG gpio "$VIZZY_USER" 2>/dev/null || true
  echo "==> Added $VIZZY_USER to the 'gpio' group"
fi

# 2b) prove GPIO actually works AS THE SERVICE USER, from the same working
#     directory the unit uses. gpiozero otherwise reports only "Unable to load
#     any default pin factory!", which hides whether the real problem is the
#     device permissions or lgpio's need for a writable cwd.
echo "==> Testing GPIO access as '$VIZZY_USER'"
ls -l /dev/gpiochip* 2>/dev/null | sed 's/^/    /' || echo "    (no /dev/gpiochip* found!)"
GPIO_TEST='
import os
os.environ.setdefault("GPIOZERO_PIN_FACTORY", "lgpio")
from gpiozero import Device
Device.ensure_pin_factory()
print("    OK - pin factory:", type(Device.pin_factory).__name__)
'
if sudo -u "$VIZZY_USER" env LG_WD=/tmp sh -c "cd /tmp && python3 -c '$GPIO_TEST'" 2>&1 | sed 's/^/    /'; then
  :
fi

# 3) pin config lives in the same env file every unit reads
if [[ -f "$ENV_FILE" ]]; then
  grep -q '^VIZZY_ENCODER_CLK=' "$ENV_FILE" || cat >> "$ENV_FILE" <<'EOF'

# --- EC11 rotary encoder (deploy/vizzy-encoder.py) -------------------------
# BCM pin numbers. Change these to match how you wired it, then:
#   sudo systemctl restart vizzy-encoder
VIZZY_ENCODER_CLK=17
VIZZY_ENCODER_DT=27
VIZZY_ENCODER_SW=22
# Steps per detent. If ONE click jumps several visualizations, set this to 2
# or 4 (EC11s vary in how many quadrature pulses they emit per detent).
VIZZY_ENCODER_DIVIDER=1
# true = the encoder's common pin is wired to GND (internal pull-ups). Set
# false only if your breakout pulls to 3V3 instead.
VIZZY_ENCODER_PULLUP=true
# true = swap which way is "next"
VIZZY_ENCODER_REVERSE=false
EOF
  echo "==> Pin config in $ENV_FILE"
else
  echo "!! $ENV_FILE not found — run  sudo bash deploy/install.sh  first."
  exit 1
fi

# 4) install the daemon itself to a stable path. NOT into $VIZZY_ROOT/current:
#    install.sh only copies dist/scripts/package.json/version.json/README.md
#    there, and an OTA update swaps that whole directory out — so the script
#    would be missing (or vanish on the next update). Re-run this script after
#    a git pull to refresh it.
install -d /usr/local/lib/vizzy
install -m 755 "$REPO_DIR/deploy/vizzy-encoder.py" /usr/local/lib/vizzy/vizzy-encoder.py
echo "==> Daemon: /usr/local/lib/vizzy/vizzy-encoder.py"

# 5) install + start the unit (install.sh copies the file; we enable it here,
#    since only a device that actually HAS an encoder should run the daemon)
install -m 644 "$REPO_DIR/deploy/systemd/vizzy-encoder.service" /tmp/vizzy-encoder.service
sed -e "s/^User=pi/User=$VIZZY_USER/" -e "s/^Group=pi/Group=$VIZZY_USER/" \
    -e "s#/opt/vizzy#$VIZZY_ROOT#g" /tmp/vizzy-encoder.service > /etc/systemd/system/vizzy-encoder.service
rm -f /tmp/vizzy-encoder.service
systemctl daemon-reload
systemctl enable vizzy-encoder.service >/dev/null 2>&1 || true
systemctl restart vizzy-encoder.service
echo "==> vizzy-encoder.service enabled + started"

# the service auto-restarts, so "is-active" right away can catch a crash loop
# mid-restart and look healthy — wait long enough to see it actually stay up
sleep 3
if systemctl is-active --quiet vizzy-encoder.service; then
  echo
  echo "    Ready. Turn the knob to change visualization; press to favorite."
  echo "    Watch it:   journalctl -u vizzy-encoder -f"
  echo "    Change pins: sudo nano $ENV_FILE  &&  sudo systemctl restart vizzy-encoder"
else
  echo
  echo "!! The daemon isn't staying up. Its own reason (not just systemd's):"
  echo "----------------------------------------------------------------"
  journalctl -u vizzy-encoder -n 12 --no-pager -o cat | grep -E "vizzy-encoder\]|Error|error" || \
    journalctl -u vizzy-encoder -n 12 --no-pager -o cat
  echo "----------------------------------------------------------------"
  echo "   Full log:  journalctl -u vizzy-encoder -n 30 --no-pager"
fi
