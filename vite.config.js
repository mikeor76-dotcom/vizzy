// Vizzy build config. One job beyond defaults: stamp the RELEASE IDENTITY
// into index.html at build time — semver from version.json plus the git
// commit — so the loading splash shows exactly which build is running the
// moment it paints (before any JS). This is how you verify, standing at the
// device, that an update actually landed: the version line changes.
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function releaseLabel() {
  let version = "0.0.0";
  try { version = JSON.parse(readFileSync("./version.json", "utf8")).version; } catch { /* keep fallback */ }
  let sha = "";
  try { sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { /* building from a release zip (no .git): semver alone identifies it */ }
  const date = new Date().toISOString().slice(0, 10);
  return `v${version}${sha ? " · " + sha : ""} · ${date}`;
}

// Dev-server recognition routes: the same /api endpoints serve.mjs exposes on
// the appliance, backed by the same committed bundle (scripts/recognizer.
// bundle.mjs — `bun run build:recognizer` after editing recognition/). Plus a
// dev-only /api/mock-nowplaying fixture so the Now Playing mode and overlays
// can be exercised without music playing.
function recognitionDevRoutes() {
  let recognizerPromise = null;
  const recognizer = () => {
    if (!recognizerPromise) {
      recognizerPromise = import(
        new URL("./scripts/recognizer.bundle.mjs", import.meta.url).href
      ).catch((e) => { recognizerPromise = null; throw e; });
    }
    return recognizerPromise;
  };
  let npOverlayOn = true; // dev state is in-memory; the appliance persists it

  const json = (res, code, obj) => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(obj));
  };

  return {
    name: "vizzy-recognition-dev",
    configureServer(server) {
      server.middlewares.use("/api/identify", (req, res) => {
        const params = new URL(req.url, "http://localhost").searchParams;
        const sampleRate = Number(params.get("sampleRate")) || 16000;
        const capturedAtMs = Number(params.get("capturedAtMs")) || Date.now();
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", async () => {
          try {
            const { identifyAndEnrich } = await recognizer();
            const buf = Buffer.concat(chunks);
            if (buf.length < 32000) return json(res, 400, { error: "clip too short" });
            const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
            json(res, 200, await identifyAndEnrich(pcm, sampleRate, capturedAtMs));
          } catch (e) {
            json(res, 503, { error: String(e.message || e) });
          }
        });
      });
      server.middlewares.use("/api/art", async (req, res) => {
        try {
          const { isAllowedArtUrl } = await recognizer();
          const u = new URL(req.url, "http://localhost").searchParams.get("u") || "";
          if (!isAllowedArtUrl(u)) return json(res, 400, { error: "bad art url" });
          const upstream = await fetch(u);
          if (!upstream.ok) return json(res, 502, { error: "art fetch failed" });
          res.statusCode = 200;
          res.setHeader("content-type", upstream.headers.get("content-type") || "image/jpeg");
          res.setHeader("cache-control", "public, max-age=86400");
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (e) {
          json(res, 503, { error: String(e.message || e) });
        }
      });
      server.middlewares.use("/api/np-overlay", (req, res) => {
        if (req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => { npOverlayOn = body.trim() !== "off"; json(res, 200, { on: npOverlayOn }); });
          return;
        }
        json(res, 200, { on: npOverlayOn });
      });
      server.middlewares.use("/api/mock-nowplaying", async (req, res) => {
        try {
          const { mockNowPlaying } = await recognizer();
          json(res, 200, await mockNowPlaying());
        } catch (e) {
          json(res, 503, { error: String(e.message || e) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    {
      name: "vizzy-version-stamp",
      transformIndexHtml(html) {
        return html.replaceAll("__VIZZY_VERSION_LABEL__", releaseLabel());
      },
    },
    recognitionDevRoutes(),
  ],
});
