// Vizzy updater — shared library.
//
// Design goals (appliance reliability > cleverness):
//   * Never touch the live `current/` while the app runs, except an atomic
//     directory rename at apply time.
//   * All file swaps are `rename()` (atomic on one filesystem) with a cp -a
//     fallback across devices.
//   * A single lock file prevents two updater processes running at once.
//   * Everything is logged to logs/updater.log.
//   * Dependency-free: only node builtins + system `tar`/`unzip`/`cp`. Runs
//     under bun or node.
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync,
  statSync, appendFileSync, openSync, closeSync, readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export const UPDATER_VERSION = "1.0.0";

// ---- config (all env-driven) --------------------------------------------
const PORT = Number(process.env.VIZZY_APP_PORT || 3000);
export const cfg = {
  root: process.env.VIZZY_ROOT || "/opt/vizzy",
  manifestUrl: process.env.VIZZY_UPDATE_MANIFEST_URL || "",
  port: PORT,
  healthUrl: process.env.VIZZY_HEALTH_URL || `http://localhost:${PORT}/health`,
  healthTimeoutMs: Number(process.env.VIZZY_HEALTH_TIMEOUT_MS || 40000),
  autoUpdate: String(process.env.VIZZY_AUTO_UPDATE ?? "true").toLowerCase() !== "false",
  // staged smoke test: boot the staged release on a localhost-only side port
  stagePort: Number(process.env.VIZZY_STAGE_PORT || 3777),
  stageSmokeTimeoutMs: Number(process.env.VIZZY_STAGE_SMOKE_TIMEOUT_MS || 25000),
  // refuse to download/stage with less free space than this (MB)
  minFreeMB: Number(process.env.VIZZY_MIN_FREE_MB || 300),
};

export const paths = {
  root: cfg.root,
  current: join(cfg.root, "current"),
  next: join(cfg.root, "next"),
  backup: join(cfg.root, "backup"),
  work: join(cfg.root, "work"),
  state: join(cfg.root, "state"),
  logs: join(cfg.root, "logs"),
  versionFile: join(cfg.root, "state", "version.json"),
  statusFile: join(cfg.root, "state", "update-status.json"),
  lockFile: join(cfg.root, "state", "update-lock"),
  log: join(cfg.root, "logs", "updater.log"),
};

export function ensureDirs() {
  for (const d of [paths.root, paths.state, paths.logs]) mkdirSync(d, { recursive: true });
}

