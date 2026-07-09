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
  # On Bookworm the boot splash is loaded from the INITRAMFS, not /usr/share —
  # so swapping the file alone changes nothing until the initramfs is rebuilt.
  # This is why the Raspberry Pi logo kept showing. Rebuild it (safe no-op if
  # the system doesn't use one).
  if command -v update-initramfs >/dev/null 2>&1; then
    echo "    rebuilding initramfs so the splash ships in the boot image (~30s)…"
    if update-initramfs -u >/dev/null 2>&1; then echo "    initramfs updated ✓"; else echo "    (initramfs rebuild failed — boot splash may not change)"; fi
  fi
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

# 3) Wallpaper renderer: swaybg (the wlroots layer-shell wallpaper tool — works
#    on labwc AND wayfire). The KIOSK LAUNCHER paints the splash with it at
#    startup, so there's no bare desktop while the app loads; here we just make
#    sure it's installed. No GUI dialogs, unlike the old pcmanfm path.
if command -v swaybg >/dev/null 2>&1; then
  echo "==> swaybg already installed ✓"
else
  echo "==> Installing swaybg (wallpaper renderer)…"
  apt-get install -y swaybg >/dev/null 2>&1 \
    && echo "    swaybg installed ✓" \
    || echo "    (couldn't install swaybg — needs internet; the kiosk will just skip the pre-load wallpaper)"
fi

echo
echo "==> Done."
echo "    Reboot to see the boot splash:            sudo reboot"
echo "    (the desktop-load wallpaper is painted by the kiosk launcher on login)"
