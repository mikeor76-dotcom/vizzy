#!/usr/bin/env bun
// update:stage — download, verify, extract, build (if needed) and validate a
// release into `next/`. Never touches the running `current/`. The result is a
// ready-to-apply staged update; it is applied only on the next restart.
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  cfg, paths, log, acquireLock, releaseLock, fetchManifest, download, sha256File,
  extract, installAndBuild, validateApp, writeStatus, moveDir, rmrf,
  isDir, dirVersion, isNewer, currentVersion, cmpVer, UPDATER_VERSION,
  badVersions, requireDiskSpace, smokeTestStaged,
} from "./lib.mjs";

// Stage `manifest`'s release. `gate` = only stage if strictly newer than current.
export async function stage(manifest, { gate = false } = {}) {
  if (!manifest?.version || !manifest?.releaseUrl) throw new Error("manifest missing version/releaseUrl");
  if (manifest.minUpdaterVersion && cmpVer(UPDATER_VERSION, manifest.minUpdaterVersion) === -1)
    throw new Error(`updater ${UPDATER_VERSION} is older than required minUpdaterVersion ${manifest.minUpdaterVersion}`);

  const local = currentVersion();
  if (badVersions().includes(manifest.version)) {
    log("WARN", `skip: v${manifest.version} is quarantined (failed before). Clear with: update:clear-bad ${manifest.version}`);
    writeStatus({ status: "skipped_bad", remoteVersion: manifest.version });
    return { staged: false, reason: "known_bad" };
  }
  if (gate && !isNewer(manifest.version, local)) {
    log("INFO", `up to date: remote v${manifest.version} not newer than local v${local}`);
    writeStatus({ status: "up_to_date", localVersion: local, remoteVersion: manifest.version });
    return { staged: false, reason: "up_to_date" };
  }
  if (isDir(paths.next) && dirVersion(paths.next) === manifest.version) { log("INFO", `v${manifest.version} already staged`); return { staged: true, version: manifest.version, alreadyStaged: true }; }

  requireDiskSpace(); // refuse to fill the Pi's SD card with a doomed download

  writeStatus({ status: "downloading", remoteVersion: manifest.version });
  rmrf(paths.work); mkdirSync(paths.work, { recursive: true });
  const isZip = /\.zip(\?|$)/i.test(manifest.releaseUrl);
  const archive = join(paths.work, isZip ? "release.zip" : "release.tar.gz");
  log("INFO", `downloading ${manifest.releaseUrl}`);
  await download(manifest.releaseUrl, archive);

  if (manifest.sha256) {
    const got = sha256File(archive);
    if (got.toLowerCase() !== String(manifest.sha256).toLowerCase()) {
      rmrf(paths.work);
      writeStatus({ status: "stage_failed", error: "checksum mismatch" });
      throw new Error(`checksum mismatch: expected ${manifest.sha256}, got ${got}`);
    }
    log("INFO", "checksum verified");
  } else {
    log("WARN", "no sha256 in manifest — skipping integrity check");
  }

  const extractDir = join(paths.work, "extract");
  extract(archive, extractDir);
  installAndBuild(extractDir); // no-op for prebuilt releases

  const val = validateApp(extractDir);
  if (!val.ok) {
    rmrf(paths.work);
    writeStatus({ status: "stage_failed", error: val.problems.join("; ") });
    throw new Error(`staged release invalid: ${val.problems.join("; ")}`);
  }
  if (val.version !== manifest.version) {
    rmrf(paths.work);
    writeStatus({ status: "stage_failed", error: `version mismatch: archive says v${val.version}, manifest says v${manifest.version}` });
    throw new Error(`version mismatch: archive v${val.version} != manifest v${manifest.version}`);
  }

  // REAL smoke test: boot the staged release's server on a localhost side port
  // and require /health before it can ever become pending
  try {
    await smokeTestStaged(extractDir);
  } catch (e) {
    rmrf(paths.work);
    writeStatus({ status: "stage_failed", error: `smoke test: ${e.message}` });
    throw new Error(`staged smoke test failed: ${e.message}`);
  }

  moveDir(extractDir, paths.next); // atomic-ish: swap the validated build into next/
  rmrf(paths.work);
  writeStatus({ status: "staged", stagedVersion: val.version, remoteVersion: manifest.version, notes: manifest.notes || "", stagedAt: new Date().toISOString() });
  log("INFO", `staged v${val.version} -> next/ (applies on next restart)`);
  return { staged: true, version: val.version };
}

// CLI: force-stage whatever the manifest points at (ignores the version gate)
if (import.meta.main ?? import.meta.url === `file://${process.argv[1]}`) {
  if (!acquireLock()) { log("ERROR", "another updater is running (lock held)"); process.exit(2); }
  try {
    const manifest = await fetchManifest();
    await stage(manifest, { gate: false });
  } catch (e) {
    log("ERROR", `stage failed: ${e.message}`);
    process.exitCode = 1;
  } finally { releaseLock(); }
}
