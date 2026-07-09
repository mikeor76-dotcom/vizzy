# Vizzy

A web-based audio visualizer built with the Web Audio API and canvas.

## Features

- **Load audio** — visualize any local audio file (mp3, wav, ogg, ...)
- **Use mic** — visualize live microphone input (not routed to speakers, so no feedback)
- **Ten modes** — frequency bars (classic and multi-color), **Spectrum** (neon rainbow analyzer with falling peak caps, floor reflections, and rising sparks), **Classical** (intertwined golden silk ribbons with rising gold dust and a reflective floor — elegance in motion), **Synthwave** (a retro neon sunset that IS the analyzer: the mountain silhouette is the live spectrum — bass builds the outer peaks, treble sharpens the ones by the striped sun — over a loudness-driven perspective grid), **Pixel Quest** (a lost 16-bit cartridge: a tiny cloaked hero walks a looping fantasy landscape rendered on a low-res canvas and upscaled with nearest-neighbor; bass pulses torches and terrain, treble twinkles stars and fireflies, beats trigger hero hops, sword flashes, and sparkle bursts; six biomes rotate every ~1-2 minutes; and rare retro cameo moments — moon flybys, roadside jukeboxes, purple rain, a boulder chase — surface via the special-event system in [src/pixelquest-events.js](src/pixelquest-events.js)), waveform, radial spokes, **Event Horizon**, and **Cinematic Galaxy**: a Cosmic Atlas Journey through a local scene library of real astronomy and curated cinematic plates (see [public/assets/galaxy/README.md](public/assets/galaxy/README.md)). The journey moves in a rhythm — slow drift through a region, a destination glow builds with the music, a fast jump with long streaks and a bloom flash crossfades into the next region, then deceleration into new exploration. Scene metadata (mood, fog, brightness, pan, reactivity) drives variety: foggy nebula regions alternate with crisp open space, planet regions greet you with a photo-textured world, black-hole regions are rare encounters. Every layer has a procedural fallback, and the scene is beautiful before any audio plays.
- **Event Horizon** — a cinematic lensed black hole ([src/blackhole.js](src/blackhole.js)), composed like Gargantua: a huge off-center hole, a near-edge-on accretion disk sweeping diagonally across the whole frame (per-column plasma-texture rendering with Doppler beaming and a mids-revealed turbulence layer), a bright gravitationally-lensed arc over the horizon with a dimmer return arc below, a clean black horizon with a thin photon rim, and sparse deflected stars over deep space. Bass is gravitational pressure (disk thickens, lensing brightens, camera pushes in); beats send brightness pulses travelling along the disk; treble adds white-hot glints and rare thin jets. Tunable via `BLACKHOLE_DEFAULTS` (`gravityStrength`, `diskBrightness`, `diskTurbulence`, `lensingIntensity`, `holeX/holeY`, `diskRoll`, `bassReactivity`, `trebleSparkle`, `signalHorizonIntensity`).
- **Tunable galaxy** — `Galaxy` accepts a config object (`galaxyQuality`, `travelSpeed`, `starDensity`, `planetDetail`, `debrisAmount`, `beatReactivity`, `bassThrust`, `trebleSparkle`, `heroMomentFrequency`, `signalHorizonIntensity`, `cinematicVignette`, `subtleGrain`, `lowRes`); `lowRes: "auto"` switches to an LED-matrix-friendly rendering below 240px, and `galaxyQuality: "auto"` sheds detail if the device can't hold ~40 fps

## Getting started

```bash
npm install
npm run dev
```

