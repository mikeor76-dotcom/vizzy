# Vizzy

A web-based audio visualizer built with the Web Audio API and canvas.

## Features

- **Load audio** — visualize any local audio file (mp3, wav, ogg, ...)
- **Use mic** — visualize live microphone input (not routed to speakers, so no feedback)
- **Ten modes** — frequency bars (classic and multi-color), **Spectrum** (neon rainbow analyzer with falling peak caps, floor reflections, and rising sparks), **Classical** (intertwined golden silk ribbons with rising gold dust and a reflective floor — elegance in motion), **Synthwave** (a retro neon sunset that IS the analyzer: the mountain silhouette is the live spectrum — bass builds the outer peaks, treble sharpens the ones by the striped sun — over a loudness-driven perspective grid), **Pixel Quest** (a lost 16-bit cartridge: a tiny cloaked hero walks a looping fantasy landscape rendered on a low-res canvas and upscaled with nearest-neighbor; bass pulses torches and terrain, treble twinkles stars and fireflies, beats trigger hero hops, sword flashes, and sparkle bursts; six biomes rotate every ~1-2 minutes; a diegetic **World Resonance** analyzer makes the song a natural force in the world — a Songstream of music-light (motes, tiny notes, sparks, ribbons) flows through the air toward the orb, a Resonance Path pulses along the ground as the hidden bass visualizer, the orb itself is the main meter, and inferred song sections (intro→build→chorus→breakdown) shape it all (see [src/pixelquest-resonance.js](src/pixelquest-resonance.js)); and rare retro cameo moments — moon flybys, roadside jukeboxes, purple rain, a boulder chase — surface via the special-event system in [src/pixelquest-events.js](src/pixelquest-events.js)), waveform, radial spokes, **Event Horizon**, and **Cinematic Galaxy**: a Cosmic Atlas Journey through a local scene library of real astronomy and curated cinematic plates (see [public/assets/galaxy/README.md](public/assets/galaxy/README.md)). The journey moves in a rhythm — slow drift through a region, a destination glow builds with the music, a fast jump with long streaks and a bloom flash crossfades into the next region, then deceleration into new exploration. Scene metadata (mood, fog, brightness, pan, reactivity) drives variety: foggy nebula regions alternate with crisp open space, planet regions greet you with a photo-textured world, black-hole regions are rare encounters. Every layer has a procedural fallback, and the scene is beautiful before any audio plays.
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

## Pixel Quest cinematic opening

When the **mic starts listening** on Pixel Quest, a ~24s silent-film intro plays
before gameplay (6 story plates with Ken-Burns drift + crossfades and layered
golden FX; fully wordless by default) then dissolves into gameplay.
Any key/click/tap **skips** it straight into gameplay (`openingSequenceSkippable:
true`); it does not start until there's live audio input. It's Pi-safe and degrades gracefully —
if the plates are missing it logs a warning and drops straight into gameplay. See
[src/pixelquest-opening.js](src/pixelquest-opening.js).

**Assets** live under `public/assets/pixelquest/`:

```
opening_story/                 # 6 full-scene plates (1280×720), opaque, NO baked-in text
  01_silent_world.png  02_first_note.png  03_music_awakens.png
  04_orb_forms.png     05_orb_chooses_him.png  06_bring_music_back.png
  opening_story_sequence.json  # mirror of the in-code sequence (reference only)
opening_fx/                    # magenta-keyed FX strips (transparent)
  music_fragments_strip.png (6 frames)  orb_forming_strip.png (6, sparkles)
  pulse_rings_strip.png (4)             golden_path_tile.png (5, orb-forming)
  sparkles_strip.png (1, golden path band)
```

To (re)prepare the assets from a drop folder: `bun scripts/prep-opening.mjs`
(downscales the plates, keys/trims the FX). Title-card text is rendered in code,
never baked into images.

**Config** (on the Pixel Quest instance `cfg`, or edit the defaults in
`src/pixelquest.js`):

- `openingSequenceEnabled` (default `true`)
- `openingSequencePlayMode`: `"startup"` (once per app launch, default) · `"always"`
  (every time you enter Pixel Quest) · `"firstRunOnly"` (once ever, remembered in
  localStorage) · `"disabled"`
- `openingSequenceSkippable` (default `true` — any key/click/tap skips the intro;
  set `false` to make it unskippable)

**Replay / skip / disable** — from the browser console (also handy on the Pi via
remote devtools):

```js
pixelQuestOpening.replay()          // play it again now, ignoring play-mode/seen
pixelQuestOpening.skip()            // skip the current run
pixelQuestOpening.status()          // { state, beat, ... }
pixelQuestOpening.setEnabled(false) // turn it off for this session
```

Any key/click/tap skips it by default (`pixelQuestOpening.skip()` also works for
dev). Switching visualizer modes cancels it cleanly.

