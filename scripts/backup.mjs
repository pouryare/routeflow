#!/usr/bin/env node
// Nightly backup: a consistent snapshot of routeflow.db (via SQLite's own serialize,
// not a raw file copy -- the live DB runs in WAL mode, so `cp`-ing the .db file alone
// can catch it mid-write) plus a tarball of data/photos/, with a rotation pass that
// drops anything older than KEEP_DAYS. Written for the local filesystem: real
// disk-failure protection needs these copied off this machine too (rclone/rsync/etc
// to remote storage), which this script deliberately does not attempt on its own.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");
const PHOTOS_DIR = path.join(ROOT, "data", "photos");
const BACKUP_DIR = process.env.COVERAGE_BACKUP_DIR || path.join(ROOT, "backups");
const KEEP_DAYS = 14;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupDatabase(ts) {
  if (!fs.existsSync(DB_PATH)) {
    console.log(`[backup] no database at ${DB_PATH}, skipping`);
    return null;
  }
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const snapshot = db.serialize();
  db.close();
  const outPath = path.join(BACKUP_DIR, `routeflow-${ts}.db`);
  fs.writeFileSync(outPath, snapshot);
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

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const ts = timestamp();
const dbBackup = backupDatabase(ts);
const photosBackup = backupPhotos(ts);
rotate();

console.log(`[backup] completed ${new Date().toISOString()}`);
if (dbBackup) console.log(`[backup]   database: ${dbBackup} (${fs.statSync(dbBackup).size} bytes)`);
if (photosBackup) console.log(`[backup]   photos:   ${photosBackup} (${fs.statSync(photosBackup).size} bytes)`);
