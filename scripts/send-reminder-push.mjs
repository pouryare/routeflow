#!/usr/bin/env node
// Daily nudge: if there are unresolved reminders due today or earlier, push one
// notification to every subscribed device. Run standalone (not through Next.js), so
// it reads DB path + VAPID keys straight from process.env the way systemd's
// EnvironmentFile= injects them, mirroring scripts/backup.mjs's own conventions.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.COVERAGE_DB_PATH || path.join(ROOT, "data", "coverage.db");

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT;

if (!publicKey || !privateKey || !subject) {
  console.log("[reminder-push] VAPID keys not configured, skipping");
  process.exit(0);
}
webpush.setVapidDetails(subject, publicKey, privateKey);

const db = new DatabaseSync(DB_PATH);
const today = new Date().toISOString().slice(0, 10);

const dueCount = db
  .prepare("SELECT COUNT(*) as n FROM reminders WHERE resolved = 0 AND due_date <= ?")
  .get(today).n;

if (dueCount === 0) {
  console.log("[reminder-push] no due reminders, skipping");
  process.exit(0);
}

const subs = db.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions").all();
if (subs.length === 0) {
  console.log("[reminder-push] no subscribers, skipping");
  process.exit(0);
}

const payload = JSON.stringify({
  title: "یادآوری‌های معوق",
  body: `${dueCount} یادآوری معوق دارید.`,
  url: "/",
});

let sent = 0;
let removed = 0;
for (const sub of subs) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload
    );
    sent++;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
      removed++;
    } else {
      console.error(`[reminder-push] failed for subscription ${sub.id}:`, err.message);
    }
  }
}

console.log(`[reminder-push] ${dueCount} due, sent ${sent}/${subs.length}, removed ${removed} expired`);
db.close();
