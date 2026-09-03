import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-notif-flush-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
// Real VAPID keypair: web-push's setVapidDetails (called by configureWebPush) validates
// key length, so placeholder strings don't survive the config gate.
process.env.VAPID_PUBLIC_KEY = "BFWiwwb5DfLL_MysabPmu20nSz5q9FyiF50ojDhtf5tmLXmcwCX0da48WAAZDKF868kRHg6hNcRUHQIHyMb5maI";
process.env.VAPID_PRIVATE_KEY = "2bVFR1q4Om90wgUkI0Jmi5lfHPF_1WSM4qkpKuzJo50";
process.env.VAPID_SUBJECT = "mailto:x@x";
process.env.TELEGRAM_BOT_TOKEN = "t";

// The Bot API wrappers are the seam: a flush must never reach the network.
vi.mock("@/lib/telegram", () => ({
  telegramConfigured: () => true,
  sendTelegram: vi.fn(),
  editTelegram: vi.fn(),
}));

const { getDb } = await import("@/lib/db");
const { sendTelegram, editTelegram } = await import("@/lib/telegram");
const { webpush } = await import("@/lib/push");
const { flushNotifications } = await import("@/lib/repo/notifications");

const tgSend = vi.mocked(sendTelegram);
const tgEdit = vi.mocked(editTelegram);
const pushSend = vi.spyOn(webpush, "sendNotification");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const ORG = 1;
const CHAT = "55384695";
const MIN = 60_000;
/** Every case is anchored here and moves in whole minutes, so the 2-min debounce and the
 *  10-min edit window are crossed deliberately rather than by wall-clock luck. */
const T0 = Date.parse("2026-03-01T10:00:00.000Z");
const at = (ms: number) => new Date(ms).toISOString();
/** The same server-local HH:MM the flush computes, so quiet windows are TZ-independent. */
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false }).slice(0, 5);

const TITLE_A = "سفارش تأیید شد";
const TITLE_B = "تحویل ناموفق";

let uid = 0;

/** A pref row on both channels, so the cases do not ride on the catalogue defaults. */
function routeLoud(typeCode: string): void {
  const now = new Date().toISOString();
  for (const ch of ["push", "telegram"]) {
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO notification_prefs (user_id, type_code, channel, enabled, updated_at) VALUES (?,?,?,1,?)"
      )
      .run(uid, typeCode, ch, now);
  }
}

function addNotif(o: {
  type: string;
  group: string;
  title: string;
  body?: string | null;
  priority?: string;
  at: number;
}): number {
  return Number(
    getDb()
      .prepare(
        `INSERT INTO notifications
           (organization_id, user_id, type_code, title_fa, body_fa, group_key, priority, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(ORG, uid, o.type, o.title, o.body ?? null, o.group, o.priority ?? "NORMAL", at(o.at)).lastInsertRowid
  );
}

function connectPush(): number {
  return Number(
    getDb()
      .prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, user_id) VALUES (?,?,?,?,?)")
      .run("https://push.example/e1", "p", "a", new Date().toISOString(), uid).lastInsertRowid
  );
}

function setQuiet(channel: "push" | "telegram", start: string, end: string, criticalBreaks: 0 | 1): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO notification_channels
         (user_id, channel, enabled, quiet_start, quiet_end, critical_breaks_quiet, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`
    )
    .run(uid, channel, start, end, criticalBreaks, new Date().toISOString());
}

function unflushed(col: "push_flushed_at" | "tg_flushed_at"): number {
  return (getDb().prepare(`SELECT COUNT(*) c FROM notifications WHERE ${col} IS NULL`).get() as { c: number }).c;
}
function subCount(): number {
  return (getDb().prepare("SELECT COUNT(*) c FROM push_subscriptions").get() as { c: number }).c;
}
function deliveries(): { id: number; channel: string; flushed_at: string; notification_ids_json: string; provider_ref: string | null; target: string | null }[] {
  return getDb()
    .prepare("SELECT id, channel, flushed_at, notification_ids_json, provider_ref, target FROM notification_deliveries ORDER BY id")
    .all() as { id: number; channel: string; flushed_at: string; notification_ids_json: string; provider_ref: string | null; target: string | null }[];
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM users WHERE id>0; DELETE FROM notifications; DELETE FROM notification_prefs; DELETE FROM notification_channels; DELETE FROM notification_deliveries; DELETE FROM push_subscriptions; PRAGMA foreign_keys=ON;"
  );
  uid = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES (?, 'x:y', 'ک', 'salesperson', 1, ?, 1)"
      )
      .run(`u${Date.now()}${Math.random().toString(36).slice(2)}`, new Date().toISOString()).lastInsertRowid
  );
  db.prepare("UPDATE users SET telegram_chat_id = ? WHERE id = ?").run(CHAT, uid);
  for (const t of ["order.confirmed", "delivery.failed", "task.escalated"]) routeLoud(t);

  vi.clearAllMocks();
  tgSend.mockResolvedValue({ message_id: 777 });
  tgEdit.mockResolvedValue(true);
  pushSend.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
});

