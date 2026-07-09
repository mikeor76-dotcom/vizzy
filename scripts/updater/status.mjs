#!/usr/bin/env bun
// update:status — print a one-shot snapshot of the updater state (versions in
// each slot, config, and the last status record). Safe to run anytime.
import { cfg, paths, readStatus, readJSON, isDir, dirVersion, UPDATER_VERSION } from "./lib.mjs";

const snapshot = {
  updaterVersion: UPDATER_VERSION,
  root: cfg.root,
  autoUpdate: cfg.autoUpdate,
  manifestUrl: cfg.manifestUrl || null,
  healthUrl: cfg.healthUrl,
  slots: {
    current: isDir(paths.current) ? dirVersion(paths.current) : null,
    backup: isDir(paths.backup) ? dirVersion(paths.backup) : null,
    staged_next: isDir(paths.next) ? dirVersion(paths.next) : null,
  },
  appliedVersion: readJSON(paths.versionFile)?.version || null,
  status: readStatus(),
};

console.log(JSON.stringify(snapshot, null, 2));
