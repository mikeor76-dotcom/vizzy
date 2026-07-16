#!/usr/bin/env bun
// update:clear-bad <version> — remove a version from the quarantine list so it
// may be staged again. Requires the exact version (with or without the v).
import { log, acquireLock, releaseLock, badVersions, clearBad } from "./lib.mjs";

const arg = (process.argv[2] || "").replace(/^v/i, "");
if (!arg) {
  const list = badVersions();
  console.log(list.length ? `quarantined: ${list.join(", ")}\nusage: update:clear-bad <version>` : "quarantine list is empty");
  process.exit(list.length ? 1 : 0);
}
if (!acquireLock()) { log("ERROR", "another updater is running (lock held)"); process.exit(2); }
try {
  const before = badVersions();
  if (!before.includes(arg)) {
    log("INFO", `v${arg} is not quarantined (list: ${before.join(", ") || "empty"})`);
  } else {
    const after = clearBad(arg);
    log("INFO", `cleared v${arg} from quarantine (remaining: ${after.join(", ") || "none"})`);
  }
} finally { releaseLock(); }
