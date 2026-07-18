// Album art resolution with a fallback chain of free, keyless sources.
// Server-side use only (iTunes/Deezer don't send CORS headers, and
// MusicBrainz requires a custom User-Agent).
//
// Chain: provider-supplied URLs (validated) → iTunes → Deezer → Cover Art
// Archive. Displaying cover art alongside identified playback is standard
// practice; the chain lives behind one function in case policy changes.

export interface ArtworkQuery {
  artist: string;
  title: string;
  album?: string;
  /** URLs the song-id provider already supplied — used first if they resolve. */
  preferredUrls?: string[];
}

export interface ArtworkResult {
  url: string;
  source: 'provider' | 'itunes' | 'deezer' | 'coverartarchive';
  album?: string;
}

export interface ArtworkOptions {
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

export async function resolveArtwork(
  query: ArtworkQuery,
  options: ArtworkOptions = {},
): Promise<ArtworkResult | null> {
  const f = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? 'Vizzy/1.0 (personal audio visualizer)';

  for (const url of query.preferredUrls ?? []) {
    if (await urlResolves(f, url)) return { url, source: 'provider', album: query.album };
  }

  const fromItunes = await itunes(f, query).catch(() => null);
  if (fromItunes) return fromItunes;

  const fromDeezer = await deezer(f, query).catch(() => null);
  if (fromDeezer) return fromDeezer;

  return coverArtArchive(f, userAgent, query).catch(() => null);
}

async function urlResolves(f: typeof fetch, url: string): Promise<boolean> {
  try {
    const res = await f(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

async function itunes(f: typeof fetch, q: ArtworkQuery): Promise<ArtworkResult | null> {
  const params = new URLSearchParams({
    term: `${q.artist} ${q.title}`,
    media: 'music',
    entity: 'song',
    limit: '5',
  });
  const res = await f(`https://itunes.apple.com/search?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: { artworkUrl100?: string; collectionName?: string; artistName?: string }[];
  };
  const hits = data.results ?? [];
  const best =
    (q.album &&
      hits.find((h) => h.collectionName?.toLowerCase().includes(q.album!.toLowerCase()))) ||
    hits.find((h) => h.artworkUrl100);
  if (!best?.artworkUrl100) return null;
  return {
    url: best.artworkUrl100.replace('100x100bb', '1000x1000bb'),
    source: 'itunes',
    album: best.collectionName,
  };
}

async function deezer(f: typeof fetch, q: ArtworkQuery): Promise<ArtworkResult | null> {
  const term = `artist:"${q.artist}" track:"${q.title}"`;
  const res = await f(`https://api.deezer.com/search?q=${encodeURIComponent(term)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    data?: { album?: { title?: string; cover_xl?: string } }[];
  };
  const hit = data.data?.find((d) => d.album?.cover_xl);
  if (!hit?.album?.cover_xl) return null;
  return { url: hit.album.cover_xl, source: 'deezer', album: hit.album.title };
}

async function coverArtArchive(
  f: typeof fetch,
  userAgent: string,
  q: ArtworkQuery,
): Promise<ArtworkResult | null> {
  const luceneEscape = (s: string) => s.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
  const query = [
    `recording:"${luceneEscape(q.title)}"`,
    `artist:"${luceneEscape(q.artist)}"`,
    q.album ? `release:"${luceneEscape(q.album)}"` : '',
  ]
    .filter(Boolean)
    .join(' AND ');
  const res = await f(
    `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=3`,
    { headers: { 'User-Agent': userAgent } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    recordings?: { releases?: { id: string; title?: string }[] }[];
  };
  for (const recording of data.recordings ?? []) {
    for (const release of recording.releases ?? []) {
      const url = `https://coverartarchive.org/release/${release.id}/front-1200`;
      if (await urlResolves(f, url)) {
        return { url, source: 'coverartarchive', album: release.title };
      }
    }
  }
  return null;
}
