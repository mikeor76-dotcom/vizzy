#!/usr/bin/env bun
// bun run version:bump [patch|minor|major]   (default: patch)
// Bumps version.json — the number shown on the loading splash and compared by
// the OTA updater (a device only updates to a strictly NEWER semver).
import { readFileSync, writeFileSync } from "node:fs";

const kind = (process.argv[2] || "patch").toLowerCase();
const file = new URL("../version.json", import.meta.url).pathname;
const j = JSON.parse(readFileSync(file, "utf8"));
const [ma, mi, pa] = j.version.split(".").map(Number);
j.version =
  kind === "major" ? `${ma + 1}.0.0` :
  kind === "minor" ? `${ma}.${mi + 1}.0` :
  `${ma}.${mi}.${pa + 1}`;
writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
console.log(`version.json -> v${j.version}`);
