#!/usr/bin/env node
// Creates (or resets the password of) an account, straight against the database.
//
// This is the bootstrap path for the very first owner -- the one account that cannot be
// made through /admin/users, because that screen requires already being signed in as an
// owner. Day-to-day account management belongs there, not here.
//
// Usage:
//   node scripts/create-user.mjs <username> <password> "<Display Name>" <owner|group_manager|salesperson|driver> [group_id]

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");
// Kept in step with lib/roles.ts by a test -- this script is plain ESM run straight by
// node with no build step, so it cannot import the TypeScript definition.
const ROLES = ["platform_owner", "owner", "group_manager", "rep_manager", "phone_sales", "field_rep", "delivery_driver"];
const USAGE =
  'Usage: node scripts/create-user.mjs <username> <password> "<Display Name>" <owner|group_manager|rep_manager|phone_sales|field_rep|delivery_driver> [group_id]';

const [username, password, displayName, role, groupArg] = process.argv.slice(2);
if (!username || !password || !displayName || !role) {
  console.error(USAGE);
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`[create-user] unknown role "${role}". Expected one of: ${ROLES.join(", ")}`);
  process.exit(1);
}

// There is exactly ONE platform_owner: the founder, the account this script bootstraps in
// the first place. A second one is refused because lib/impersonation.ts has no UNTOUCHABLE
// check left — two platform owners would each be able to act as anyone in any tenant.
// The admin user API refuses it too; this is the one path that legitimately CREATES one.
if (role === "platform_owner") {
  const db0 = new DatabaseSync(DB_PATH, { readOnly: true });
  const existing = db0
    .prepare("SELECT COUNT(*) n FROM users WHERE role = 'platform_owner'")
    .get().n;
  db0.close();
  if (existing > 0) {
    console.error("[create-user] a platform_owner already exists — there can be only one.");
    process.exit(1);
  }
}

// An owner is unscoped by design. A non-owner with no group can reach nothing at all --
// groupFilter() becomes " AND 1 = 0" -- so the account would log in and then show an
// empty app, which looks like a broken deployment rather than a misconfigured account.
const UNSCOPED = role === "owner" || role === "rep_manager";
const groupId = UNSCOPED ? null : Number(groupArg);
if (!UNSCOPED && !Number.isInteger(groupId)) {
  console.error(`[create-user] role "${role}" needs a group_id as the fifth argument.`);
  console.error(USAGE);
  process.exit(1);
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

const db = new DatabaseSync(DB_PATH);

// No CREATE TABLE here any more. This script used to create a five-column users table of
// its own, which no longer matches the schema lib/db.ts migrates to -- run against a fresh
// database it would have created a table missing role, group_id, active and token_version,
// and then the app would have layered its migration on top of a table it did not build.
// Requiring an already-migrated database and failing loudly is the honest behaviour: start
// the app once, then run this.
const columns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (columns.length === 0) {
  console.error(`[create-user] no users table in ${DB_PATH}. Start the app once so it can create the schema, then re-run.`);
  process.exit(1);
}
for (const required of ["role", "group_id", "active", "token_version"]) {
  if (!columns.includes(required)) {
    console.error(`[create-user] ${DB_PATH} is missing users.${required}. Start the app once so it can migrate, then re-run.`);
    process.exit(1);
  }
}

if (groupId !== null && !db.prepare("SELECT 1 FROM groups WHERE id = ?").get(groupId)) {
  console.error(`[create-user] no group with id ${groupId}. Existing groups:`);
  for (const g of db.prepare("SELECT id, name FROM groups ORDER BY id").all()) {
    console.error(`  ${g.id}  ${g.name}`);
  }
  process.exit(1);
}

const now = new Date().toISOString();
db.prepare(
  `INSERT INTO users (username, password_hash, display_name, role, group_id, active, token_version, created_at)
   VALUES (?, ?, ?, ?, ?, 1, 0, ?)
   ON CONFLICT(username) DO UPDATE SET
     password_hash = excluded.password_hash,
     display_name  = excluded.display_name,
     role          = excluded.role,
     group_id      = excluded.group_id,
     active        = 1,
     -- Same rule the admin route follows: any change here has to invalidate sessions
     -- already issued, or a password reset leaves the old one working for 30 days.
     token_version = users.token_version + 1`
).run(username, hashPassword(password), displayName, role, groupId, now);

console.log(`[create-user] account ready: ${username} (${displayName}) — ${role}${groupId === null ? "" : `, group ${groupId}`}`);
db.close();
