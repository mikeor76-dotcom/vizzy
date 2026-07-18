// Unofficial Shazam adapter (node-shazam). Server-side only — the endpoint
// requires request signing and has no CORS. ToS-gray: fine for personal use,
// swap for a licensed adapter before any commercial distribution (see the
// licensing notes in recognition/README.md).
//
// Only fullRecognizeSong(samples) is ever called: the library's file-loading
// path needs ffmpeg + a native module, and the recognizer bundle stubs those
// out (scripts/build-recognizer.mjs). Never call recognise()/fromFilePath().

import { Shazam } from 'node-shazam';
import type { IdentifyClip, SongIdProvider, TrackMatch } from './types.ts';
import { resampleInt16 } from './resample.ts';

const SHAZAM_RATE = 16000;

interface ShazamSectionMetadata {
  title?: string;
  text?: string;
}

interface ShazamSectionLike {
  type?: string;
  metadata?: ShazamSectionMetadata[];
  text?: string[];
}

export class ShazamProvider implements SongIdProvider {
  readonly name = 'shazam';
  private shazam = new Shazam();

  async identify(clip: IdentifyClip): Promise<TrackMatch | null> {
    const pcm = resampleInt16(clip.samples, clip.sampleRate, SHAZAM_RATE);
    const result = await this.shazam.fullRecognizeSong(Array.from(pcm));
    if (!result || !result.track) return null;

    const track = result.track;
    const sections = (track.sections ?? []) as ShazamSectionLike[];
    const metadata = sections.find((s) => Array.isArray(s.metadata))?.metadata ?? [];
    const meta = (label: string) =>
      metadata.find((m) => m.title?.toLowerCase() === label)?.text;

    // Shazam embeds Musixmatch lyric text for many tracks — free fallback
    // when LRCLIB has no entry (unsynced, so no karaoke timing).
    const lyricSection = sections.find(
      (s) => s.type?.toUpperCase() === 'LYRICS' && Array.isArray(s.text) && s.text.length > 0,
    );

    const artworkUrls = [track.images?.coverarthq, track.images?.coverart, track.images?.background]
      .filter((u): u is string => typeof u === 'string' && u.length > 0);

    return {
      provider: this.name,
      providerTrackId: track.key,
      title: track.title,
      artist: track.subtitle,
      album: meta('album'),
      releaseYear: meta('released'),
      isrc: track.isrc,
      matchOffsetSec: result.matches?.[0]?.offset,
      artworkUrls: [...new Set(artworkUrls)],
      embeddedLyrics: lyricSection?.text,
      raw: result,
    };
  }
}
