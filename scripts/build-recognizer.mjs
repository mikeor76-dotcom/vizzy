#!/usr/bin/env bun
// Builds recognition/service.ts + node-shazam into ONE dependency-free ESM
// file: scripts/recognizer.bundle.mjs. The appliance rule is "no node_modules
// at runtime" — serve.mjs lazy-imports the committed bundle.
//
// node-shazam eagerly imports three things we never call into:
//   - to_pcm.js → fluent-ffmpeg + @ffmpeg-installer  (file conversion)
//   - shazamio-core                                   (native fast path)
//   - node-fetch                                      (node<18 shim)
// All are stubbed here; only fullRecognizeSong's pure-JS signature path and
// global fetch remain. Run after changing anything in recognition/:
//   bun run build:recognizer

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renameSync, existsSync, statSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const STUBS = {
  'node-fetch': `
    const f = (...args) => globalThis.fetch(...args);
    export default f;
    export const Headers = globalThis.Headers;
    export const Request = globalThis.Request;
    export const Response = globalThis.Response;`,
  'shazamio-core': `
    export function recognizeBytes() { throw new Error('shazamio-core is stubbed out — use fullRecognizeSong(samples)'); }
    export default {};`,
  'fluent-ffmpeg': `
    export default function () { throw new Error('ffmpeg is stubbed out — feed PCM, not files'); }`,
  '@ffmpeg-installer/ffmpeg': `export default { path: '' };`,
  to_pcm: `
    export async function convertfile() { throw new Error('file conversion stubbed out — feed PCM'); }
    export async function tomp3() { throw new Error('file conversion stubbed out — feed PCM'); }`,
};

const result = await Bun.build({
  entrypoints: [resolve(ROOT, 'recognition/service.ts')],
  outdir: resolve(ROOT, 'scripts'),
  naming: 'recognizer.bundle.mjs',
  target: 'node',
  format: 'esm',
  minify: false,
  plugins: [
    {
      name: 'stub-heavy-deps',
      setup(build) {
        build.onResolve({ filter: /^(node-fetch|shazamio-core|fluent-ffmpeg|@ffmpeg-installer\/ffmpeg)$/ }, (args) => ({
          path: args.path,
          namespace: 'stub',
        }));
        build.onResolve({ filter: /to_pcm(\.js)?$/ }, () => ({ path: 'to_pcm', namespace: 'stub' }));
        build.onLoad({ namespace: 'stub', filter: /.*/ }, (args) => ({
          contents: STUBS[args.path] ?? 'export default {};',
          loader: 'js',
        }));
      },
    },
  ],
});

if (!result.success) {
  console.error('bundle FAILED:');
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const out = resolve(ROOT, 'scripts/recognizer.bundle.mjs');
if (!existsSync(out)) {
  // Bun.build naming may emit service.mjs depending on version — normalize.
  const alt = resolve(ROOT, 'scripts/service.mjs');
  if (existsSync(alt)) renameSync(alt, out);
}
console.log(`built ${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
