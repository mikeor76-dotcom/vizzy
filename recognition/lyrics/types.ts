export interface LyricsQuery {
  artist: string;
  title: string;
  album?: string;
  /** Track duration in seconds — LRCLIB matches within ±2s when provided. */
  durationSec?: number;
}

export interface LrcLine {
  timeSec: number;
  text: string;
}

export interface LyricsResult {
  source: string;
  /** Timestamped lines, sorted by time. Present when synced lyrics exist. */
  synced?: LrcLine[];
  /** Plain unsynced lyrics as a fallback. */
  plain?: string;
  /** Duration of the track the lyrics were transcribed against, if known. */
  trackDurationSec?: number;
  instrumental?: boolean;
}

// Same swap-seam pattern as SongIdProvider: a licensed source (Musixmatch,
// LyricFind) becomes one new adapter implementing this.
export interface LyricsProvider {
  readonly name: string;
  getLyrics(query: LyricsQuery): Promise<LyricsResult | null>;
}
