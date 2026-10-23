#!/usr/bin/env node
// Nightly backup: a consistent snapshot of routeflow.db (via SQLite's own VACUUM INTO,
// not a raw file copy -- the live DB runs in WAL mode, so `cp`-ing the .db file alone
// can catch it mid-write) plus a tarball of data/photos/, with a rotation pass that
// drops anything older than KEEP_DAYS. Written for the local filesystem: real
// disk-failure protection needs these copied off this machine too (rclone/rsync/etc
// to remote storage), which this script deliberately does not attempt on its own.
//
// Each run checks what it wrote (F138, first slice): the database snapshot is opened
// read-only and must pass `PRAGMA integrity_check`, and the photo tarball must list.
// The result goes to backup-status.json in the backup folder, which the owner's status
// page (/sales/admin/status) reads. A failed check or a crash still writes the file, with
// ok:false and the error, and the script exits non-zero so cron or systemd notices.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");
const PHOTOS_DIR = process.env.ROUTEFLOW_PHOTOS_DIR || path.join(ROOT, "data", "photos");
const BACKUP_DIR = process.env.COVERAGE_BACKUP_DIR || path.join(ROOT, "backups");
const KEEP_DAYS = 14;
const STATUS_FILE = "backup-status.json";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupDatabase(ts) {
  if (!fs.existsSync(DB_PATH)) {
    console.log(`[backup] no database at ${DB_PATH}, skipping`);
    return null;
  }
  // VACUUM INTO writes a consistent copy from one read transaction, WAL included. This used to
  // call db.serialize(), which node:sqlite does not have, so every run threw before writing.
  const outPath = path.join(BACKUP_DIR, `routeflow-${ts}.db`);
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(outPath);
  } finally {
    db.close();
  }
  return outPath;
}

function backupPhotos(ts) {
  if (!fs.existsSync(PHOTOS_DIR)) {
    console.log(`[backup] no photos directory at ${PHOTOS_DIR}, skipping`);
    return null;
  }
  const outPath = path.join(BACKUP_DIR, `photos-${ts}.tar.gz`);
  execFileSync("tar", ["-czf", outPath, "-C", path.dirname(PHOTOS_DIR), path.basename(PHOTOS_DIR)]);
  return outPath;
}

function rotate() {
  const now = Date.now();
  const maxAgeMs = KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    // `coverage-` is the pre-2026-09-08 prefix. Existing files were renamed to match the
    // new one, but the alternation stays so a backup restored from an older archive is
    // still rotated instead of accumulating forever.
    if (!/^(routeflow|coverage|photos)-/.test(name)) continue;
    const full = path.join(BACKUP_DIR, name);
    const age = now - fs.statSync(full).mtimeMs;
    if (age > maxAgeMs) {
      fs.rmSync(full);
      console.log(`[backup] removed expired backup ${name} (older than ${KEEP_DAYS}d)`);
    }
  }
}

/** "ok", or the first lines SQLite reports as wrong. */
function checkDatabase(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare("PRAGMA integrity_check").all();
    const messages = rows.map((r) => Object.values(r)[0]);
    return messages.length === 1 && messages[0] === "ok" ? "ok" : messages.slice(0, 5).join("; ");
  } finally {
    db.close();
  }
}

function checkPhotos(file) {
  execFileSync("tar", ["-tzf", file], { stdio: ["ignore", "ignore", "pipe"] });
  return "ok";
}

function writeStatus(status) {
  fs.writeFileSync(path.join(BACKUP_DIR, STATUS_FILE), `${JSON.stringify(status, null, 2)}\n`);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const ts = timestamp();
const startedAt = new Date().toISOString();
try {
  const dbBackup = backupDatabase(ts);
  const photosBackup = backupPhotos(ts);
  const database = dbBackup ? { file: path.basename(dbBackup), bytes: fs.statSync(dbBackup).size, check: checkDatabase(dbBackup) } : null;
  const photos = photosBackup ? { file: path.basename(photosBackup), bytes: fs.statSync(photosBackup).size, check: checkPhotos(photosBackup) } : null;
  rotate();
  const ok = database !== null && database.check === "ok" && (photos === null || photos.check === "ok");
  writeStatus({ ok, startedAt, finishedAt: new Date().toISOString(), database, photos, error: ok ? null : database ? null : "no database to back up" });

  console.log(`[backup] completed ${new Date().toISOString()}`);
  if (database) console.log(`[backup]   database: ${dbBackup} (${database.bytes} bytes, integrity ${database.check})`);
  if (photos) console.log(`[backup]   photos:   ${photosBackup} (${photos.bytes} bytes, ${photos.check})`);
  if (!ok) {
    console.error("[backup] FAILED the check; see backup-status.json");
    process.exitCode = 1;
  }
} catch (e) {
  writeStatus({ ok: false, startedAt, finishedAt: new Date().toISOString(), database: null, photos: null, error: String(e?.message ?? e).slice(0, 500) });
  console.error("[backup] FAILED:", e);
  process.exitCode = 1;
}
