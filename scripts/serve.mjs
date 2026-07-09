#!/usr/bin/env bun
// Vizzy production server — the appliance's `start` command.
//
// Serves the built `dist/` folder and exposes a `/health` endpoint used by the
// updater's smoke test. Deliberately dependency-free (only node builtins) so a
// released app needs NO node_modules at runtime — that keeps releases small and
// makes staging/rollback fast and reliable. Runs under bun or node.
//
// Env:  VIZZY_APP_PORT (3000) · VIZZY_APP_HOST (0.0.0.0) · VIZZY_DIST (./dist)
import http from "node:http";
import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { extname, join, normalize, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".."); // scripts/ -> app root
const DIST = process.env.VIZZY_DIST || join(APP_ROOT, "dist");
const PORT = Number(process.env.VIZZY_APP_PORT || 3000);
const HOST = process.env.VIZZY_APP_HOST || "0.0.0.0";

function appVersion() {
  try {
    return JSON.parse(readFileSync(join(APP_ROOT, "version.json"), "utf8")).version;
  } catch {
    try { return JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")).version; } catch { return "unknown"; }
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".map": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  ".txt": "text/plain; charset=utf-8", ".woff": "font/woff", ".woff2": "font/woff2",
};

const startedAt = Date.now();

const server = http.createServer((req, res) => {
  let pathname = "/";
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { pathname = "/"; }

  if (pathname === "/health" || pathname === "/healthz") {
    const body = JSON.stringify({
      status: "ok", app: "vizzy", version: appVersion(),
      uptimeSec: Math.round((Date.now() - startedAt) / 1000), pid: process.pid,
    });
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(body);
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = normalize(join(DIST, pathname));
  if (!filePath.startsWith(DIST)) { res.writeHead(403); return res.end("forbidden"); } // no path traversal

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    const index = join(DIST, "index.html"); // SPA fallback
    if (existsSync(index)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return createReadStream(index).pipe(res); }
    res.writeHead(404); return res.end("not found");
  }

  res.writeHead(200, { "content-type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
});

server.on("error", (e) => { console.error(`[vizzy] server error: ${e.message}`); process.exit(1); });
server.listen(PORT, HOST, () => {
  console.log(`[vizzy] v${appVersion()} serving ${DIST} at http://${HOST}:${PORT}  (health: /health)`);
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
