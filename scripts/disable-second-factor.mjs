#!/usr/bin/env node
// Switches off a user's second login step from the server shell: the way back in for the founder if
// the authenticator app AND the recovery codes are both gone. Needs shell access to the database, which
// is the same trust level as scripts/create-user.mjs.
//
//   node scripts/disable-second-factor.mjs <username>
//
// The database is the one DATABASE_URL points at (set -a; . /etc/routeflow/env; set +a).
import { openScriptDb } from "./_db.mjs";

const username = process.argv[2];
if (!username) {
  console.error("usage: node scripts/disable-second-factor.mjs <username>");
  process.exit(1);
}
const db = await openScriptDb();
const user = await db.get("SELECT id FROM users WHERE username = ?", username);
if (!user) {
  console.error(`no such user: ${username}`);
  await db.close();
  process.exit(1);
}
await db.run("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, token_version = token_version + 1 WHERE id = ?", user.id);
await db.run("DELETE FROM user_recovery_codes WHERE user_id = ?", user.id);
await db.close();
console.log(`second login step switched off for ${username}; every session of theirs was signed out.`);