## Kiosk / Raspberry Pi (e.g. 1920×480 LED wall)

The controls and cursor auto-hide after 4 seconds idle, and two URL params make
unattended boot possible:

- `?mode=galaxy` — start in a given mode
- `?input=mic` — grab the microphone on load (no click needed)
- `?sens=1.6` — PIN a manual sensitivity and disable AutoGain. Sensitivity is
  otherwise fully automatic: AutoGain (src/autogain.js) listens to the music
  and re-tunes each mode per song, learning per-mode baselines that persist
  across reboots

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

## Physical controls (EC11 rotary encoder)

One knob runs the whole device: **rotate** = previous / next visualization
(the full lineup, wrapping across categories), **press** = favorite it.

Wiring — bare EC11, common pin to GND so the Pi's internal pull-ups do the
work (no `+` wire, no resistors):

| EC11 | Pi (BCM) | header pin |
|---|---|---|
| CLK (A) | GPIO17 | 11 |
| DT (B) | GPIO27 | 13 |
| SW | GPIO22 | 15 |
| GND / C | GND | 9 |

```bash
sudo bash deploy/encoder-setup.sh     # installs deps, group, unit; starts it
journalctl -u vizzy-encoder -f        # watch the knob live
```

Pins and behavior are env in `/opt/vizzy/state/vizzy.env` (`VIZZY_ENCODER_CLK`
/ `_DT` / `_SW` / `_DIVIDER` / `_PULLUP` / `_REVERSE`); edit and
`sudo systemctl restart vizzy-encoder`. **If one click jumps several
visualizations, set `VIZZY_ENCODER_DIVIDER=2` (or `4`)** — EC11s differ in how
many quadrature pulses they emit per detent. If it turns the wrong way, set
`VIZZY_ENCODER_REVERSE=true`.

### Encoder not working? Diagnose it bottom-up

The chain is GPIO → daemon → server → browser, so find out *where* it stops:

```bash
sudo systemctl stop vizzy-encoder                        # release the pins

# 1. Is the encoder sending ANYTHING, and on WHICH pins?
sudo python3 deploy/encoder-diagnose.py --scan
#    Watches every GPIO. Turn the knob + press the button; it names the pins
#    that moved and prints the exact vizzy.env lines to paste.

# 2. Do the CONFIGURED pins decode into clean rotation?
sudo python3 deploy/encoder-diagnose.py
#    Turn ONE detent and count the lines = your VIZZY_ENCODER_DIVIDER.

sudo systemctl start vizzy-encoder
journalctl -u vizzy-encoder -f                          # 3. daemon → server
```

For the last hop (server → browser), open the app with **`?hwdebug=1`**: an
on-screen panel shows the relay's connection state and logs every event as it
lands — so you can stand at the device, turn the knob, and see it (or see
`connected ✓` with no events, which means the problem is upstream of the
browser).

How it fits together: `deploy/vizzy-encoder.py` (gpiozero) POSTs an action to
`/api/input` (loopback only, allowlisted actions), `scripts/serve.mjs` fans it
out over Server-Sent Events, and `src/hardware.js` dispatches it into the same
controller methods the keyboard and debug panel use. No extra port, no extra
dependency on either end, and `EventSource` reconnects itself if the app or the
daemon restarts. Adding a second encoder or a switch only needs the daemon to
name another action — `category:next`/`prev`, `preset:cycle`, `lock:toggle`,
`controls:toggle`, `mic:toggle` are all already wired.

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
`1.9.0`). Failed versions are moved aside as `failed-<version>-<time>/`
(quarantine — pruned to the newest 3) and recorded in a **bad-version list**
so the same release is never re-staged until an admin clears it or a newer
version ships.

### Release lifecycle

```
published on GitHub → downloaded → sha256-verified → extracted → validated
  → SMOKE-TESTED (booted on a localhost side port, /health must answer)
  → pending (next/)
  → activated at the next boot (apply, once per OS boot)
  → first-boot verified (/health within timeout)
  → last known good (previous good kept in backup/)

failure at any point before "pending"      → work/ discarded, current untouched
activated but unhealthy / crash-looping    → automatic rollback to backup/
                                             + version quarantined (badVersions)
power loss mid-apply                       → next boot detects and recovers
```

Activation is **once per OS boot** by construction: `vizzy-apply-update.service`
is a oneshot with `RemainAfterExit=yes` ordered before the app — restarting
`vizzy.service` (or a crash-restart) during the same boot does **not** re-run
it, so a pending release only ever activates on a full reboot.

### Version identity on the splash

The loading splash shows the running release in its corner —
`v1.0.1 · cec9f2e · 2026-07-16` (semver · git commit · build date), stamped
into the HTML at build time by `vite.config.js`. That's how you verify an
update landed: the line changes. **Every push to main must bump
`version.json`** (`bun run version:bump`, or `minor`/`major`) — enforced by
the `deploy/git-hooks/pre-push` hook (install once:
`cp deploy/git-hooks/pre-push .git/hooks/ && chmod +x .git/hooks/pre-push`;
bypass in an emergency with `VIZZY_SKIP_VERSION_CHECK=1 git push`).