describe("flushNotifications", () => {
  it("debounces a fresh burst, then flushes it as one message", async () => {
    addNotif({ type: "order.confirmed", group: "order:1", title: TITLE_A, at: T0 });
    addNotif({ type: "delivery.failed", group: "order:2", title: TITLE_B, at: T0 });

    const early = await flushNotifications(ORG, at(T0 + 30_000));
    expect(early).toEqual({ sent: 0, edited: 0, held: 0 });
    expect(tgSend).not.toHaveBeenCalled();
    expect(unflushed("tg_flushed_at")).toBe(2);

    const late = await flushNotifications(ORG, at(T0 + 3 * MIN));
    expect(late).toEqual({ sent: 1, edited: 0, held: 0 });
    expect(tgSend).toHaveBeenCalledTimes(1);
    expect(tgSend.mock.calls[0][0]).toBe(CHAT);
    const text = tgSend.mock.calls[0][1];
    expect(text).toContain(TITLE_A);
    expect(text).toContain(TITLE_B);
    expect(unflushed("tg_flushed_at")).toBe(0);

    const d = deliveries();
    expect(d.length).toBe(1);
    expect(d[0]).toMatchObject({ channel: "telegram", provider_ref: "777", target: CHAT, flushed_at: at(T0 + 3 * MIN) });
  });

  it("bundles by group_key into one digest: counts, ` · ` join, and the 4-group cap", async () => {
    addNotif({ type: "order.confirmed", group: "order:1", title: TITLE_A, at: T0 });
    addNotif({ type: "order.confirmed", group: "order:1", title: TITLE_A, at: T0 });
    addNotif({ type: "delivery.failed", group: "order:2", title: TITLE_B, body: "سفارش ب", at: T0 });
    for (const g of ["order:3", "order:4", "order:5", "order:6"]) {
      addNotif({ type: "delivery.failed", group: g, title: TITLE_B, at: T0 });
    }

    const r = await flushNotifications(ORG, at(T0 + 3 * MIN));
    expect(r).toEqual({ sent: 1, edited: 0, held: 0 });
    expect(tgSend).toHaveBeenCalledTimes(1);
    // 6 groups -> the first 4 lines, then the overflow tail. A group of 2 leads with «۲ »;
    // a group of 1 is its own title (+ « — body» when it has one).
    expect(tgSend.mock.calls[0][1]).toBe(
      `۲ ${TITLE_A} · ${TITLE_B} — سفارش ب · ${TITLE_B} · ${TITLE_B} · و ۲ مورد دیگر`
    );
  });

  it("edits the last message in place inside the edit window and unions the ids", async () => {
    const a = addNotif({ type: "order.confirmed", group: "order:1", title: TITLE_A, at: T0 });
    await flushNotifications(ORG, at(T0 + 3 * MIN));
    expect(tgSend).toHaveBeenCalledTimes(1);

    const b = addNotif({ type: "delivery.failed", group: "order:2", title: TITLE_B, at: T0 + 3 * MIN });
    const r = await flushNotifications(ORG, at(T0 + 8 * MIN));

    expect(r).toEqual({ sent: 0, edited: 1, held: 0 });
    expect(tgSend).toHaveBeenCalledTimes(1); // no second fresh send
    expect(tgEdit).toHaveBeenCalledTimes(1);
    expect(tgEdit.mock.calls[0][0]).toBe(CHAT);
    expect(tgEdit.mock.calls[0][1]).toBe(777);
    expect(tgEdit.mock.calls[0][2]).toContain(TITLE_B);

    const d = deliveries();
    expect(d.length).toBe(1); // updated, not appended
    expect((JSON.parse(d[0].notification_ids_json) as number[]).sort()).toEqual([a, b].sort());
    expect(d[0].flushed_at).toBe(at(T0 + 8 * MIN));
    expect(unflushed("tg_flushed_at")).toBe(0);
  });

  it("sends a fresh message once the last delivery is older than the edit window", async () => {
    addNotif({ type: "order.confirmed", group: "order:1", title: TITLE_A, at: T0 });
    await flushNotifications(ORG, at(T0 + 3 * MIN));

    addNotif({ type: "delivery.failed", group: "order:2", title: TITLE_B, at: T0 + 3 * MIN });
    const r = await flushNotifications(ORG, at(T0 + 14 * MIN)); // 11 min after the delivery row

    expect(r).toEqual({ sent: 1, edited: 0, held: 0 });
    expect(tgEdit).not.toHaveBeenCalled();
    expect(tgSend).toHaveBeenCalledTimes(2);
    expect(deliveries().length).toBe(2);
  });

  it("holds a batch during quiet hours and releases it after quiet_end", async () => {
    const T = T0 + 3 * MIN;
    setQuiet("telegram", hhmm(T - 60 * MIN), hhmm(T + 60 * MIN), 1);
    addNotif({ type: "order.confirmed", group: "order:1", title: TITLE_A, at: T0 });
    addNotif({ type: "delivery.failed", group: "order:2", title: TITLE_B, at: T0 });

    const quiet = await flushNotifications(ORG, at(T));
    expect(quiet).toEqual({ sent: 0, edited: 0, held: 2 });
    expect(tgSend).not.toHaveBeenCalled();
    expect(unflushed("tg_flushed_at")).toBe(2);
    expect(deliveries().length).toBe(0);

    const released = await flushNotifications(ORG, at(T + 120 * MIN));
    expect(released).toEqual({ sent: 1, edited: 0, held: 0 });
    expect(tgSend).toHaveBeenCalledTimes(1);
    expect(unflushed("tg_flushed_at")).toBe(0);
  });

  it("lets a CRITICAL row break quiet hours, but only when critical_breaks_quiet is on", async () => {
    const T = T0 + 3 * MIN;
    setQuiet("telegram", hhmm(T - 60 * MIN), hhmm(T + 60 * MIN), 1);
    addNotif({ type: "order.confirmed", group: "order:1", title: TITLE_A, at: T0 });
    addNotif({ type: "task.escalated", group: "task:9", title: "کار فوری", priority: "CRITICAL", at: T0 });

    const r = await flushNotifications(ORG, at(T));
    expect(r).toEqual({ sent: 1, edited: 0, held: 0 });
    expect(tgSend).toHaveBeenCalledTimes(1);
    expect(unflushed("tg_flushed_at")).toBe(0);

    // Same window, same CRITICAL priority, but the escape hatch switched off -> held.
    setQuiet("telegram", hhmm(T - 60 * MIN), hhmm(T + 60 * MIN), 0);
    addNotif({ type: "task.escalated", group: "task:10", title: "کار فوری", priority: "CRITICAL", at: T });
    const held = await flushNotifications(ORG, at(T + 3 * MIN));
    expect(held).toEqual({ sent: 0, edited: 0, held: 1 });
    expect(tgSend).toHaveBeenCalledTimes(1);
    expect(unflushed("tg_flushed_at")).toBe(1);
  });

  it("deletes a subscription on a 410 and leaves push_flushed_at NULL", async () => {
    connectPush();
    pushSend.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    addNotif({ type: "delivery.failed", group: "order:1", title: TITLE_B, at: T0 });

    const r = await flushNotifications(ORG, at(T0 + 3 * MIN));

    expect(pushSend).toHaveBeenCalledTimes(1);
    expect(pushSend.mock.calls[0][0]).toEqual({
      endpoint: "https://push.example/e1",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(JSON.parse(String(pushSend.mock.calls[0][1]))).toMatchObject({
      tag: "kargah-digest",
      url: "/notifications",
      body: TITLE_B,
    });
    expect(subCount()).toBe(0); // the dead endpoint is gone
    expect(unflushed("push_flushed_at")).toBe(1); // nothing landed on push
    expect(deliveries().every((d) => d.channel !== "push")).toBe(true);
    // telegram is independent and still went out
    expect(r).toEqual({ sent: 1, edited: 0, held: 0 });
    expect(unflushed("tg_flushed_at")).toBe(0);
  });

  it("stamps flushed_at per channel: telegram connected, push not", async () => {
    addNotif({ type: "order.confirmed", group: "order:1", title: TITLE_A, at: T0 });

    const r = await flushNotifications(ORG, at(T0 + 3 * MIN));

    expect(r).toEqual({ sent: 1, edited: 0, held: 0 });
    expect(pushSend).not.toHaveBeenCalled();
    expect(unflushed("push_flushed_at")).toBe(1);
    expect(unflushed("tg_flushed_at")).toBe(0);
    expect(deliveries().map((d) => d.channel)).toEqual(["telegram"]);
  });
});
