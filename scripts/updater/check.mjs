#!/usr/bin/env bun
// update:check — the background update check. Run by the systemd timer.
//
// Offline-safe by contract: if there's no connectivity (or auto-update is off,
// or no manifest URL configured) it logs and exits 0 without touching anything.
// If a newer version exists it downloads + stages it into next/ (applied only on
// the next restart). This process ALWAYS exits 0 so it can never block the app.
import { cfg, log, acquireLock, releaseLock, online, fetchManifest, writeStatus, currentVersion } from "./lib.mjs";
import { stage } from "./stage.mjs";

async function run() {
  if (!cfg.autoUpdate) return log("INFO", "VIZZY_AUTO_UPDATE=false — update check skipped");
  if (!cfg.manifestUrl) return log("INFO", "no VIZZY_UPDATE_MANIFEST_URL configured — update check skipped");

  if (!(await online())) {
    log("INFO", "offline — skipping update check (app is unaffected)");
    writeStatus({ status: "offline_skip", lastCheckAt: new Date().toISOString() });
    return;
  }

  if (!acquireLock()) return log("WARN", "another updater holds the lock — skipping this check");
  try {
    const manifest = await fetchManifest();
    log("INFO", `checked: remote v${manifest.version}, local v${currentVersion()}`);
    writeStatus({ lastCheckAt: new Date().toISOString(), remoteVersion: manifest.version });
    await stage(manifest, { gate: true }); // only stages if strictly newer
  } finally { releaseLock(); }
}

run()
  .catch((e) => { log("ERROR", `update check failed (non-fatal): ${e.message}`); writeStatus({ status: "check_error", error: e.message, lastCheckAt: new Date().toISOString() }); })
  .finally(() => process.exit(0)); // never fail — offline/errors must not block anything
