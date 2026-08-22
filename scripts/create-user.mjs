#!/usr/bin/env node
// Creates (or updates the password of) a named coworker account. There's no
// admin UI for this yet -- accounts are additive alongside the shared APP_PASSWORD
// login, so this stays a one-off CLI tool rather than a bigger admin surface.
//
// Usage: node scripts/create-user.mjs <username> <password> "<Display Name>"

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.COVERAGE_DB_PATH || path.join(ROOT, "data", "coverage.db");

const [username, password, displayName] = process.argv.slice(2);
if (!username || !password || !displayName) {
  console.error('Usage: node scripts/create-user.mjs <username> <password> "<Display Name>"');
  process.exit(1);
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const now = new Date().toISOString();
const passwordHash = hashPassword(password);
db.prepare(
  `INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, display_name = excluded.display_name`
).run(username, passwordHash, displayName, now);

console.log(`[create-user] account ready: ${username} (${displayName})`);
db.close();
