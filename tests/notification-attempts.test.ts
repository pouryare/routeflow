import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.SESSION_SECRET = "test-secret";
process.env.VAPID_PUBLIC_KEY = "BFWiwwb5DfLL_MysabPmu20nSz5q9FyiF50ojDhtf5tmLXmcwCX0da48WAAZDKF868kRHg6hNcRUHQIHyMb5maI";
process.env.VAPID_PRIVATE_KEY = "2bVFR1q4Om90wgUkI0Jmi5lfHPF_1WSM4qkpKuzJo50";
process.env.VAPID_SUBJECT = "mailto:x@x";
process.env.TELEGRAM_BOT_TOKEN = "t";
vi.mock("@/lib/telegram", () => ({ telegramConfigured: () => true, sendTelegram: vi.fn(), editTelegram: vi.fn() }));

const { getDb } = await import("@/lib/db");
const { sendTelegram } = await import("@/lib/telegram");
const { webpush } = await import("@/lib/push");
const { flushNotifications, recentAttempts } = await import("@/lib/repo/notifications");
const tgSend = vi.mocked(sendTelegram);
const pushSend = vi.spyOn(webpush, "sendNotification");

const T0 = Date.parse("2026-03-01T10:00:00.000Z");
let uid = 0;

beforeEach(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  uid = Number((await db.prepare("INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id, telegram_chat_id) VALUES (?, 'x:y', 'کاربر', 'phone_sales', 1, ?, 1, '5')").run(`fb20${Math.random().toString(36).slice(2)}`, now)).lastInsertRowid);
  for (const ch of ["push", "telegram"]) await db.prepare("INSERT INTO notification_prefs (user_id, type_code, channel, enabled, updated_at) VALUES (?, 'order.confirmed', ?, 1, ?)").run(uid, ch, now);
  await db.prepare("INSERT INTO notifications (organization_id, user_id, type_code, title_fa, group_key, priority, created_at) VALUES (1, ?, 'order.confirmed', 'سفارش', 'order:1', 'NORMAL', ?)").run(uid, new Date(T0).toISOString());
  vi.clearAllMocks();
});

describe("FB20 delivery attempts", () => {
  it("records a failed telegram try, then a good one; a person with no device logs nothing for push", async () => {
    tgSend.mockResolvedValueOnce(null as never);
    await flushNotifications(1, new Date(T0 + 3 * 60_000).toISOString());
    let rows = (await recentAttempts(1)).filter((r) => r.userName === "کاربر");
    expect(rows.map((r) => `${r.channel}:${r.ok}`)).toEqual(["telegram:false"]);
    expect(rows[0].error).toMatch(/تلگرام/);
    tgSend.mockResolvedValueOnce({ message_id: 9 });
    await flushNotifications(1, new Date(T0 + 8 * 60_000).toISOString());
    rows = (await recentAttempts(1)).filter((r) => r.userName === "کاربر");
    expect(rows.map((r) => `${r.channel}:${r.ok}`)).toEqual(["telegram:true", "telegram:false"]);
  });

  it("records a push that reached no device, with the reason", async () => {
    await getDb().prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, user_id) VALUES ('https://push.example/x', 'p', 'a', ?, ?)").run(new Date().toISOString(), uid);
    tgSend.mockResolvedValue({ message_id: 1 });
    pushSend.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    await flushNotifications(1, new Date(T0 + 3 * 60_000).toISOString());
    const push = (await recentAttempts(1)).find((r) => r.channel === "push" && r.userName === "کاربر");
    expect(push).toMatchObject({ ok: false, messageCount: 1 });
    expect(push!.error).toContain("500");
  });
});
