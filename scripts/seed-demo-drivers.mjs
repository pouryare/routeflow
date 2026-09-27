#!/usr/bin/env node
// Seeds the driver accounts a manager needs to see the route hand-over work.
//
// The "سپردن مسیر" picker lists real people, so a demo with zero drivers shows an empty
// list and proves nothing. This creates five, each with a real photograph in
// public/avatars/ so the picker is exercised with faces rather than initials.
//
// Idempotent: re-running updates the same five accounts (and bumps token_version, so a
// password reset actually invalidates sessions already issued) and skips any image that
// is already on disk, which also keeps it usable offline.
//
// Usage:
//   node scripts/seed-demo-drivers.mjs [--password <pw>]

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");
const AVATAR_DIR = path.join(ROOT, "public", "avatars");

const pwIdx = process.argv.indexOf("--password");
const PASSWORD = pwIdx !== -1 && process.argv[pwIdx + 1] ? process.argv[pwIdx + 1] : "demo1234";

/** Portraits come from randomuser.me, which serves a fixed set of openly-licensed face
 *  photographs at stable per-index URLs -- so the same five people come back every run
 *  rather than shuffling. They are downloaded once into public/ and then served locally,
 *  so the app never depends on the network at runtime. */
const DRIVERS = [
  { username: "driver.reza",    name: "رضا احمدی",    set: "men",   idx: 32, staff: "DRV-01", phone: "09121000001" },
  { username: "driver.saeed",   name: "سعید کریمی",   set: "men",   idx: 45, staff: "DRV-02", phone: "09121000002" },
  { username: "driver.maryam",  name: "مریم رضایی",   set: "women", idx: 26, staff: "DRV-03", phone: "09121000003" },
  { username: "driver.hossein", name: "حسین رستمی",   set: "men",   idx: 58, staff: "DRV-04", phone: "09121000004" },
  { username: "driver.zahra",   name: "زهرا موسوی",   set: "women", idx: 37, staff: "DRV-05", phone: "09121000005" },
];

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function ensureAvatar(d) {
  const file = path.join(AVATAR_DIR, `${d.username}.jpg`);
  const publicPath = `/avatars/${d.username}.jpg`;
  // Already on disk and non-empty: keep it, so a rerun needs no network.
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return publicPath;
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const url = `https://randomuser.me/api/portraits/${d.set}/${d.idx}.jpg`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 512) throw new Error(`suspiciously small image (${buf.length}B) from ${url}`);
  fs.writeFileSync(file, buf);
  return publicPath;
}


async function main() {
  const db = new DatabaseSync(DB_PATH);

  // Same rule as create-user.mjs: the app owns the schema, this script does not invent one.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  if (!tables.includes("users") || !tables.includes("groups")) {
    console.error(`[seed-demo-drivers] ${DB_PATH} has no users/groups table. Start the app once, then re-run.`);
    process.exit(1);
  }

  // The photo column is added by lib/db.ts's migration; add it here too so this script
  // works against a database the app has not re-opened since the column landed.
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols.includes("organization_id")) {
    console.error("[seed-demo-drivers] users.organization_id is missing. Start the app once so it can migrate, then re-run.");
    process.exit(1);
  }
  if (!cols.includes("avatar_url")) db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");

  const org = db.prepare("SELECT id, name FROM organizations WHERE active = 1 ORDER BY id LIMIT 1").get();
  if (!org) {
    console.error("[seed-demo-drivers] no active organization. Create the tenant first.");
    process.exit(1);
  }

  // Drivers are scoped to a group, and the group is what a group-manager's picker filters on.
  let group = db.prepare("SELECT id, name FROM groups WHERE active = 1 ORDER BY id LIMIT 1").get();
  if (!group) {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("رانندگان", "drivers", "#2E6382", now);
    group = db.prepare("SELECT id, name FROM groups WHERE active = 1 ORDER BY id LIMIT 1").get();
    console.log(`[seed-demo-drivers] created group ${group.name} (${group.id})`);
  }

  const now = new Date().toISOString();
  for (const d of DRIVERS) {
    const avatar = await ensureAvatar(d);
    db.prepare(
      `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id,
                          staff_code, phone, avatar_url, active, token_version, created_at)
       VALUES (?, ?, ?, 'driver', ?, ?, ?, ?, ?, 1, 0, ?)
       ON CONFLICT(username) DO UPDATE SET
         password_hash = excluded.password_hash,
         display_name  = excluded.display_name,
         role          = 'driver',
         group_id      = excluded.group_id,
         organization_id = excluded.organization_id,
         staff_code    = excluded.staff_code,
         phone         = excluded.phone,
         avatar_url    = excluded.avatar_url,
         active        = 1,
         -- Any change here must invalidate sessions already issued, or a re-seed would
         -- leave the previous password working for the rest of its 30 days.
         token_version = users.token_version + 1`
    ).run(d.username, hashPassword(PASSWORD), d.name, group.id, org.id, d.staff, d.phone, avatar, now);
    console.log(`[seed-demo-drivers] ${d.name} (${d.username}) — ${avatar}`);
  }

  console.log(`\n[seed-demo-drivers] ${DRIVERS.length} drivers ready in org "${org.name}", group "${group.name}".`);
  console.log(`[seed-demo-drivers] sign in as any of them with password: ${PASSWORD}`);
  db.close();
}

main().catch((e) => {
  console.error(`[seed-demo-drivers] failed: ${e.message}`);
  process.exit(1);
});
