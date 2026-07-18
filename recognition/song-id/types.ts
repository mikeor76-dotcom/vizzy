// Provider-agnostic contracts for song identification. The server route and
// the browser depend ONLY on these shapes — swapping the unofficial Shazam
// provider for a licensed one (AudD, ACRCloud, ...) means writing one new
// adapter that satisfies SongIdProvider. Ported from the Album Detector test
// ground (2026-07-17), where the whole stack was verified end-to-end.

export interface IdentifyClip {
  /** PCM signed 16-bit mono samples. */
  samples: Int16Array;
  /** Sample rate of `samples` in Hz. Adapters resample internally if needed. */
  sampleRate: number;
  /** Wall-clock ms when the clip STARTED recording — needed for lyric sync. */
  capturedAtMs?: number;
}

export interface TrackMatch {
  /** Which adapter produced this match (e.g. "shazam", "audd"). */
  provider: string;
  providerTrackId?: string;
  title: string;
  artist: string;
  album?: string;
  releaseYear?: string;
  isrc?: string;
  /**
   * Seconds into the identified track where the sampled clip aligned.
   * Combined with IdentifyClip.capturedAtMs this gives "where in the song
   * are we right now" — the basis for synced lyrics.
   */
  matchOffsetSec?: number;
  /** Provider-supplied artwork URLs, best quality first. May be empty. */
  artworkUrls: string[];
  /**
   * Unsynced lyric lines embedded in the provider's own response (Shazam
   * ships Musixmatch text for many tracks). Fallback when LRCLIB has nothing.
   */
  embeddedLyrics?: string[];
  /** Untouched provider response, for debugging only. Never depend on it. */
  raw?: unknown;
}

export interface SongIdProvider {
  readonly name: string;
  /** Resolves null on "no match" — errors are thrown, not swallowed. */
  identify(clip: IdentifyClip): Promise<TrackMatch | null>;
}
