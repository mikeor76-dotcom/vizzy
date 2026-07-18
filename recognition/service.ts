// Recognition service — the compose layer both servers share (scripts/serve.mjs
// on the appliance, the Vite dev middleware on the Mac). Bundled to a single
// dependency-free file by scripts/build-recognizer.mjs so the appliance keeps
// its "no node_modules at runtime" rule.
//
// PROVIDER SWAP POINT: the two constructors below are the only place concrete
// providers exist. A licensed future = new adapters here, nothing else moves.

import { ShazamProvider } from './song-id/shazam.ts';
import type { IdentifyClip, TrackMatch } from './song-id/types.ts';
import { resolveArtwork, type ArtworkResult } from './artwork/index.ts';
import { LrclibProvider } from './lyrics/lrclib.ts';
import type { LyricsResult } from './lyrics/types.ts';

const USER_AGENT = 'Vizzy/1.0 (personal audio visualizer appliance)';

const songId = new ShazamProvider();
const lyricsProvider = new LrclibProvider({ userAgent: USER_AGENT });

export interface NowPlayingResponse {
  match: Omit<TrackMatch, 'raw' | 'embeddedLyrics'> | null;
  artwork: ArtworkResult | null;
  lyrics: LyricsResult | null;
  timingMs: { identify: number; enrich: number };
  cached?: boolean;
}

// A slow source must never stall the match render (LRCLIB measured hanging
// 12s+ when overloaded). Deadlines are per-source; losers resolve null and
// the per-track cache lets the NEXT identify retry them.
const ART_DEADLINE_MS = 4000;
const LYRICS_DEADLINE_MS = 6000;
const deadline = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

// Per-track enrichment cache: repeat identifies of the same song (the resync
// loop runs every ~25s) must not re-hit external services. Null lyrics are NOT
// cached — a flaky LRCLIB moment gets retried next round.
interface CacheEntry {
  artwork: ArtworkResult | null;
  lyrics: LyricsResult | null;
}
const enrichCache = new Map<string, CacheEntry>();
const CACHE_MAX = 40;

async function enrich(match: TrackMatch): Promise<CacheEntry & { fromCache: boolean }> {
  const key = match.providerTrackId ?? `${match.artist}::${match.title}`;
  const hit = enrichCache.get(key);
  if (hit && hit.artwork && hit.lyrics) return { ...hit, fromCache: true };

  const [artwork, lyrics] = await Promise.all([
    hit?.artwork
      ? Promise.resolve(hit.artwork)
      : deadline(
          resolveArtwork(
            {
              artist: match.artist,
              title: match.title,
              album: match.album,
              preferredUrls: match.artworkUrls,
            },
            { userAgent: USER_AGENT },
          ),
          ART_DEADLINE_MS,
        ).catch(() => null),
    hit?.lyrics
      ? Promise.resolve(hit.lyrics)
      : deadline(
          lyricsProvider.getLyrics({ artist: match.artist, title: match.title, album: match.album }),
          LYRICS_DEADLINE_MS,
        ).catch(() => null),
  ]);

  // Shazam's own embedded Musixmatch text: the unsynced fallback.
  const finalLyrics =
    lyrics ??
    (match.embeddedLyrics?.length
      ? ({ source: 'shazam', plain: match.embeddedLyrics.join('\n') } as LyricsResult)
      : null);

  enrichCache.set(key, { artwork, lyrics: finalLyrics });
  if (enrichCache.size > CACHE_MAX) {
    const oldest = enrichCache.keys().next().value;
    if (oldest !== undefined) enrichCache.delete(oldest);
  }
  return { artwork, lyrics: finalLyrics, fromCache: false };
}

/**
 * The whole pipeline: PCM in, now-playing data out.
 * `pcm` is s16le mono; `sampleRate` its rate (resampled to 16k internally).
 */
export async function identifyAndEnrich(
  pcm: ArrayBuffer | Int16Array,
  sampleRate: number,
  capturedAtMs: number = Date.now(),
): Promise<NowPlayingResponse> {
  const samples = pcm instanceof Int16Array ? pcm : new Int16Array(pcm);
  const clip: IdentifyClip = { samples, sampleRate, capturedAtMs };

  const t0 = Date.now();
  const match = await songId.identify(clip);
  const identifyMs = Date.now() - t0;

  if (!match) {
    return { match: null, artwork: null, lyrics: null, timingMs: { identify: identifyMs, enrich: 0 } };
  }

  const t1 = Date.now();
  const { artwork, lyrics, fromCache } = await enrich(match);
  const { raw, embeddedLyrics, ...cleanMatch } = match;

  return {
    match: cleanMatch,
    artwork,
    lyrics,
    timingMs: { identify: identifyMs, enrich: Date.now() - t1 },
    cached: fromCache,
  };
}

/** Dev fixture: real enrichment for a known track, no audio required. */
export async function mockNowPlaying(): Promise<NowPlayingResponse> {
  const mockMatch: TrackMatch = {
    provider: 'mock',
    providerTrackId: 'mock-bohemian-rhapsody',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    album: 'A Night at the Opera',
    releaseYear: '1975',
    matchOffsetSec: 45,
    artworkUrls: [],
  };
  const t0 = Date.now();
  const { artwork, lyrics } = await enrich(mockMatch);
  const { raw, embeddedLyrics, ...cleanMatch } = mockMatch;
  return {
    match: cleanMatch,
    artwork,
    lyrics,
    timingMs: { identify: 0, enrich: Date.now() - t0 },
  };
}

/** Art-proxy allowlist: only known album-art CDNs may be proxied (the proxy
 * exists so canvas drawImage never taints — same-origin via the server). */
const ART_HOSTS = [
  'mzstatic.com', // Apple/iTunes + Shazam art
  'dzcdn.net', // Deezer
  'coverartarchive.org',
  'archive.org', // CAA redirects here
  'shazam.com',
];
export function isAllowedArtUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    return ART_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}
