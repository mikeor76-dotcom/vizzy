// Local-file path — run the harness against the user's OWN music.
//
// The song bank is synthetic on purpose: committable, deterministic, and it
// declares its own ground truth. But no synthesized arrangement is a real
// master, and some questions ("does this actually feel right to the person
// standing in front of the panel?") are only answerable with real records.
//
// Drop audio into `test/audio/` (gitignored — never commit someone's music)
// and this decodes it to the same mono PCM the song bank produces, so every
// bench and AnalyserSim works unchanged.
//
//   const { pcm, name, duration } = await loadLocal('test/audio/song.mp3');
//   const sim = new AnalyserSim(pcm, { smoothingTimeConstant: 0.55 });
//
// There is no ground truth here — that's the trade. Use it for by-ear tuning
// and for "does it hold up on a real master", not for assertions.

import { SR } from "./songbank.js";

// Decode any browser-supported file (mp3/flac/wav/m4a/ogg) to mono PCM at SR.
export async function loadLocal(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`no audio at ${url} (drop files in test/audio/, it's gitignored)`);
  const raw = await res.arrayBuffer();
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, SR);
  const buf = await ctx.decodeAudioData(raw);
  // downmix to mono at the bank's rate — resample via an offline render so
  // the browser does the interpolation properly
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * SR), SR);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  const pcm = new Float32Array(out.length);
  out.copyFromChannel(pcm, 0);
  return { pcm, name: url.split("/").pop(), duration: out.length / SR, sampleRate: SR };
}

// List what's actually sitting in test/audio/ (Vite serves the dir listing in
// dev; if it 404s, the folder is empty or missing — both are fine).
export async function listLocal(dir = "/test/audio/") {
  try {
    const res = await fetch(dir);
    if (!res.ok) return [];
    const html = await res.text();
    const names = [...html.matchAll(/href="([^"]+\.(?:mp3|flac|wav|m4a|ogg))"/gi)].map((m) => m[1]);
    return [...new Set(names)].map((n) => (n.startsWith("/") ? n : dir + n));
  } catch {
    return [];
  }
}