// ---- logging ------------------------------------------------------------
export function log(level, msg, extra) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${extra ? " " + JSON.stringify(extra) : ""}`;
  try { ensureDirs(); appendFileSync(paths.log, line + "\n"); } catch { /* logging must never crash the updater */ }
  (level === "ERROR" || level === "WARN" ? console.error : console.log)(line);
}

// ---- lock (one updater at a time) --------------------------------------
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
export function acquireLock() {
  ensureDirs();
  try {
    const fd = openSync(paths.lockFile, "wx"); // O_CREAT | O_EXCL — fails if it exists
    writeFileSync(paths.lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    closeSync(fd);
    return true;
  } catch {
    try { // steal a stale lock whose owner is gone
      const info = JSON.parse(readFileSync(paths.lockFile, "utf8"));
      if (info.pid && !pidAlive(info.pid)) { log("WARN", "stealing stale updater lock", info); rmSync(paths.lockFile, { force: true }); return acquireLock(); }
    } catch { /* ignore */ }
    return false;
  }
}
export function releaseLock() { try { rmSync(paths.lockFile, { force: true }); } catch { /* ignore */ } }

// ---- semantic version comparison ---------------------------------------
export function parseVer(v) {
  const m = String(v ?? "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function cmpVer(a, b) { // -1 a<b, 0 equal, 1 a>b, null if unparseable
  const pa = parseVer(a), pb = parseVer(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}
export const isNewer = (remote, local) => cmpVer(remote, local) === 1;

// ---- json / state -------------------------------------------------------
export function readJSON(file, dflt = null) { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return dflt; } }
export function writeJSONAtomic(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, file);
}
export function readStatus() { return readJSON(paths.statusFile, { status: "unknown" }); }
export function writeStatus(patch) {
  const next = { ...readStatus(), ...patch, updatedAt: new Date().toISOString() };
  writeJSONAtomic(paths.statusFile, next);
  return next;
}
export function dirVersion(dir) {
  return readJSON(join(dir, "version.json"))?.version || readJSON(join(dir, "package.json"))?.version || null;
}
export function currentVersion() { return dirVersion(paths.current) || readJSON(paths.versionFile)?.version || "0.0.0"; }

// ---- bad-version quarantine ----------------------------------------------
// A version that failed after activation is quarantined and never re-staged
// until an admin clears it (update:clear-bad) or a DIFFERENT version ships.
export function badVersions() {
  const st = readStatus();
  const list = Array.isArray(st.badVersions) ? st.badVersions : [];
  // migrate the old single-field form
  if (st.failedVersion && !list.includes(st.failedVersion)) list.push(st.failedVersion);
  return list;
}
export function markBad(version) {
  if (!version) return;
  const list = badVersions();
  if (!list.includes(version)) list.push(version);
  writeStatus({ badVersions: list });
}
export function clearBad(version) {
  const list = badVersions().filter((v) => v !== version);
  writeStatus({ badVersions: list, failedVersion: undefined });
  return list;
}

// ---- filesystem (atomic-ish) -------------------------------------------
export const exists = (p) => existsSync(p);
export function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
export function rmrf(p) { try { rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ } }
export function moveDir(from, to) {
  rmrf(to);
  try { renameSync(from, to); } // atomic on the same filesystem
  catch (e) {
    if (e.code === "EXDEV") { // cross-device — copy then remove
      const r = spawnSync("cp", ["-a", from, to]);
      if (r.status !== 0) throw new Error(`cp -a failed: ${r.stderr}`);
      rmrf(from);
    } else throw e;
  }
}
export function which(cmd) { const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; }

// ---- checksum -----------------------------------------------------------
export function sha256File(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }

// ---- disk space guard ----------------------------------------------------
// Free MB on the filesystem holding `dir` (POSIX df; -1 if unknown — callers
// treat unknown as "don't block", availability beats a wrong refusal).
export function freeMB(dir = cfg.root) {
  try {
    const r = spawnSync("df", ["-Pk", dir], { encoding: "utf8" });
    if (r.status !== 0) return -1;
    const cols = r.stdout.trim().split("\n").pop().trim().split(/\s+/);
    return Math.floor(Number(cols[3]) / 1024); // "Available" KB -> MB
  } catch { return -1; }
}
export function requireDiskSpace(minMB = cfg.minFreeMB) {
  const free = freeMB();
  if (free >= 0 && free < minMB) throw new Error(`low disk space: ${free}MB free < ${minMB}MB required`);
  if (free >= 0) log("INFO", `disk space ok: ${free}MB free (need ${minMB}MB)`);
  return free;
}

// ---- staged smoke test ----------------------------------------------------
// Actually BOOT the staged release: run its own serve.mjs on a localhost-only
// side port with VIZZY_ROOT pointed at a scratch state dir (so it can't touch
// production state), poll /health until it answers, then shut it down. This is
// hardware-safe — serve.mjs is a static file server; the mic/GPIO/display all
// belong to the browser and the encoder daemon, not this process.
export async function smokeTestStaged(dir, { port = cfg.stagePort, timeoutMs = cfg.stageSmokeTimeoutMs } = {}) {
  const { spawn } = await import("node:child_process");
  const runner = which("bun") || which("node");
  if (!runner) throw new Error("smoke test needs bun or node on PATH");
  const scratch = join(paths.work, "smoke-state");
  rmrf(scratch); mkdirSync(scratch, { recursive: true });
  const child = spawn(runner, [join(dir, "scripts", "serve.mjs")], {
    cwd: dir,
    env: {
      ...process.env,
      VIZZY_APP_PORT: String(port),
      VIZZY_APP_HOST: "127.0.0.1", // never exposed off the device
      VIZZY_DIST: join(dir, "dist"),
      VIZZY_ROOT: scratch,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (d) => { stderr = (stderr + d).slice(-2000); });
  const url = `http://127.0.0.1:${port}/health`;
  const deadline = Date.now() + timeoutMs;
  let lastErr = "no response";
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`staged server exited early (code ${child.exitCode}) ${stderr}`);
      try {
        const r = await withTimeout(fetch(url, { cache: "no-store" }), 2500, "staged health");
        if (r.ok) {
          const body = await r.json().catch(() => ({}));
          log("INFO", `staged smoke test passed: ${url} ok (v${body.version ?? "?"})`);
          return true;
        }
        lastErr = `HTTP ${r.status}`;
      } catch (e) { lastErr = e.message; }
      await new Promise((r) => setTimeout(r, 700));
    }
    throw new Error(`staged release never became healthy on :${port} (${lastErr}) ${stderr}`);
  } finally {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
    // give it a moment, then make sure
    await new Promise((r) => setTimeout(r, 300));
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    rmrf(scratch);
  }
}

// ---- network (fetch: node 18+/bun) -------------------------------------
export async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => (t = setTimeout(() => rej(new Error(`${label} timed out (${ms}ms)`)), ms)));
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(t); }
}
export async function online() {
  const probes = [cfg.manifestUrl, "https://1.1.1.1/", "https://www.google.com/generate_204"].filter(Boolean);
  for (const url of probes) {
    try { const r = await withTimeout(fetch(url, { method: "HEAD", redirect: "manual" }), 5000, "connectivity"); if (r.status < 500) return true; } catch { /* try next */ }
  }
  return false;
}
export async function fetchManifest() {
  if (!cfg.manifestUrl) throw new Error("VIZZY_UPDATE_MANIFEST_URL is not set");
  const r = await withTimeout(fetch(cfg.manifestUrl, { headers: { "cache-control": "no-cache" } }), 10000, "manifest fetch");
  if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
  return r.json();
}
export async function download(url, dest) {
  const r = await withTimeout(fetch(url), 120000, "download");
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return dest;
}

