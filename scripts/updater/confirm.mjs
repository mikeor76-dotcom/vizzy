#!/usr/bin/env bun
// update:confirm — the smoke test. Runs right after the app starts
// (vizzy.service ExecStartPost).
//
//   * If we're not mid-update (status != "applying") it's a normal boot ⇒ no-op.
//   * Otherwise it polls the health endpoint for a while. If the new version is
//     healthy it flips the status to "current"/"successful" and keeps backup/ as
//     the last known good. If it never gets healthy it rolls back to backup/ and
//     exits non-zero — which makes systemd restart the unit, now serving the
//     restored (previous, working) version.
import { cfg, paths, log, readStatus, writeStatus, withTimeout, currentVersion, dirVersion, doRollback } from "./lib.mjs";

async function healthy(url, totalMs = 40000, intervalMs = 1500) {
  const deadline = Date.now() + totalMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const r = await withTimeout(fetch(url, { cache: "no-store" }), 3000, "health");
      if (r.ok) return true;
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  log("WARN", `health check never passed (${last})`);
  return false;
}

async function run() {
  const st = readStatus();
  if (st.status !== "applying") { log("INFO", `confirm: not mid-update (status=${st.status}) — nothing to confirm`); return 0; }

  log("INFO", `confirming health of v${st.applyingVersion} at ${cfg.healthUrl}`);
  if (await healthy(cfg.healthUrl, cfg.healthTimeoutMs)) {
    writeStatus({ status: "current", currentVersion: currentVersion(), successfulVersion: st.applyingVersion, confirmedAt: new Date().toISOString(), failedVersion: undefined });
    log("INFO", `update confirmed healthy: v${currentVersion()}`);
    return 0;
  }

  log("ERROR", `v${st.applyingVersion} failed its health check — rolling back now`);
  doRollback("failed health check after apply", (dirVersion(paths.current)) || st.applyingVersion);
  return 1; // non-zero ⇒ systemd marks start failed ⇒ Restart serves the restored version
}

run().then((c) => process.exit(c || 0)).catch((e) => { log("ERROR", `confirm error: ${e.message}`); process.exit(1); });
