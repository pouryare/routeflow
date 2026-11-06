#!/usr/bin/env node
// The way back in when the owner is locked out (password forgotten, phone with the authenticator
// lost): a new password, the second login step switched off, every session signed out, the account
// active again. Run from the server shell, the same trust as scripts/create-user.mjs:
//
//   echo 'new password' | node scripts/reset-login.mjs <username>      (routeflow reset-login does this)
//
// The password is read from stdin so it never shows in the process list.
import crypto from "node:crypto";
import { openScriptDb } from "./_db.mjs";

const username = process.argv[2];
if (!username) {
  console.error("usage: node scripts/reset-login.mjs <username>   (the new password on stdin)");
  process.exit(1);
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
const password = input.split(/\r?\n/)[0];
if (password.length < 8) {
  console.error("the new password must be at least 8 characters");
  process.exit(1);
}

// Same format as hashPassword() in lib/auth.ts: hex salt, colon, hex scrypt hash (64 bytes).
const salt = crypto.randomBytes(16);
const hash = `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;

const db = await openScriptDb();
const user = await db.get("SELECT id FROM users WHERE username = ?", username);
if (!user) {
  console.error(`no such user: ${username}`);
  await db.close();
  process.exit(1);
}
await db.run(
  "UPDATE users SET password_hash = ?, totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, active = 1, token_version = token_version + 1 WHERE id = ?",
  hash,
  user.id,
);
await db.run("DELETE FROM user_recovery_codes WHERE user_id = ?", user.id);
await db.close();
console.log(`login reset for ${username}: new password set, second step off, every session signed out.`);