// ---- extract (system tar/unzip; no npm deps) ---------------------------
export function extract(archive, destDir) {
  rmrf(destDir); mkdirSync(destDir, { recursive: true });
  const lc = archive.toLowerCase();
  let r;
  if (lc.endsWith(".zip")) r = spawnSync("unzip", ["-oq", archive, "-d", destDir], { encoding: "utf8" });
  else if (lc.endsWith(".tar.gz") || lc.endsWith(".tgz")) r = spawnSync("tar", ["-xzf", archive, "-C", destDir], { encoding: "utf8" });
  else if (lc.endsWith(".tar")) r = spawnSync("tar", ["-xf", archive, "-C", destDir], { encoding: "utf8" });
  else throw new Error(`unsupported archive type: ${archive} (want .zip/.tar.gz/.tgz/.tar)`);
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`extract failed: ${r.stderr || `exit ${r.status}`}`);
  // if the archive wrapped everything in one top folder, flatten it up a level
  const entries = readdirSync(destDir).filter((e) => e !== "__MACOSX" && !e.startsWith("."));
  if (entries.length === 1 && isDir(join(destDir, entries[0]))) {
    const inner = join(destDir, entries[0]);
    if (exists(join(inner, "package.json")) || exists(join(inner, "dist")) || exists(join(inner, "version.json"))) {
      for (const f of readdirSync(inner)) moveDir(join(inner, f), join(destDir, f));
      rmrf(inner);
    }
  }
}

// ---- validation: is this dir a runnable Vizzy release? -----------------
export function validateApp(dir) {
  const problems = [];
  if (!exists(join(dir, "package.json"))) problems.push("missing package.json");
  const version = dirVersion(dir);
  if (!version) problems.push("missing version metadata (version.json / package.json version)");
  else if (!parseVer(version)) problems.push(`unparseable version: ${version}`);
  const pkg = readJSON(join(dir, "package.json"), {});
  const scripts = pkg.scripts || {};
  if (!scripts.start) problems.push("no `start` script in package.json");
  if (!exists(join(dir, "scripts", "serve.mjs"))) problems.push("missing scripts/serve.mjs (the server)");
  if (!exists(join(dir, "scripts", "updater", "apply.mjs"))) problems.push("missing scripts/updater/ (release can't self-update)");
  const prebuilt = exists(join(dir, "dist", "index.html"));
  const buildable = exists(join(dir, "index.html")) && !!scripts.build;
  if (!prebuilt && !buildable) problems.push("no dist/index.html and not buildable (need index.html + build script)");
  return { ok: problems.length === 0, problems, version, prebuilt };
}

// build a staged release only if it isn't already built (prefer prebuilt releases)
export function installAndBuild(dir) {
  if (exists(join(dir, "dist", "index.html"))) { log("INFO", "staged release is prebuilt (dist/ present) — no build needed"); return; }
  const runner = which("bun") || which("npm");
  if (!runner) throw new Error("staged release needs a build but no bun/npm found");
  const pkg = readJSON(join(dir, "package.json"), {});
  log("INFO", `installing deps in staged release with ${runner}`);
  let r = spawnSync(runner, ["install"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`install failed: ${r.stderr || r.status}`);
  if (pkg.scripts?.build) {
    log("INFO", `building staged release (${runner} run build)`);
    r = spawnSync(runner, ["run", "build"], { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`build failed: ${r.stderr || r.status}`);
  }
}

// ---- rollback (shared by apply/confirm/rollback) -----------------------
// Restore backup/ (last known good) into current/, set the failed one aside,
// and refuse to re-apply a staged copy of the same bad version.
export function doRollback(reason, badVersion) {
  if (!isDir(paths.backup)) {
    log("ERROR", `rollback impossible (${reason}): no backup/ present`);
    writeStatus({ status: "rollback_failed", reason, error: "no backup" });
    return false;
  }
  const failedDir = join(paths.root, `failed-${badVersion || "unknown"}-${Date.now()}`);
  if (isDir(paths.current)) moveDir(paths.current, failedDir);
  moveDir(paths.backup, paths.current); // backup -> current (backup is consumed; a new one is made on next apply)
  const restored = dirVersion(paths.current);
  writeJSONAtomic(paths.versionFile, { version: restored, appliedAt: new Date().toISOString(), rolledBackFrom: badVersion });
  writeStatus({ status: "rolled_back", reason, restoredVersion: restored, failedVersion: badVersion, failedDir });
  markBad(badVersion); // quarantine: never re-stage this exact version
  log("WARN", `rolled back to v${restored} (${reason}); failed v${badVersion} kept at ${failedDir}`);
  if (isDir(paths.next) && dirVersion(paths.next) === badVersion) { rmrf(paths.next); log("INFO", "discarded staged next/ (same known-bad version)"); }
  return true;
}

// keep only the newest few failed-* dirs so they don't accumulate forever
export function pruneFailed(keep = 3) {
  try {
    const dirs = readdirSync(paths.root).filter((e) => e.startsWith("failed-") && isDir(join(paths.root, e)))
      .map((e) => ({ e, t: statSync(join(paths.root, e)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { e } of dirs.slice(keep)) rmrf(join(paths.root, e));
  } catch { /* ignore */ }
}