### Publishing a release (GitHub)

Releases are **prebuilt in CI** — the Pi never builds, lints or runs npm; it
downloads a finished artifact, verifies its checksum, smoke-tests it, and
serves it. `.github/workflows/release.yml` runs on version tags:

```bash
# 1. bump the version
$EDITOR version.json                    # e.g. "1.0.1"
git commit -am "v1.0.1"
# 2. tag + push — CI builds, tests, packages, publishes the GitHub Release
git tag v1.0.1 && git push && git push --tags
```

The workflow refuses a tag that doesn't match `version.json`, runs the updater
test suite as a release gate, then uploads `vizzy-<v>.zip` + `manifest.json`
(with sha256) as release assets. Devices poll
`https://github.com/<repo>/releases/latest/download/manifest.json` — GitHub's
`latest` only ever points at a **published, non-draft, non-prerelease**
release, and release assets are immutable, which is the eligibility contract.
(Drafts and prereleases are therefore ignored by construction.)

For a private repo, set a token in `vizzy.env` and add an
`Authorization: Bearer` header in `scripts/updater/lib.mjs` `fetchManifest`/
`download` — the env file is root-owned and never logged.

### Configuration (env, read from `/opt/vizzy/state/vizzy.env`)

| Variable | Default | Purpose |
|---|---|---|
| `VIZZY_ROOT` | `/opt/vizzy` | Root of the layout above |
| `VIZZY_APP_PORT` | `3000` | Port the app server listens on |
| `VIZZY_HEALTH_URL` | `http://localhost:3000/health` | Smoke-test endpoint |
| `VIZZY_UPDATE_MANIFEST_URL` | GitHub `latest` manifest | Update source; blank = auto-update disabled (app unaffected) |
| `VIZZY_AUTO_UPDATE` | `true` | Set `false` to disable background checks |
| `VIZZY_STAGE_PORT` | `3777` | Localhost-only port for the staged smoke test |
| `VIZZY_STAGE_SMOKE_TIMEOUT_MS` | `25000` | How long a staged release has to become healthy |
| `VIZZY_MIN_FREE_MB` | `300` | Refuse to download/stage below this much free disk |
| `VIZZY_HEALTH_TIMEOUT_MS` | `40000` | First-boot verification window before rollback |

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
bun run update:cancel  # remove a pending (staged) update
bun run update:clear-bad <v>  # readmit a quarantined version
bun run test:updater   # the end-to-end updater suite (also the CI release gate)
```

### Admin CLI (installed to /usr/local/bin by install.sh)

```bash
sudo vizzy-update status           # active / previous / pending / quarantined
sudo vizzy-update check            # check GitHub + stage a newer release now
sudo vizzy-update cancel-pending   # drop the staged update
sudo vizzy-update rollback         # back to the previous good release + restart
sudo vizzy-update clear-bad 1.2.3  # readmit a quarantined version
sudo vizzy-update logs             # updater log + recent service journals
```

**Recovery if both new and previous fail:** the crash-loop backstop keeps
rolling back to `backup/`; if that is also broken, reinstall from the repo —
`cd ~/vizzy && git pull && sudo bash deploy/install.sh` rebuilds `current/`
from source without touching `state/`. **Disable updates without touching the
app:** set `VIZZY_AUTO_UPDATE=false` in `vizzy.env`.

### systemd units (samples in `deploy/systemd/`, installed by `deploy/install.sh`)

- `vizzy.service` — runs the app from `current/`, restarts on failure, smoke-tests
  via `ExecStartPost`, and rolls back on repeated failure (`OnFailure`).
- `vizzy-apply-update.service` — oneshot, ordered **before** the app: applies a
  staged update or recovers a failed one.
- `vizzy-update-check.service` + `.timer` — background check ~2 min after boot and
  every 6 h; exits cleanly when offline.
- `vizzy-maintenance-reboot.service` + `.timer` — the headless activation
  window: ~4:30am (jittered), reboots ONLY if a validated update is pending
  (`next/` exists), so staged updates activate on their own with zero human
  interaction. No update = no reboot. Park it: `sudo touch
  /opt/vizzy/state/hold-updates` (remove the file to resume).
- `vizzy-rollback.service` — automatic rollback backstop for crash-loops.

**Fully hands-off loop:** publish a release → within ~6h a device stages it
(download, sha256, smoke test) while the app keeps running → at ~4:30am it
reboots once, activates, health-checks, and rolls back automatically if the
release is bad. **No wifi = no change:** checks skip cleanly offline, the app
starts instantly without the network (no network dependency in
vizzy.service), and the current version keeps running until connectivity
returns.

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
