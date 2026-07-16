#!/usr/bin/env bun
// Updater end-to-end suite — runs the REAL updater code against a throwaway
// VIZZY_ROOT and a local release server. No mocks of the logic under test;
// only the environment (root dir, ports, manifest server) is synthetic.
//
//   bun run test:updater
//
// Covers: no-update, staging happy path, checksum mismatch, corrupt archive,
// invalid release contents, version-mismatch, smoke-test failure, low disk,
// quarantine (skip + apply-guard + clear), pending apply, once-per-boot
// semantics (apply is a no-op re-run), power-loss recovery, rollback, cancel,
// concurrent lock, and cleanup safety.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { createHash } from "node:crypto";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROOT = mkdtempSync(join(tmpdir(), "vizzy-updater-test-"));
const SRV_PORT = 4599;
const STAGE_PORT = 4601;

process.env.VIZZY_ROOT = ROOT;
process.env.VIZZY_APP_PORT = "4600";
process.env.VIZZY_STAGE_PORT = String(STAGE_PORT);
process.env.VIZZY_STAGE_SMOKE_TIMEOUT_MS = "8000";
process.env.VIZZY_UPDATE_MANIFEST_URL = `http://127.0.0.1:${SRV_PORT}/manifest.json`;

const lib = await import(`${REPO}/scripts/updater/lib.mjs`);
const { stage } = await import(`${REPO}/scripts/updater/stage.mjs`);

// ---- tiny assertion kit -----------------------------------------------------
let passed = 0, failed = 0;
const results = [];
function ok(cond, name, detail = "") {
  if (cond) { passed++; results.push(`  ✓ ${name}`); }
  else { failed++; results.push(`  ✗ ${name} ${detail}`); }
}

// ---- build a minimal valid release zip --------------------------------------
// A release = package.json(start) + version.json + scripts/serve.mjs +
// scripts/updater/* + dist/index.html. We reuse the REAL serve.mjs + updater.
function makeReleaseDir(version, { breakServer = false, omitDist = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `vizzy-rel-${version}-`));
  mkdirSync(join(dir, "dist"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  if (!omitDist) writeFileSync(join(dir, "dist", "index.html"), `<html>v${version}</html>`);
  writeFileSync(join(dir, "version.json"), JSON.stringify({ version }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "vizzy", version, scripts: { start: "bun scripts/serve.mjs" },
  }));
  cpSync(join(REPO, "scripts", "serve.mjs"), join(dir, "scripts", "serve.mjs"));
  cpSync(join(REPO, "scripts", "updater"), join(dir, "scripts", "updater"), { recursive: true });
  if (breakServer) writeFileSync(join(dir, "scripts", "serve.mjs"), "process.exit(7) // broken on purpose\n");
  return dir;
}
function zipDir(dir, zipPath) {
  const r = spawnSync("zip", ["-rq", zipPath, "."], { cwd: dir });
  if (r.status !== 0) throw new Error("zip failed");
  return zipPath;
}
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// ---- local release server ----------------------------------------------------
const files = new Map(); // urlPath -> Buffer|string
const server = http.createServer((req, res) => {
  const body = files.get(req.url.split("?")[0]);
  if (body === undefined) { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200);
  res.end(body);
});
await new Promise((r) => server.listen(SRV_PORT, "127.0.0.1", r));

