#!/usr/bin/env node
// Switches off a user's second login step from the server shell: the way back in for the founder if
// the authenticator app AND the recovery codes are both gone. Needs shell access to the database, which
// is the same trust level as scripts/create-user.mjs.
//
//   node scripts/disable-second-factor.mjs <username>
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const username = process.argv[2];
if (!username) {
  console.error("usage: node scripts/disable-second-factor.mjs <username>");
  process.exit(1);
}
const dbPath = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
if (!user) {
  console.error(`no such user: ${username}`);
  process.exit(1);
}
db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, token_version = token_version + 1 WHERE id = ?").run(user.id);
db.prepare("DELETE FROM user_recovery_codes WHERE user_id = ?").run(user.id);
console.log(`second login step switched off for ${username}; every session of theirs was signed out.`);
