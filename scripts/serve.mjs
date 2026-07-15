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
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, join, normalize, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".."); // scripts/ -> app root
const DIST = process.env.VIZZY_DIST || join(APP_ROOT, "dist");
const PORT = Number(process.env.VIZZY_APP_PORT || 3000);
const HOST = process.env.VIZZY_APP_HOST || "0.0.0.0";

// Last-visualization persistence lives on the SERVER, not the browser: a kiosk
// Chromium gets killed on reboot and often loses localStorage, so the appliance
// would forget the chosen mode. This state dir survives reboots AND app updates.
const STATE_DIR = process.env.VIZZY_ROOT ? join(process.env.VIZZY_ROOT, "state") : join(APP_ROOT, ".state");
const MODE_FILE = join(STATE_DIR, "last-mode");
const cleanMode = (m) => String(m || "").trim().slice(0, 64).replace(/[^a-z0-9_-]/gi, "");
function readLastMode() { try { return cleanMode(readFileSync(MODE_FILE, "utf8")); } catch { return ""; } }
function writeLastMode(m) { try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(MODE_FILE, cleanMode(m)); return true; } catch { return false; } }

// Pixel Quest JOURNEY persistence (engagement plan 3.2): waypoint progress,
// songs completed, and the world-wake meter survive kiosk reboots the same way
// the last mode does. Numbers only — sanitized on write.
const JOURNEY_FILE = join(STATE_DIR, "journey.json");
const cleanJourney = (j) => ({
  waypoint: Math.max(0, Math.min(999, Math.round(Number(j?.waypoint) || 0))),
  songs: Math.max(0, Math.min(99999, Math.round(Number(j?.songs) || 0))),
  wake: Math.max(0, Math.min(1, Number(j?.wake) || 0)),
});
function readJourney() { try { return cleanJourney(JSON.parse(readFileSync(JOURNEY_FILE, "utf8"))); } catch { return cleanJourney({}); } }
function writeJourney(j) { try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(JOURNEY_FILE, JSON.stringify(cleanJourney(j))); return true; } catch { return false; } }

// AutoGain learned baselines (src/autogain.js): per-mode converged sensitivity,
// so a kiosk reboot starts at yesterday's values. { modeId: number } — sanitized.
const AUTOGAIN_FILE = join(STATE_DIR, "autogain.json");
const cleanAutogain = (j) => {
  const out = {};
  if (j && typeof j === "object") {
    for (const [k, v] of Object.entries(j)) {
      if (Object.keys(out).length >= 40) break;
      const key = cleanMode(k);
      const num = Number(v);
      if (key && Number.isFinite(num) && num >= 0.4 && num <= 3) out[key] = Math.round(num * 100) / 100;
    }
  }
  return out;
};
function readAutogain() { try { return cleanAutogain(JSON.parse(readFileSync(AUTOGAIN_FILE, "utf8"))); } catch { return {}; } }
function writeAutogain(j) { try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(AUTOGAIN_FILE, JSON.stringify(cleanAutogain(j))); return true; } catch { return false; } }

// PHYSICAL CONTROLS relay (deploy/vizzy-encoder.py): the GPIO daemon POSTs an
// action here and we fan it out to the browser over Server-Sent Events. SSE
// (not a WebSocket) keeps this dependency-free on both ends — node's http +
// the browser's EventSource, which also auto-reconnects — and needs no extra
// port. Only loopback may POST: this is an input injection endpoint.
const inputClients = new Set();
const INPUT_ACTIONS = new Set([
  "mode:next", "mode:prev", "mode:set", "category:next", "category:prev",
  "favorite:toggle", "preset:cycle", "lock:toggle", "controls:toggle", "mic:toggle",
]);
const isLoopback = (req) => /^(::1|::ffff:127\.|127\.)/.test(req.socket.remoteAddress || "");
function broadcastInput(action, arg) {
  const line = `data: ${JSON.stringify(arg === undefined ? { action } : { action, arg })}\n\n`;
  for (const c of inputClients) {
    try { c.write(line); } catch { inputClients.delete(c); }
  }
  return inputClients.size;
}

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

// Serve index.html with the saved mode injected, so the app restores the last
// visualization on the very first frame (no galaxy-flash, no client fetch).
function sendIndex(res) {
  let html;
  try { html = readFileSync(join(DIST, "index.html"), "utf8"); }
  catch { res.writeHead(404); return res.end("not found"); }
  const inject = `<script>window.__vizzyLastMode=${JSON.stringify(readLastMode())};</script>`;
  html = html.includes("</head>") ? html.replace("</head>", `  ${inject}\n</head>`) : inject + html;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
}

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

  // last-visualization state (read on boot, written on every mode change)
  if (pathname === "/api/last-mode") {
    res.setHeader("access-control-allow-origin", "*"); // harmless; allows a file:// splash to read it too
    res.setHeader("cache-control", "no-store");
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 256) req.destroy(); });
      req.on("end", () => { const mode = cleanMode(body); writeLastMode(mode); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ mode })); });
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ mode: readLastMode() }));
  }

  // physical-control event stream the browser subscribes to (EventSource)
  if (pathname === "/api/input/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 2000\n\n");
    inputClients.add(res);
    // keep-alive comment so idle proxies/NICs don't drop the stream
    const ka = setInterval(() => { try { res.write(": ka\n\n"); } catch {} }, 20000);
    const drop = () => { clearInterval(ka); inputClients.delete(res); };
    req.on("close", drop);
    req.on("error", drop);
    return;
  }

  // the GPIO daemon posts encoder actions here (loopback only)
  if (pathname === "/api/input" && req.method === "POST") {
    if (!isLoopback(req)) { res.writeHead(403); return res.end("forbidden"); }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 256) req.destroy(); });
    req.on("end", () => {
      let msg = null;
      try { msg = JSON.parse(body); } catch {}
      const action = INPUT_ACTIONS.has(msg?.action) ? msg.action : null;
      const arg = typeof msg?.arg === "string" ? cleanMode(msg.arg) : undefined;
      const clients = action ? broadcastInput(action, arg) : inputClients.size;
      res.writeHead(action ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: !!action, action, clients }));
    });
    return;
  }

  // AutoGain baselines (read on boot, written when a listen window locks)
  if (pathname === "/api/autogain") {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", "no-store");
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on("end", () => {
        let j = null;
        try { j = JSON.parse(body); } catch {}
        if (j && typeof j === "object") writeAutogain(j); // bad input never clobbers good state
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(readAutogain()));
      });
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(readAutogain()));
  }

  // Pixel Quest journey state (read on boot, written on song/waypoint changes)
  if (pathname === "/api/journey") {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", "no-store");
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 512) req.destroy(); });
      req.on("end", () => {
        let j = null;
        try { j = JSON.parse(body); } catch {}
        if (j && typeof j === "object") writeJourney(j); // bad input never clobbers good state
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(readJourney()));
      });
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(readJourney()));
  }

  if (pathname === "/" || pathname === "/index.html") return sendIndex(res); // inject saved mode
  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = normalize(join(DIST, pathname));
  if (!filePath.startsWith(DIST)) { res.writeHead(403); return res.end("forbidden"); } // no path traversal

  if (!existsSync(filePath) || !statSync(filePath).isFile()) return sendIndex(res); // SPA fallback (also injects mode)

  res.writeHead(200, { "content-type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
});

server.on("error", (e) => { console.error(`[vizzy] server error: ${e.message}`); process.exit(1); });
server.listen(PORT, HOST, () => {
  console.log(`[vizzy] v${appVersion()} serving ${DIST} at http://${HOST}:${PORT}  (health: /health)`);
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
