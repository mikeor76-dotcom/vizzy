import type { LrcLine } from './types.ts';

// Parses LRC text: `[mm:ss.xx]line`, multiple timestamps per line allowed,
// metadata tags like [ti:], [ar:], [offset:+300] handled ([offset] shifts all
// timestamps; positive means lyrics appear earlier per de-facto convention).
const TIME_TAG = /\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const META_TAG = /^\[([a-zA-Z#]+):(.*)\]$/;

export function parseLrc(text: string): LrcLine[] {
  const lines: LrcLine[] = [];
  let offsetMs = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const meta = line.match(META_TAG);
    if (meta && !/^\d/.test(meta[1])) {
      if (meta[1].toLowerCase() === 'offset') offsetMs = parseInt(meta[2], 10) || 0;
      continue;
    }

    TIME_TAG.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = TIME_TAG.exec(line)) !== null) {
      if (m.index !== lastEnd) break; // timestamps must be a contiguous prefix
      const minutes = parseInt(m[1], 10);
      const seconds = parseFloat(m[2].replace(':', '.'));
      stamps.push(minutes * 60 + seconds);
      lastEnd = TIME_TAG.lastIndex;
    }
    if (stamps.length === 0) continue;

    const textPart = line.slice(lastEnd).trim();
    for (const t of stamps) {
      lines.push({ timeSec: Math.max(0, t - offsetMs / 1000), text: textPart });
    }
  }

  return lines.sort((a, b) => a.timeSec - b.timeSec);
}
