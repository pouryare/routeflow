#!/usr/bin/env node
// Backup of the PostgreSQL database and the photos, replacing scripts/backup.mjs (SQLite) once the
// server runs on Postgres.
//
//   node scripts/pg/backup.mjs [full|diff|incr]        (incr when omitted)
//
// The database goes through pgBackRest (db/server/pgbackrest.conf): one backup per repository the
// stanza has, so a copy on this machine and a copy on the second machine, each checked afterwards
// with `pgbackrest check`. WAL is archived continuously by the server itself between backups.
// Photos are not in the database: they are tarred next to the status file, and copied to
// ROUTEFLOW_PHOTOS_OFFSITE (an rsync destination such as user@host:/path/) when that is set.
//
// Like the SQLite script it writes backup-status.json for the owner's status page
// (/sales/admin/status) in COVERAGE_BACKUP_DIR, with ok:false and the error when anything failed,
// and exits non-zero so systemd notices. Run it as the postgres user: pgBackRest refuses root.
//
// Environment: PGBACKREST_STANZA (routeflow), COVERAGE_BACKUP_DIR (./backups), ROUTEFLOW_PHOTOS_DIR
// (./data/photos), ROUTEFLOW_PHOTOS_OFFSITE (unset: no photo copy off this machine),
// RF_BACKUP_KEEP_DAYS (14, photo tarballs only; pgBackRest keeps its own retention).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STANZA = process.env.PGBACKREST_STANZA || "routeflow";
const PHOTOS_DIR = process.env.ROUTEFLOW_PHOTOS_DIR || path.join(ROOT, "data", "photos");
const BACKUP_DIR = process.env.COVERAGE_BACKUP_DIR || path.join(ROOT, "backups");
const OFFSITE = process.env.ROUTEFLOW_PHOTOS_OFFSITE || "";
const KEEP_DAYS = Number(process.env.RF_BACKUP_KEEP_DAYS ?? 14);
const STATUS_FILE = "backup-status.json";

const type = process.argv[2] ?? "incr";
if (!["full", "diff", "incr"].includes(type)) {
  console.error("Usage: node scripts/pg/backup.mjs [full|diff|incr]");
  process.exit(2);
}

/** The line that says what went wrong: pgBackRest's own ERROR, else the last few lines. */
const why = (e) => {
  const lines = String(e?.stderr || e?.stdout || e?.message || e).trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter((l) => /\bERROR\b/.test(l));
  return (errors.length ? errors.slice(0, 2) : lines.slice(-3)).join(" ").replace(/^\S+ \S+ \S+ ERROR: /, "").slice(0, 500);
};

const pgbackrest = (...args) => execFileSync("pgbackrest", [`--stanza=${STANZA}`, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const info = () => JSON.parse(pgbackrest("info", "--output=json"))[0];

function writeStatus(status) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUP_DIR, STATUS_FILE), `${JSON.stringify(status, null, 2)}\n`);
}

/** Back up to every repository, then check each holds the backup it should. */
function backupDatabase() {
  const repos = info().repo.map((r) => r.key);
  if (repos.length === 0) throw new Error(`stanza ${STANZA} has no repository`);
  for (const key of repos) {
    // A differential or incremental backup needs a full one before it in the same repository; the
    // first run on a fresh repository, or after retention removed it, falls back to a full.
    const have = info().backup.some((b) => b.database["repo-key"] === key);
    console.log(`[backup] repo${key}: ${have ? type : "full (none yet)"}`);
    pgbackrest(`--repo=${key}`, `--type=${have ? type : "full"}`, "backup");
  }
  pgbackrest("check");
  const after = info();
  const parts = [];
  let bytes = 0;
  for (const key of repos) {
    const newest = after.backup
      .filter((b) => b.database["repo-key"] === key)
      .sort((a, b) => b.timestamp.stop - a.timestamp.stop)[0];
    if (!newest) throw new Error(`repo${key} has no backup after the run`);
    const repo = after.repo.find((r) => r.key === key);
    if (repo?.status?.code !== 0) throw new Error(`repo${key}: ${repo?.status?.message ?? "not ok"}`);
    parts.push(`repo${key} ${newest.label}`);
    bytes = Math.max(bytes, newest.info.size);
  }
  return { file: parts.join(" · "), bytes, check: "ok" };
}

function backupPhotos(ts) {
  if (!fs.existsSync(PHOTOS_DIR)) {
    console.log(`[backup] no photos directory at ${PHOTOS_DIR}, skipping`);
    return null;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const out = path.join(BACKUP_DIR, `photos-${ts}.tar.gz`);
  execFileSync("tar", ["-czf", out, "-C", path.dirname(PHOTOS_DIR), path.basename(PHOTOS_DIR)]);
  execFileSync("tar", ["-tzf", out], { stdio: ["ignore", "ignore", "pipe"] });
  if (OFFSITE) execFileSync("rsync", ["-a", "--partial", "-e", "ssh -o BatchMode=yes", out, OFFSITE], { stdio: ["ignore", "inherit", "inherit"] });
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (/^photos-.*\.tar\.gz$/.test(name) && fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs < cutoff) fs.rmSync(path.join(BACKUP_DIR, name));
  }
  return { file: path.basename(out), bytes: fs.statSync(out).size, check: "ok" };
}

const startedAt = new Date().toISOString();
try {
  const database = backupDatabase();
  const photos = backupPhotos(startedAt.replace(/[:.]/g, "-"));
  writeStatus({ ok: true, startedAt, finishedAt: new Date().toISOString(), database, photos, error: null });
  console.log(`[backup] completed: ${database.file}${photos ? `, ${photos.file}` : ""}`);
} catch (e) {
  const detail = why(e);
  writeStatus({ ok: false, startedAt, finishedAt: new Date().toISOString(), database: null, photos: null, error: detail });
  console.error("[backup] FAILED:", detail);
  process.exitCode = 1;
}