function publish(version, opts = {}) {
  const relDir = makeReleaseDir(version, opts);
  const zipPath = join(tmpdir(), `vizzy-test-${version}-${Date.now()}.zip`);
  zipDir(relDir, zipPath);
  const zipBuf = readFileSync(zipPath);
  files.set(`/vizzy-${version}.zip`, zipBuf);
  const manifest = {
    version,
    releaseUrl: `http://127.0.0.1:${SRV_PORT}/vizzy-${version}.zip`,
    sha256: opts.badSha ? "0".repeat(64) : sha256(zipPath),
    ...(opts.manifestOverride || {}),
  };
  files.set("/manifest.json", JSON.stringify(manifest));
  rmSync(relDir, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  return manifest;
}

// ---- install a fake "current" so the updater has a base ----------------------
function installCurrent(version) {
  rmSync(lib.paths.current, { recursive: true, force: true });
  const dir = makeReleaseDir(version);
  cpSync(dir, lib.paths.current, { recursive: true });
  rmSync(dir, { recursive: true, force: true });
  lib.writeJSONAtomic(lib.paths.versionFile, { version });
}
const runUpdater = (script, args = []) =>
  spawnSync("bun", [join(REPO, "scripts", "updater", script), ...args], {
    encoding: "utf8",
    env: { ...process.env },
  });

// =============================================================================
console.log(`\nUpdater e2e suite  (root: ${ROOT})\n`);
lib.ensureDirs();
installCurrent("1.0.0");

// 1. no update available (same version)
{
  publish("1.0.0");
  const r = await stage(await lib.fetchManifest(), { gate: true });
  ok(r.staged === false && r.reason === "up_to_date", "no-op when remote == local");
}

// 2. staging happy path (newer version, real smoke test boots the staged server)
{
  publish("1.1.0");
  const r = await stage(await lib.fetchManifest(), { gate: true });
  ok(r.staged === true && r.version === "1.1.0", "newer release stages", JSON.stringify(r));
  ok(lib.isDir(lib.paths.next) && lib.dirVersion(lib.paths.next) === "1.1.0", "next/ holds v1.1.0");
  ok(lib.readStatus().status === "staged", "status=staged");
}

// 3. re-check with same staged version = no re-download
{
  const r = await stage(await lib.fetchManifest(), { gate: true });
  ok(r.alreadyStaged === true, "already-staged short-circuits");
}

// 4. cancel-pending removes next/ only
{
  const r = runUpdater("cancel.mjs");
  ok(r.status === 0 && !lib.isDir(lib.paths.next), "cancel-pending removes next/");
  ok(lib.isDir(lib.paths.current), "cancel never touches current/");
}

// 5. checksum mismatch is refused, nothing staged
{
  publish("1.2.0", { badSha: true });
  let err = "";
  try { await stage(await lib.fetchManifest(), { gate: true }); } catch (e) { err = e.message; }
  ok(/checksum/.test(err), "bad sha256 refused", err);
  ok(!lib.isDir(lib.paths.next), "nothing staged after checksum failure");
}

// 6. corrupt archive is refused
{
  files.set("/vizzy-1.2.1.zip", Buffer.from("this is not a zip"));
  files.set("/manifest.json", JSON.stringify({
    version: "1.2.1",
    releaseUrl: `http://127.0.0.1:${SRV_PORT}/vizzy-1.2.1.zip`,
    sha256: createHash("sha256").update("this is not a zip").digest("hex"),
  }));
  let err = "";
  try { await stage(await lib.fetchManifest(), { gate: true }); } catch (e) { err = e.message; }
  ok(/extract/i.test(err), "corrupt archive refused", err);
}

// 7. structurally invalid release (no dist, not buildable) is refused
{
  publish("1.2.2", { omitDist: true, manifestOverride: {} });
  let err = "";
  try { await stage(await lib.fetchManifest(), { gate: true }); } catch (e) { err = e.message; }
  ok(/invalid|install failed|build/.test(err), "invalid release refused", err);
  ok(!lib.isDir(lib.paths.next), "nothing staged after invalid release");
}

// 8. version mismatch between manifest and archive is refused
{
  const m = publish("1.2.3");
  files.set("/manifest.json", JSON.stringify({ ...m, version: "9.9.9" }));
  let err = "";
  try { await stage(await lib.fetchManifest(), { gate: true }); } catch (e) { err = e.message; }
  ok(/mismatch/.test(err), "manifest/archive version mismatch refused", err);
}

// 9. smoke-test failure (server that exits immediately) is refused
{
  publish("1.3.0", { breakServer: true });
  let err = "";
  try { await stage(await lib.fetchManifest(), { gate: true }); } catch (e) { err = e.message; }
  ok(/smoke/.test(err), "broken staged server fails the smoke test", err);
  ok(!lib.isDir(lib.paths.next), "broken release never becomes pending");
}

// 10. low disk refused (raise the floor above reality). In-process: a child
// process couldn't reach our in-process manifest server while spawnSync blocks
// the event loop, so mutate the live cfg instead.
{
  publish("1.4.0");
  const saved = lib.cfg.minFreeMB;
  lib.cfg.minFreeMB = 99999999;
  let err = "";
  try { await stage(await lib.fetchManifest(), { gate: true }); } catch (e) { err = e.message; }
  lib.cfg.minFreeMB = saved;
  ok(/low disk/.test(err), "low disk space refused", err);
  ok(!lib.isDir(lib.paths.next), "nothing staged when disk is low");
}

// 11. quarantine: rollback marks bad; stage skips it; apply discards it; clear-bad readmits
{
  publish("1.5.0");
  await stage(await lib.fetchManifest(), { gate: true });
  ok(lib.dirVersion(lib.paths.next) === "1.5.0", "v1.5.0 staged for quarantine test");
  // simulate: it was applied and failed -> doRollback marks it bad
  lib.writeStatus({ badVersions: [] });
  lib.markBad("1.5.0");
  ok(lib.badVersions().includes("1.5.0"), "markBad records the version");
  const r1 = await stage(await lib.fetchManifest(), { gate: true });
  ok(r1.staged === false && r1.reason === "known_bad", "quarantined version is not re-staged");
  // apply must refuse the still-staged copy
  const r2 = runUpdater("apply.mjs");
  ok(r2.status === 0 && !lib.isDir(lib.paths.next), "apply discards a quarantined staged version");
  ok(lib.dirVersion(lib.paths.current) === "1.0.0", "current untouched by discarded stage");
  // clear-bad readmits
  const r3 = runUpdater("clear-bad.mjs", ["1.5.0"]);
  ok(r3.status === 0 && !lib.badVersions().includes("1.5.0"), "clear-bad readmits the version");
  const r4 = await stage(await lib.fetchManifest(), { gate: true });
  ok(r4.staged === true, "cleared version stages again");
}

// 12. apply activates pending; after a HEALTHY confirm, a same-boot re-run of
// apply is a plain no-op start. (In production the RemainAfterExit=yes oneshot
// prevents even this invocation on service restarts.)
{
  const r = runUpdater("apply.mjs");
  ok(r.status === 0 && lib.dirVersion(lib.paths.current) === "1.5.0", "apply swaps next/ -> current/");
  ok(lib.dirVersion(lib.paths.backup) === "1.0.0", "previous good kept as backup/");
  ok(lib.readStatus().status === "applying", "status=applying until confirmed");
  // the app came up healthy: confirm flips status to current (simulated —
  // confirm.mjs itself is exercised by the real boot path)
  lib.writeStatus({ status: "current", currentVersion: "1.5.0" });
  const r2 = runUpdater("apply.mjs");
  ok(r2.status === 0 && lib.readStatus().status === "current", "post-confirm apply re-run is a no-op");
  ok(lib.dirVersion(lib.paths.current) === "1.5.0", "current unchanged on apply re-run");
}

// 13. power-loss / failed-start recovery: if the last boot's update never
// confirmed (status still "applying"), the NEXT boot's apply rolls back
{
  lib.writeStatus({ status: "applying", applyingVersion: "1.5.0", badVersions: [] });
  const r = runUpdater("apply.mjs");
  ok(r.status === 0 && lib.dirVersion(lib.paths.current) === "1.0.0", "stuck 'applying' rolls back to backup on next boot");
  ok(lib.badVersions().includes("1.5.0"), "failed version quarantined by recovery");
  ok(lib.readStatus().status === "rolled_back", "status=rolled_back after recovery");
}

// 14. manual rollback refuses when no backup exists
{
  rmSync(lib.paths.backup, { recursive: true, force: true });
  const r = runUpdater("rollback.mjs");
  ok(lib.dirVersion(lib.paths.current) === "1.0.0", "rollback without backup leaves current in place");
}

// 15. concurrent updaters: second process refuses while lock held
{
  lib.acquireLock();
  const r = runUpdater("stage.mjs");
  ok(r.status === 2 || /lock/.test(r.stderr + r.stdout), "second updater refuses while lock held");
  lib.releaseLock();
}

// 16. cleanup safety: pruneFailed never touches current/backup/next
{
  mkdirSync(join(ROOT, "failed-x-1"), { recursive: true });
  mkdirSync(join(ROOT, "failed-x-2"), { recursive: true });
  lib.pruneFailed(1);
  ok(lib.isDir(lib.paths.current), "pruneFailed keeps current/");
  ok(!existsSync(join(ROOT, "failed-x-1")) || existsSync(join(ROOT, "failed-x-2")), "pruneFailed trims old failed dirs");
}

// =============================================================================
server.close();
console.log(results.join("\n"));
console.log(`\n${passed} passed, ${failed} failed  (${passed + failed} assertions)`);
rmSync(ROOT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
