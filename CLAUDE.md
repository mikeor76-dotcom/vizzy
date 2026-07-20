# Vizzy — working notes for Claude Code

Web audio visualizer for a physical appliance: **Raspberry Pi 5 driving an
8.8" 1920×480 ultrawide panel** (Chromium kiosk, mic/line input, EC11 rotary
encoder for control). Also runs in any browser for dev. Stack: **vanilla JS +
Canvas 2D + Vite, run with bun** (no Node on the dev Mac, no TypeScript in
`src/` — the only TS lives in `recognition/`, which is bundled).

## Commands

- `bun run dev` — Vite dev server (recognition API included via middleware)
- `bun run build` / `bun run start` — build dist / serve it (scripts/serve.mjs)
- `bun run version:bump` — REQUIRED before every push (pre-push hook enforces)
- `bun run build:recognizer` — rebuild `scripts/recognizer.bundle.mjs` after
  touching `recognition/` (the bundle is committed; appliance runs no node_modules)
- `bun run test:updater` — updater test suite; also the release gate

## Hard rules

- **Never use `ctx.shadowBlur`** — kills the Pi. Glow = additive overdraw
  (wide faint pass under a bright thin core).
- **Version-bump before every push**; after every meaningful push, **publish a
  release** or devices never update. Without the `workflow` OAuth scope the
  flow is: `git checkout <pushed-sha> && bash deploy/make-release.sh &&
  git checkout main && gh release create v<ver> release/vizzy-<ver>.zip release/manifest.json`
- **`.github/workflows` needs the `workflow` scope to push** — a local-only
  "CI: publish appliance releases" commit rides at the branch tip; keep it at
  the tip and push `HEAD~1:main` style, or run `gh auth refresh -h github.com -s workflow` once.
- Never commit `how to run updates.rtf` (user's personal notes).
- **Write-once history**: modes that draw scrolled/accumulated history
  (waterfall, notefall, ribbons) may never retro-edit drawn pixels — smooth
  causally at write time, normalize per-sample, no symmetric filters over a
  sliding window, no live-max renormalization.
- Sanity-check visuals at **1920×480** — fine detail that reads on a desktop
  disappears on the 8.8" panel; nothing may clip at the bezel.
- **Song info biases LEFT of the display** (overlay styles + registry
  `nowPlaying` hints) unless there's an articulable reason — e.g. the mode's
  own composition already owns the left. Center only when symmetry demands.
- Benches assert **ground truth** (heat fields, lit fractions, note events),
  not pixels, and must include a compressed-music legibility test.

## Architecture map

- `src/main.js` — audio graph (mic → analyser 2048; lazy 8192 `analyser.hiRes`
  for `needsChroma` modes), render loop (`entry.fade` fill + `entry.render`),
  renderer instances, wiring.
- `src/registry.js` — **single source of truth** for modes: category, presets,
  `auto` (AutoGain profile), `idle`, `needsChroma`, `nowPlaying` (overlay
  placement). UI/keyboard/encoder all read this.
- `src/controller.js` — central state; all inputs call controller methods.
  Inputs: `src/keyboard.js`, `src/hardware.js` (encoder via SSE from serve.mjs;
  daemon `deploy/vizzy-encoder.py`: rotate=mode, press=np:toggle).
- `src/silencegate.js` — use in every self-governing mode; music may only pull
  the noise floor DOWN. `src/chroma.js` — pitch/key/notes (see file comments).
- `scripts/serve.mjs` — dependency-free appliance server: static dist, /health,
  state persistence (last-mode, autogain, journey, np-overlay — server wins
  over localStorage; kiosk Chromium drops localStorage), encoder SSE relay,
  recognition routes. `scripts/updater/` — staged OTA updates + rollback.
- `test/harness/` — synthesized ground-truth songs + frame-exact analyser sim.

## Now Playing / recognition subsystem (added 2026-07-17)

- `recognition/` (TS): song-id (unofficial Shazam via node-shazam — **PCM
  `fullRecognizeSong` only, never its file APIs**), lyrics (LRCLIB synced +
  Shazam-embedded unsynced fallback), artwork (iTunes→Deezer→CAA), service.ts
  (compose + per-track cache + deadlines). Bundled → `scripts/recognizer.bundle.mjs`
  (ffmpeg/native/node-fetch stubbed at build). **Provider swap point for a
  licensed future = the two constructors in service.ts.** See recognition/README.md.
- Routes (serve.mjs + the vite.config.js dev middleware): POST `/api/identify`
  (s16le body), GET `/api/art?u=` (allowlisted CDNs, keeps canvas untainted),
  GET/POST `/api/np-overlay`, dev-only `/api/mock-nowplaying`.
- Browser: `src/nowplaying.js` (mic tap + ring buffer + 25s resync scheduler,
  backoff to 3min; QA: `__np.status()` / `__np.mock()`), `src/nowplayingmode.js`
  (the "nowplaying" Scene — always shows song info), `src/npoverlay.js` (DOM
  overlay over other modes — **never painted into mode canvases**; placement
  from registry `nowPlaying` hints; overlay CSS variants must be
  `#np-overlay.np-style-*`-prefixed for specificity).
- Toggle: N key / encoder hold / `np:toggle`; never affects the nowplaying mode.

## Verification quirks

- The IDE preview pane is `document.hidden`: rAF doesn't fire, getUserMedia
  hangs, smooth scrolling doesn't animate. Verify via temporary hooks +
  synthesized audio (see test/harness), or geometry via getBoundingClientRect.
- Dev mode switch: `localStorage.setItem("vizzy-mode", id)` + reload.
- Console QA hooks: `vizzy.autogain.status()`, `harmony.status()`,
  `milkdrop.status()` (+`?mdebug=1`), `pqAdventure.*`, `__np.*`, `?hwdebug=1`.

## Pi deployment

Mac edit → push + release → on Pi `cd ~/vizzy && git pull && sudo bash
deploy/install.sh` (hands-off OTA also picks releases up overnight). After
changing the encoder daemon: `sudo bash deploy/encoder-setup.sh`. Boot splash:
`deploy/splash-setup.sh` (needs initramfs update — see file).
