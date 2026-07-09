#!/usr/bin/env bun
// update:rollback — manually roll back to the last known good version (backup/).
// Also used by vizzy-rollback.service (systemd OnFailure) as an automatic
// backstop when the app crash-loops before the smoke test can run.
import { paths, log, acquireLock, releaseLock, isDir, dirVersion, doRollback } from "./lib.mjs";

if (!acquireLock()) { log("ERROR", "updater lock is held — not rolling back"); process.exit(1); }
try {
  if (!isDir(paths.backup)) { log("ERROR", "no backup/ to roll back to"); process.exit(1); }
  const bad = isDir(paths.current) ? dirVersion(paths.current) : "unknown";
  const ok = doRollback("manual rollback", bad);
  process.exit(ok ? 0 : 1);
} finally { releaseLock(); }
