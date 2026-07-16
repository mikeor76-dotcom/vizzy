#!/usr/bin/env bun
// update:cancel — remove a pending (staged) update so the next boot keeps the
// current version. Safe: only deletes next/; never touches current/ or backup/.
import { paths, log, acquireLock, releaseLock, isDir, dirVersion, rmrf, writeStatus } from "./lib.mjs";

if (!acquireLock()) { log("ERROR", "another updater is running (lock held)"); process.exit(2); }
try {
  if (!isDir(paths.next)) {
    log("INFO", "no pending update to cancel");
  } else {
    const v = dirVersion(paths.next);
    rmrf(paths.next);
    writeStatus({ status: "pending_cancelled", cancelledVersion: v });
    log("INFO", `cancelled pending update v${v} (next/ removed)`);
  }
} finally { releaseLock(); }
