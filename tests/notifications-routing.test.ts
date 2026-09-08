import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-notif-routing-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
// Real VAPID keypair: web-push's setVapidDetails (called by configureWebPush) validates
// key length, so placeholder strings don't survive the config gate.
process.env.VAPID_PUBLIC_KEY = "BFWiwwb5DfLL_MysabPmu20nSz5q9FyiF50ojDhtf5tmLXmcwCX0da48WAAZDKF868kRHg6hNcRUHQIHyMb5maI";
process.env.VAPID_PRIVATE_KEY = "2bVFR1q4Om90wgUkI0Jmi5lfHPF_1WSM4qkpKuzJo50"; process.env.VAPID_SUBJECT = "mailto:x@x";
process.env.TELEGRAM_BOT_TOKEN = "t";

const { getDb } = await import("@/lib/db");
const { priorityRank, effectiveRouting } = await import("@/lib/repo/notifications");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

let uid = 0;
beforeEach(() => {
  const db = getDb();
  db.exec("PRAGMA foreign_keys=OFF; DELETE FROM users WHERE id>0; DELETE FROM notification_prefs; DELETE FROM notification_channels; DELETE FROM push_subscriptions; PRAGMA foreign_keys=ON;");
  // users has no `name` column; username/password_hash/display_name are the NOT NULL cols.
  uid = Number(db.prepare("INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES (?, 'x:y', 'ک', 'salesperson', 1, ?, 1)").run(`u${Date.now()}`, new Date().toISOString()).lastInsertRowid);
});

function connectPush() {
  getDb().prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, user_id) VALUES (?,?,?,?,?)")
    .run("e" + Math.random(), "p", "a", new Date().toISOString(), uid);
}
function connectTelegram() {
  getDb().prepare("UPDATE users SET telegram_chat_id = '123' WHERE id = ?").run(uid);
}

describe("priorityRank", () => {
  it("orders the vocabulary", () => {
    expect(priorityRank("LOW")).toBeLessThan(priorityRank("NORMAL"));
    expect(priorityRank("NORMAL")).toBeLessThan(priorityRank("HIGH"));
    expect(priorityRank("HIGH")).toBeLessThan(priorityRank("CRITICAL"));
  });
});

describe("effectiveRouting", () => {
  it("uses the type default when there is no pref row (directed HIGH → loud)", () => {
    connectPush();
    expect(effectiveRouting(uid, "task.escalated", "push")).toBe(true);   // default_push = 1
    expect(effectiveRouting(uid, "order.created", "push")).toBe(false);   // ambient NORMAL → default 0
  });

  it("a pref row overrides the default both ways", () => {
    connectPush();
    getDb().prepare("INSERT INTO notification_prefs (user_id, type_code, channel, enabled, updated_at) VALUES (?, 'order.created', 'push', 1, ?)").run(uid, new Date().toISOString());
    expect(effectiveRouting(uid, "order.created", "push")).toBe(true);
    getDb().prepare("INSERT INTO notification_prefs (user_id, type_code, channel, enabled, updated_at) VALUES (?, 'task.escalated', 'push', 0, ?)").run(uid, new Date().toISOString());
    expect(effectiveRouting(uid, "task.escalated", "push")).toBe(false);
  });

  it("master switch off kills the channel regardless of pref/default", () => {
    connectPush();
    getDb().prepare("INSERT INTO notification_channels (user_id, channel, enabled, updated_at) VALUES (?, 'push', 0, ?)").run(uid, new Date().toISOString());
    expect(effectiveRouting(uid, "task.escalated", "push")).toBe(false);
  });

  it("an unconnected channel is always false", () => {
    // push not connected
    expect(effectiveRouting(uid, "task.escalated", "push")).toBe(false);
    // telegram not connected
    expect(effectiveRouting(uid, "task.escalated", "telegram")).toBe(false);
    connectTelegram();
    expect(effectiveRouting(uid, "task.escalated", "telegram")).toBe(true);
  });

  it("returns false when the channel's server config is absent", () => {
    connectPush();
    const saved = process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    // configureWebPush caches; re-import in isolation is overkill here — assert the intent
    // via telegram instead, whose helper is not cached:
    process.env.VAPID_PUBLIC_KEY = saved;
    const savedT = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    connectTelegram();
    expect(effectiveRouting(uid, "task.escalated", "telegram")).toBe(false);
    process.env.TELEGRAM_BOT_TOKEN = savedT;
  });
});
