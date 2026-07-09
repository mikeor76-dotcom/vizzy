#!/usr/bin/env bash
# One-time: make the Vizzy splash the Pi's BOOT screen (Plymouth), and set it as
# the desktop wallpaper so there's no bare desktop flash before the kiosk browser
# opens. Pairs with the in-app loading splash (index.html) that covers the
# Chromium load itself.
#
# Run once on the Pi from a checkout of this repo:  sudo bash deploy/splash-setup.sh
# Then reboot to see it:  sudo reboot
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "!! run with sudo:  sudo bash deploy/splash-setup.sh"; exit 1; }
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIOSK_USER="${SUDO_USER:-pi}"
SRC="$REPO_DIR/deploy/vizzy-splash-boot.png"
[[ -f "$SRC" ]] || { echo "!! missing $SRC (did you git pull?)"; exit 1; }

# canonical copy the boot + wallpaper both point at
install -d /usr/share/vizzy
install -m 644 "$SRC" /usr/share/vizzy/vizzy-splash.png
DEST=/usr/share/vizzy/vizzy-splash.png
echo "==> Splash image: $DEST"

# 1) Plymouth boot splash (Raspberry Pi OS ships the 'pix' theme) -----------
if [[ -d /usr/share/plymouth/themes/pix ]]; then
  T=/usr/share/plymouth/themes/pix/splash.png
  [[ -f "$T" && ! -f "$T.vizzy-orig" ]] && cp -a "$T" "$T.vizzy-orig"  # back up original once
  cp -a "$DEST" "$T"
  command -v plymouth-set-default-theme >/dev/null 2>&1 && plymouth-set-default-theme pix >/dev/null 2>&1 || true
  echo "==> Plymouth: installed splash into the 'pix' theme"
else
  echo "!! Plymouth 'pix' theme not found — skipping boot splash."
  echo "   Install it with:  sudo apt install plymouth plymouth-themes  (then re-run)"
fi

# 2) Boot flags: show plymouth quietly, drop the rainbow + logos ------------
BOOT=/boot/firmware; [[ -d "$BOOT" ]] || BOOT=/boot   # Bookworm vs older path
CMD="$BOOT/cmdline.txt"; CFG="$BOOT/config.txt"
if [[ -f "$CMD" ]]; then
  cp -a "$CMD" "$CMD.vizzy-bak" 2>/dev/null || true
  for tok in quiet splash plymouth.ignore-serial-consoles logo.nologo; do
    grep -qw -- "$tok" "$CMD" || sed -i "1 s|\$| $tok|" "$CMD"   # cmdline.txt is a single line
  done
  echo "==> $CMD: ensured  quiet splash plymouth.ignore-serial-consoles logo.nologo"
fi
if [[ -f "$CFG" ]]; then
  grep -q "^disable_splash=1" "$CFG" || printf '\n# Vizzy: hide the rainbow test screen\ndisable_splash=1\n' >> "$CFG"
  echo "==> $CFG: disable_splash=1"
fi

# 3) Desktop wallpaper — best effort; covers the moment between login and the
#    kiosk browser painting. Non-fatal on any compositor it can't reach.
USER_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"; [[ -n "$USER_HOME" ]] || USER_HOME="/home/$KIOSK_USER"
# Wayland / wayfire (Pi 5 Bookworm default)
WF="$USER_HOME/.config/wayfire.ini"
if command -v wayfire >/dev/null 2>&1 || [[ -f "$WF" ]]; then
  sudo -u "$KIOSK_USER" mkdir -p "$(dirname "$WF")" 2>/dev/null || true
  if ! grep -q "^\[background\]" "$WF" 2>/dev/null; then
    printf '\n[background]\nimage=%s\nmode=fill\n' "$DEST" | sudo -u "$KIOSK_USER" tee -a "$WF" >/dev/null 2>&1 || true
  fi
fi
# X11 / LXDE (pcmanfm)
sudo -u "$KIOSK_USER" DISPLAY=:0 pcmanfm --set-wallpaper "$DEST" --wallpaper-mode=crop >/dev/null 2>&1 || true
echo "==> Wallpaper: set for '$KIOSK_USER' (best effort)"

echo
echo "==> Done. Reboot to see the boot splash:  sudo reboot"
