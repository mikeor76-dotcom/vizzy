#!/usr/bin/env bash
# Vizzy kiosk launcher — waits for the app server to be healthy, then opens
# Chromium fullscreen. Started at desktop login by the XDG autostart entry that
# deploy/kiosk-setup.sh installs. Works on Raspberry Pi OS (X11/LXDE and
# Wayland/labwc). The URL params start Galaxy mode and grab the mic on load.
set -u
PORT="${VIZZY_APP_PORT:-3000}"
URL="http://localhost:${PORT}/?mode=galaxy&input=mic"

# wait up to ~90s for the systemd service to answer /health (avoids a race where
# Chromium loads before the server is up and shows an error page)
for _ in $(seq 1 90); do
  curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done

# keep the LED wall awake (X11 — harmless no-ops under Wayland)
xset s off -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true
unclutter -idle 0 >/dev/null 2>&1 &   # hide the cursor if `unclutter` is installed

BROWSER="$(command -v chromium-browser || command -v chromium || echo chromium)"
exec "$BROWSER" \
  --kiosk --start-fullscreen --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble --disable-features=Translate \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  "$URL"
