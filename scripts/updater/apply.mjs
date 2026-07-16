#!/usr/bin/env bun
// update:apply — runs ONCE before the app launches (systemd
// vizzy-apply-update.service, before vizzy.service). It is the safe gate between
// a staged update and the running app.
//
// It does exactly one of:
//   1. RECOVER  — the last boot applied an update that never confirmed healthy
//                 (status still "applying"): roll back to backup/ first.
//   2. APPLY    — a valid staged update exists in next/: back up current/ and
//                 swap next/ -> current/ (atomic rename), mark "applying". The
//                 app then proves itself healthy (update:confirm) which flips
//                 the status to "current"; if it never does, the NEXT boot's
//                 RECOVER step rolls it back.
//   3. START    — nothing staged: just start current/.
//
// All directory swaps are atomic renames. backup/ (last known good) is only
// replaced once a new update is being applied, never deleted speculatively.
import {
  paths, log, acquireLock, releaseLock, readStatus, writeStatus, moveDir, rmrf,
  isDir, validateApp, dirVersion, writeJSONAtomic, doRollback, pruneFailed, badVersions,
} from "./lib.mjs";

function apply() {
  const st = readStatus();
  pruneFailed();

  // (0) partial-swap recovery: current/ went missing (power loss mid-apply)
  if (!isDir(paths.current) && !isDir(paths.next) && isDir(paths.backup)) {
    log("WARN", "current/ missing and nothing staged — restoring backup/");
    moveDir(paths.backup, paths.current);
    writeStatus({ status: "current", currentVersion: dirVersion(paths.current), recovered: true });
    return 0;
  }

  // (1) RECOVER — a prior update never reached "current" ⇒ it failed to start
  if (st.status === "applying") {
    const bad = (isDir(paths.current) && dirVersion(paths.current)) || st.applyingVersion;
    log("WARN", `previous update (v${bad}) never confirmed healthy — rolling back`);
    doRollback("previous update did not reach healthy on last boot", bad);
    return 0; // be conservative: don't also apply a new staged build on a recovery boot
  }

  // (2) APPLY a staged update
  if (isDir(paths.next)) {
    const val = validateApp(paths.next);
    if (!val.ok) {
      log("ERROR", `staged next/ is invalid — discarding: ${val.problems.join("; ")}`);
      rmrf(paths.next);
      writeStatus({ status: "stage_discarded", error: val.problems.join("; ") });
      return 0;
    }
    if (badVersions().includes(val.version)) {
      // staged before it was quarantined (or a stale stage) — never activate it
      log("WARN", `staged v${val.version} is quarantined — discarding, keeping current`);
      rmrf(paths.next);
      writeStatus({ status: "stage_discarded", error: `v${val.version} is quarantined` });
      return 0;
    }
    log("INFO", `applying staged v${val.version}`);
    if (isDir(paths.current)) { rmrf(paths.backup); moveDir(paths.current, paths.backup); } // current -> backup (new last-known-good)
    moveDir(paths.next, paths.current); // next -> current (atomic)
    writeJSONAtomic(paths.versionFile, { version: val.version, appliedAt: new Date().toISOString() });
    writeStatus({ status: "applying", applyingVersion: val.version, previousVersion: dirVersion(paths.backup), appliedAt: new Date().toISOString() });
    log("INFO", `applied v${val.version} -> current/ (app must now confirm health)`);
    return 0;
  }

  // (3) nothing to do
  if (!isDir(paths.current)) { log("ERROR", "no current/ and nothing staged — cannot start the app"); return 1; }
  log("INFO", `normal start — current v${dirVersion(paths.current)}`);
  writeStatus({ status: st.status === "unknown" ? "current" : st.status, currentVersion: dirVersion(paths.current) });
  return 0;
}

if (!acquireLock()) { log("ERROR", "updater lock is held — not applying this boot"); process.exit(1); }
try { process.exit(apply()); }
catch (e) { log("ERROR", `apply failed: ${e.message}`); process.exit(1); }
finally { releaseLock(); }
