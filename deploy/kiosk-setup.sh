#!/usr/bin/env bash
# Make the Pi boot straight into the Vizzy visualizer.
#
# Run as your NORMAL user (no sudo). It installs an XDG autostart entry that
# launches deploy/kiosk/vizzy-kiosk.sh at desktop login (works on both LXDE/X11
# and labwc/Wayland). It also tries to enable desktop auto-login via raspi-config
# so no password prompt blocks boot (needs sudo for just that step).
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$REPO_DIR/deploy/kiosk/vizzy-kiosk.sh"

chmod +x "$LAUNCHER"
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/vizzy-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Vizzy Kiosk
Comment=Launch the Vizzy visualizer fullscreen on login
Exec=$LAUNCHER
X-GNOME-Autostart-enabled=true
EOF
echo "==> Installed autostart: $HOME/.config/autostart/vizzy-kiosk.desktop"
echo "    Launcher: $LAUNCHER"

# enable desktop auto-login so the session (and thus the kiosk) starts unattended
if command -v raspi-config >/dev/null 2>&1; then
  echo "==> Enabling desktop auto-login (raspi-config; may prompt for sudo)"
  sudo raspi-config nonint do_boot_behaviour B4 || echo "   (skip: set 'Desktop Autologin' manually via: sudo raspi-config -> System Options -> Boot / Auto Login)"
fi

echo
echo "==> Done. Test it now without rebooting:"
echo "      $LAUNCHER"
echo "    Or reboot to confirm the full boot-to-visualizer flow:"
echo "      sudo reboot"
