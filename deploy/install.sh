#!/usr/bin/env bash
# Vizzy appliance installer — run ONCE on the Raspberry Pi from a checkout of
# this repo:   sudo bash deploy/install.sh
#
# It builds the app, lays out /opt/vizzy/{current,state,logs}, writes the env
# file, symlinks bun so systemd can find it, and installs + enables the units.
set -euo pipefail

VIZZY_ROOT="${VIZZY_ROOT:-/opt/vizzy}"
VIZZY_USER="${VIZZY_USER:-${SUDO_USER:-pi}}"
VIZZY_APP_PORT="${VIZZY_APP_PORT:-3000}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Vizzy installer"
echo "    repo:  $REPO_DIR"
echo "    root:  $VIZZY_ROOT"
echo "    user:  $VIZZY_USER"

if [[ "$(id -u)" -ne 0 ]]; then echo "!! run with sudo (needs /opt + systemd)"; exit 1; fi

# Find bun by ABSOLUTE path. Never trust root's PATH here: it may hold a stale
# /usr/local/bin/bun symlink, and symlinking that to itself creates a loop.
USER_HOME="$(getent passwd "$VIZZY_USER" | cut -d: -f6)"; [[ -z "$USER_HOME" ]] && USER_HOME="/home/$VIZZY_USER"
BUN=""
for cand in "$USER_HOME/.bun/bin/bun" "$(sudo -u "$VIZZY_USER" bash -lc 'command -v bun' 2>/dev/null)" "$(command -v bun 2>/dev/null)"; do
  [[ -n "$cand" ]] || continue
  real="$(readlink -f "$cand" 2>/dev/null)"; [[ -x "$real" ]] || real="$cand"
  if [[ -x "$real" && "$real" != "/usr/local/bin/bun" ]]; then BUN="$real"; break; fi
done
[[ -z "$BUN" ]] && { echo "!! bun not found. Install it as $VIZZY_USER (no sudo): curl -fsSL https://bun.sh/install | bash"; exit 1; }
echo "    bun:   $BUN"
ln -sf "$BUN" /usr/local/bin/bun    # stable path for systemd (BUN is the real binary, never the symlink)

echo "==> Building the app"
sudo -u "$VIZZY_USER" env "PATH=$(dirname "$BUN"):/usr/local/bin:/usr/bin:/bin" \
  bash -c "cd '$REPO_DIR' && bun install && bun run build"

echo "==> Laying out $VIZZY_ROOT"
mkdir -p "$VIZZY_ROOT/state" "$VIZZY_ROOT/logs"
STAGE="$(mktemp -d)"
# runtime release = built app + scripts + metadata (no node_modules / no src needed)
for item in dist scripts package.json version.json README.md; do
  [[ -e "$REPO_DIR/$item" ]] && cp -a "$REPO_DIR/$item" "$STAGE/"
done
rm -rf "$VIZZY_ROOT/current.new"
mv "$STAGE" "$VIZZY_ROOT/current.new"
# atomic swap into current/
rm -rf "$VIZZY_ROOT/current.old"
[[ -d "$VIZZY_ROOT/current" ]] && mv "$VIZZY_ROOT/current" "$VIZZY_ROOT/current.old"
mv "$VIZZY_ROOT/current.new" "$VIZZY_ROOT/current"

# state/version.json + a fresh status
cp -a "$REPO_DIR/version.json" "$VIZZY_ROOT/state/version.json"
printf '{\n  "status": "current",\n  "currentVersion": %s\n}\n' \
  "$("$BUN" -e 'console.log(JSON.stringify(require("'"$REPO_DIR"'/version.json").version))' 2>/dev/null || echo '"1.0.0"')" \
  > "$VIZZY_ROOT/state/update-status.json"

# env file (edit VIZZY_UPDATE_MANIFEST_URL to enable auto-update)
if [[ ! -f "$VIZZY_ROOT/state/vizzy.env" ]]; then
  cat > "$VIZZY_ROOT/state/vizzy.env" <<EOF
# Vizzy appliance configuration (read by every systemd unit)
VIZZY_ROOT=$VIZZY_ROOT
VIZZY_APP_PORT=$VIZZY_APP_PORT
VIZZY_HEALTH_URL=http://localhost:$VIZZY_APP_PORT/health
VIZZY_AUTO_UPDATE=true
# Set this to your published manifest to enable background updates:
VIZZY_UPDATE_MANIFEST_URL=
EOF
fi

chown -R "$VIZZY_USER":"$VIZZY_USER" "$VIZZY_ROOT"

echo "==> Installing systemd units (User=$VIZZY_USER)"
for unit in "$REPO_DIR"/deploy/systemd/*.service "$REPO_DIR"/deploy/systemd/*.timer; do
  sed -e "s/^User=pi/User=$VIZZY_USER/" -e "s/^Group=pi/Group=$VIZZY_USER/" \
      -e "s#/opt/vizzy#$VIZZY_ROOT#g" "$unit" > "/etc/systemd/system/$(basename "$unit")"
done
systemctl daemon-reload
systemctl enable vizzy-apply-update.service vizzy.service vizzy-update-check.timer
systemctl start vizzy.service

echo "==> Done. App: http://localhost:$VIZZY_APP_PORT   health: /health"
echo "    Status:  bun --cwd $VIZZY_ROOT/current run update:status"
echo "    Logs:    journalctl -u vizzy.service -f   |   tail -f $VIZZY_ROOT/logs/updater.log"
