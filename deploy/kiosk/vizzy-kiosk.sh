#!/usr/bin/env bash
# Vizzy kiosk launcher — opens Chromium fullscreen on a local splash page that
# forwards to the app as soon as the server is up, so the bare desktop is never
# visible during warmup. Started at desktop login by the XDG autostart entry that
# deploy/kiosk-setup.sh installs. Works on Raspberry Pi OS (X11/LXDE and
# Wayland/labwc). The app URL starts Galaxy mode and grabs the mic on load.
set -u
PORT="${VIZZY_APP_PORT:-3000}"
APP_URL="http://localhost:${PORT}/?mode=galaxy&input=mic"
SPLASH_IMG="/usr/share/vizzy/vizzy-splash.png"
SPLASH_HTML="/usr/share/vizzy/splash.html"

# Cover the desktop the instant we start: swaybg paints the background layer,
# then Chromium (below) opens fullscreen over everything (incl. the panel).
# swaybg is a wlroots layer-shell client (labwc/wayfire); installed by
# deploy/splash-setup.sh; costs ~nothing sitting behind Chromium.
if command -v swaybg >/dev/null 2>&1 && [ -f "$SPLASH_IMG" ]; then
  swaybg -i "$SPLASH_IMG" -m fit -c 000000 >/dev/null 2>&1 &
fi

# keep the LED wall awake (X11 — harmless no-ops under Wayland)
xset s off -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true
unclutter -idle 0 >/dev/null 2>&1 &   # hide the cursor if `unclutter` is installed

# Open Chromium RIGHT AWAY on the local splash page (needs no server) — it polls
# /health and forwards to the app the moment it's up, so there's no ~10s of
# visible desktop during warmup. Falls back to the old wait-then-open flow on
# installs that don't have the splash page yet (run deploy/splash-setup.sh).
if [ -f "$SPLASH_HTML" ]; then
  START_URL="file://${SPLASH_HTML}?port=${PORT}"
else
  for _ in $(seq 1 90); do
    curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1 && break
    sleep 1
  done
  START_URL="$APP_URL"
fi

BROWSER="$(command -v chromium-browser || command -v chromium || echo chromium)"
exec "$BROWSER" \
  --kiosk --start-fullscreen --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble --disable-features=Translate \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  "$START_URL"
