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

export default defineConfig({
  plugins: [
    {
      name: "vizzy-version-stamp",
      transformIndexHtml(html) {
        return html.replaceAll("__VIZZY_VERSION_LABEL__", releaseLabel());
      },
    },
  ],
});
