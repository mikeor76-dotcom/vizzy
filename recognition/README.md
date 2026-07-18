# Recognition — song ID, album art, lyrics

Ported from the Album Detector test ground (2026-07-17), where every provider
was verified end-to-end including real speaker-to-mic matches.

## How it flows

```
mic (already captured by main.js)
  → src/nowplaying.js       tap + ring buffer + 8s clip @16k s16 + scheduler
  → POST /api/identify      serve.mjs (appliance) / vite middleware (dev)
  → scripts/recognizer.bundle.mjs   ← bundled from recognition/ by
                                       `bun run build:recognizer`
       ShazamProvider  (unofficial, free)        → title/artist/album/art/OFFSET
       resolveArtwork  (iTunes→Deezer→CAA)       → hi-res cover, /api/art proxied
       LrclibProvider  (free synced lyrics)      → karaoke lines
       Shazam-embedded Musixmatch text           → unsynced fallback
  → src/nowplayingmode.js   the Now Playing visualization
  → src/npoverlay.js        song-info overlay on other modes (registry-placed)
```

`matchOffsetSec` + the clip's capture time = playback position — that's what
scrolls lyrics in sync. `LyricsClock` equivalent lives in nowplaying.js
(`positionSec()`); if lyrics consistently lead/lag, bias the offset there.

## Provider swap (the product path)

Concrete providers exist ONLY in `recognition/service.ts` (two constructors).
A licensed future (AudD/ACRCloud for ID, Musixmatch/LyricFind for lyrics) is
one new adapter per interface — `SongIdProvider` in song-id/types.ts,
`LyricsProvider` in lyrics/types.ts — then `bun run build:recognizer`.

Licensing reality (researched 2026-07): cloud recognition is metered
(~$2/1k requests ≈ $2/active-device/month) — product scale means negotiated
embedded licensing or a subscription; lyrics licensing is royalty-bearing with
no buyout. Current stack: unofficial Shazam = breakage risk not legal risk for
personal use; LRCLIB is community content, fine personally, not shippable.

## Rules learned the hard way

- **Never call node-shazam's file APIs** (`recognise`, `fromFilePath`) — they
  need ffmpeg + a native module, both stubbed out of the bundle. PCM only.
- **LRCLIB can 503/hang for minutes** (measured). Deadlines cap every source;
  the per-track cache retries nulls on the next resync; Shazam-embedded text
  is the fallback. Lyrics are a bonus, never a dependency.
- **The overlay is a DOM layer, never canvas paint** — scrolled-bitmap modes
  (waterfall, notefall) would drag overlay pixels into their history, and
  feedback modes (vectorcrt, milkdrop, galaxy) would smear them into trails.
- **Album art goes through /api/art** (allowlisted CDNs) so the mode's
  drawImage stays same-origin and the canvas never taints.

## Appliance notes

- serve.mjs lazy-imports the bundle; if it's missing the app still runs and
  /api/identify answers 503. The bundle is COMMITTED — rebuild + commit after
  touching recognition/.
- Overlay visibility persists server-side (`state/np-overlay`, /api/np-overlay)
  because kiosk Chromium drops localStorage; encoder hold ~0.6s toggles it
  (deploy/vizzy-encoder.py), N key in a browser.