Then open the printed URL (default http://localhost:5173), load an audio file or enable your mic, and switch modes from the bottom control bar.

## Build

```bash
npm run build
```

Outputs a static site to `dist/`.

## Kiosk / Raspberry Pi (e.g. 1920×480 LED wall)

The controls and cursor auto-hide after 4 seconds idle, and two URL params make
unattended boot possible:

- `?mode=galaxy` — start in a given mode
- `?input=mic` — grab the microphone on load (no click needed)
- `?sens=1.6` — music sensitivity (0.5–2.5, default 1.25); without the param, the
  last value set on the control-bar slider is remembered

On the Pi:

```bash
# serve the built site locally (localhost = secure context, so mic works)
python3 -m http.server 8080 -d dist &

chromium-browser --kiosk --noerrdialogs --disable-session-crashed-bubble \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  "http://localhost:8080/?mode=galaxy&input=mic"
```

`--use-fake-ui-for-media-stream` auto-accepts the mic permission prompt (it still
uses the real ALSA input — check `arecord -l` to confirm the Pi sees your mic or
line-in). Galaxy mode scales itself down automatically if the Pi can't hold
~40 fps, and creeps back up when there's headroom.

Pi 5 notes:

- A Pi 5 (any RAM size) runs this at full quality — the adaptive scaling is just a safety net.
- The Pi 5 has **no 3.5mm audio jack**: mic/line-in requires a USB microphone or USB audio interface.
- On Raspberry Pi OS Bookworm the browser command may be `chromium` instead of `chromium-browser`.

## Self-updating appliance (staged updates + auto-rollback)

For a physical Pi appliance, Vizzy can update itself safely: it keeps running the
current version while a new one downloads, stages the download without touching
the live app, applies it only on the next restart, smoke-tests it, and
**automatically rolls back** if the new version fails to start. If there's no
internet, update checks are skipped and the app launches normally — offline never
blocks startup.

### Layout on the device

```
/opt/vizzy/
  current/   ← the running app (built dist/ + scripts/ + version.json)
  next/      ← a staged update waiting to be applied
  backup/    ← last known good version (rollback target)
  state/     ← version.json, update-status.json, update-lock, vizzy.env
  logs/      ← updater.log
```

Directory swaps are atomic renames; `backup/` is never deleted until a newer
update takes its place; versions are compared with real semver (so `1.10.0` >
`1.9.0`).

### Configuration (env, read from `/opt/vizzy/state/vizzy.env`)

| Variable | Default | Purpose |
|---|---|---|
| `VIZZY_ROOT` | `/opt/vizzy` | Root of the layout above |
| `VIZZY_APP_PORT` | `3000` | Port the app server listens on |
| `VIZZY_HEALTH_URL` | `http://localhost:3000/health` | Smoke-test endpoint |
| `VIZZY_UPDATE_MANIFEST_URL` | *(unset)* | Remote manifest to check; unset = updates disabled |
| `VIZZY_AUTO_UPDATE` | `true` | Set `false` to disable background checks |

### Install on the Pi (once)

```bash
git clone <repo> ~/vizzy && cd ~/vizzy
curl -fsSL https://bun.sh/install | bash          # if bun isn't installed
sudo bash deploy/install.sh                        # builds, lays out /opt/vizzy, installs systemd units
sudo nano /opt/vizzy/state/vizzy.env               # set VIZZY_UPDATE_MANIFEST_URL to enable updates
sudo systemctl restart vizzy.service
```

Point the kiosk browser at the app server instead of a manual `python3 -m http.server`:

```bash
chromium-browser --kiosk ... "http://localhost:3000/?mode=galaxy&input=mic"
```

### npm/bun scripts

```bash
bun run start          # run the app server (serves dist/, exposes /health)
bun run update:check   # background check + stage if newer (offline-safe, exits 0)
bun run update:stage   # force-download+stage the manifest release (ignores version gate)
bun run update:apply   # apply staged next/ (run before launch; recovers a failed update)
bun run update:confirm # smoke-test the running version; rolls back if unhealthy
bun run update:rollback# manually restore backup/ as current/
bun run update:status  # print versions in each slot + last status (JSON)
```

### systemd units (samples in `deploy/systemd/`, installed by `deploy/install.sh`)

- `vizzy.service` — runs the app from `current/`, restarts on failure, smoke-tests
  via `ExecStartPost`, and rolls back on repeated failure (`OnFailure`).
- `vizzy-apply-update.service` — oneshot, ordered **before** the app: applies a
  staged update or recovers a failed one.
- `vizzy-update-check.service` + `.timer` — background check ~2 min after boot and
  every 6 h; exits cleanly when offline.
- `vizzy-rollback.service` — automatic rollback backstop for crash-loops.

### Publishing a new release

```bash
# bump the version, then build + package:
#   edit version.json  (e.g. "1.0.1")
bash deploy/make-release.sh https://cdn.example.com/vizzy
# -> release/vizzy-1.0.1.zip  and  release/manifest.json (with sha256)
```

Upload `vizzy-1.0.1.zip` to the `releaseUrl` in the manifest, then publish
`manifest.json` at your `VIZZY_UPDATE_MANIFEST_URL`. Devices pick it up on their
next check, stage it, and apply it on their next restart.

### Manual rollback

```bash
sudo -u pi bash -lc 'cd /opt/vizzy/current && VIZZY_ROOT=/opt/vizzy bun run update:rollback'
sudo systemctl restart vizzy.service
```
