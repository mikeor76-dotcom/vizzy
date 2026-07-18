import type { LyricsProvider, LyricsQuery, LyricsResult } from './types.ts';
import { parseLrc } from './lrc.ts';

// LRCLIB (lrclib.net): free, keyless, synced lyrics. Community-transcribed —
// fine for personal use; a commercial product swaps this for a licensed
// LyricsProvider. Server-side use only: LRCLIB asks clients to send an
// identifying User-Agent, which browsers cannot set.
//
// Reliability reality (measured 2026-07-17): the service can 503 or hang for
// minutes at a time. The caller enforces the deadline; this module retries a
// 503 once quickly, then gives up — the per-track cache upstream means a bad
// moment is retried on the NEXT identify, not lost forever.

const BASE = 'https://lrclib.net/api';

interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export interface LrclibOptions {
  /** Sent as User-Agent, e.g. "MyApp/1.0 (https://example.com)". */
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

/** Strip title decorations that break matching: (feat. X), (Remastered 2011),
 * "- Single Version", trailing bracket qualifiers. Conservative on purpose. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/\s*[([](feat\.?|ft\.?|with|remaster(ed)?|mono|stereo|single|album|radio|live|bonus|deluxe|explicit)[^)\]]*[)\]]/gi, '')
    .replace(/\s*-\s*(feat\.?|ft\.?|remaster(ed)?|single version|radio edit|live|mono|stereo)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export class LrclibProvider implements LyricsProvider {
  readonly name = 'lrclib';
  private userAgent: string;
  private fetchImpl: typeof fetch;

  constructor(options: LrclibOptions = {}) {
    this.userAgent = options.userAgent ?? 'Vizzy/1.0 (personal audio visualizer)';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getLyrics(query: LyricsQuery): Promise<LyricsResult | null> {
    const cleanTitle = normalizeTitle(query.title) || query.title;
    const record =
      (query.durationSec ? await this.getExact({ ...query, title: cleanTitle }) : null) ??
      (await this.search({ ...query, title: cleanTitle }));
    if (!record) return null;

    const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : undefined;
    return {
      source: this.name,
      synced: synced?.length ? synced : undefined,
      plain: record.plainLyrics ?? undefined,
      trackDurationSec: record.duration,
      instrumental: record.instrumental ?? false,
    };
  }

  /** /api/get — exact match, requires duration within ±2s. */
  private async getExact(query: LyricsQuery): Promise<LrclibRecord | null> {
    const params = new URLSearchParams({
      artist_name: query.artist,
      track_name: query.title,
      duration: String(Math.round(query.durationSec!)),
    });
    if (query.album) params.set('album_name', query.album);
    const res = await this.request(`${BASE}/get?${params}`);
    if (!res) return null;
    return (await res.json()) as LrclibRecord;
  }

  /** /api/search — fuzzy; prefer synced hits, then duration proximity. */
  private async search(query: LyricsQuery): Promise<LrclibRecord | null> {
    const params = new URLSearchParams({
      artist_name: query.artist,
      track_name: query.title,
    });
    const res = await this.request(`${BASE}/search?${params}`);
    if (!res) return null;
    const hits = (await res.json()) as LrclibRecord[];
    if (!Array.isArray(hits) || !hits.length) return null;

    const scored = hits
      .map((h) => {
        let score = 0;
        if (h.syncedLyrics) score += 10;
        else if (h.plainLyrics) score += 3;
        if (query.durationSec && h.duration) {
          const drift = Math.abs(h.duration - query.durationSec);
          score += drift <= 2 ? 5 : drift <= 10 ? 1 : -5;
        }
        return { h, score };
      })
      .sort((a, b) => b.score - a.score);
    return scored[0].score > 0 ? scored[0].h : null;
  }

  private async request(url: string, attempt = 0): Promise<Response | null> {
    const res = await this.fetchImpl(url, { headers: { 'User-Agent': this.userAgent } });
    if (res.status === 404) return null;
    if (res.status === 503 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 700));
      return this.request(url, 1);
    }
    if (!res.ok) throw new Error(`lrclib ${res.status} for ${url}`);
    return res;
  }
}
