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
