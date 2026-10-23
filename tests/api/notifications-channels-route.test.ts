import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Only `sendTelegram` is faked -- `telegramConfigured` must stay real because these tests
// drive it through process.env. Without this a "sent" outcome would need a live network
// call to api.telegram.org.
const sentMessages: { chatId: string; text: string }[] = [];
vi.mock("@/lib/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telegram")>()),
  sendTelegram: vi.fn(async (chatId: string, text: string) => {
    sentMessages.push({ chatId, text });
    return { message_id: 4242 };
  }),
}));

const testDbPath = path.join(
  os.tmpdir(),
  `rf-notif-channels-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { PUT: putChannels } = await import("@/app/api/notifications/channels/route");
const { GET: getPrefs } = await import("@/app/api/notifications/prefs/route");
const { POST: linkTelegram, DELETE: unlinkTelegram } = await import(
  "@/app/api/notifications/telegram-link/route"
);
const { POST: postTest } = await import("@/app/api/notifications/test/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let seller = 0;
let sellerToken = "";

function req(url: string, method: string, token: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { cookie: `${COOKIE_NAME}=${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM notification_prefs; DELETE FROM notification_channels; DELETE FROM notification_deliveries; DELETE FROM notifications; DELETE FROM push_subscriptions; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  seller = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
      )
      .run(`s${Date.now()}${Math.random()}`, "x:y", "ف", "phone_sales", now)).lastInsertRowid
  );
  sellerToken = createSessionToken({ uid: seller, role: "phone_sales", gid: null, oid: 1, tv: 0, name: "ف" });
});

afterEach(() => {
  sentMessages.length = 0;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_USERNAME;
});

describe("PUT /api/notifications/channels", () => {
  it("401 without a valid session", async () => {
    const res = await putChannels(req("/api/notifications/channels", "PUT", "nonsense", { channel: "push" }));
    expect(res.status).toBe(401);
  });

  it("stores a quiet-hours window that a follow-up prefs GET reflects", async () => {
    const res = await putChannels(
      req("/api/notifications/channels", "PUT", sellerToken, {
        channel: "push",
        quiet_start: "22:00",
        quiet_end: "07:00",
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const json = await (await getPrefs(req("/api/notifications/prefs", "GET", sellerToken))).json();
    expect(json.channels.push.quiet_start).toBe("22:00");
    expect(json.channels.push.quiet_end).toBe("07:00");
    expect(json.channels.push.enabled).toBe(true);
  });

  it("patches only the keys present in the body", async () => {
    await putChannels(
      req("/api/notifications/channels", "PUT", sellerToken, {
        channel: "telegram",
        quiet_start: "22:00",
        quiet_end: "07:00",
      })
    );
    const res = await putChannels(
      req("/api/notifications/channels", "PUT", sellerToken, { channel: "telegram", enabled: false })
    );
    expect(res.status).toBe(200);
    const json = await (await getPrefs(req("/api/notifications/prefs", "GET", sellerToken))).json();
    expect(json.channels.telegram.enabled).toBe(false);
    expect(json.channels.telegram.quiet_start).toBe("22:00");
  });

  it("400 on a malformed quiet_start", async () => {
    const res = await putChannels(
      req("/api/notifications/channels", "PUT", sellerToken, { channel: "push", quiet_start: "7" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
    const n = (
      await getDb().prepare("SELECT COUNT(*) c FROM notification_channels WHERE user_id = ?").get(seller) as { c: number }
    ).c;
    expect(n).toBe(0);
  });

  it("400 on a channel outside {push, telegram}", async () => {
    const res = await putChannels(req("/api/notifications/channels", "PUT", sellerToken, { channel: "sms" }));
    expect(res.status).toBe(400);
  });

  it("400 on a missing body", async () => {
    const res = await putChannels(req("/api/notifications/channels", "PUT", sellerToken));
    expect(res.status).toBe(400);
  });
});

describe("/api/notifications/telegram-link", () => {
  it("401 without a valid session", async () => {
    const res = await linkTelegram(req("/api/notifications/telegram-link", "POST", "nonsense"));
    expect(res.status).toBe(401);
  });

  it("POST mints a nonce and returns a t.me deep link", async () => {
    process.env.TELEGRAM_BOT_USERNAME = "meridian_test_bot";
    const res = await linkTelegram(req("/api/notifications/telegram-link", "POST", sellerToken));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(typeof json.url).toBe("string");
    expect(json.url.startsWith("https://t.me/")).toBe(true);
    const row = await getDb().prepare("SELECT telegram_link_nonce FROM users WHERE id = ?").get(seller) as {
      telegram_link_nonce: string | null;
    };
    expect(row.telegram_link_nonce).toBeTruthy();
    expect(json.url).toContain(row.telegram_link_nonce as string);
  });

  it("POST 400s when TELEGRAM_BOT_USERNAME is unset instead of throwing", async () => {
    const res = await linkTelegram(req("/api/notifications/telegram-link", "POST", sellerToken));
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });

  it("DELETE clears telegram_chat_id and the pending nonce", async () => {
    await getDb()
      .prepare("UPDATE users SET telegram_chat_id = ?, telegram_link_nonce = ? WHERE id = ?")
      .run("55384695", "abc", seller);
    const res = await unlinkTelegram(req("/api/notifications/telegram-link", "DELETE", sellerToken));
    expect(res.status).toBe(200);
    const row = await getDb()
      .prepare("SELECT telegram_chat_id, telegram_link_nonce FROM users WHERE id = ?")
      .get(seller) as { telegram_chat_id: string | null; telegram_link_nonce: string | null };
    expect(row.telegram_chat_id).toBe(null);
    expect(row.telegram_link_nonce).toBe(null);
  });
});

describe("POST /api/notifications/test", () => {
  it("401 without a valid session", async () => {
    const res = await postTest(req("/api/notifications/test", "POST", "nonsense", { channel: "telegram" }));
    expect(res.status).toBe(401);
  });

  it("400 on a channel outside {push, telegram}", async () => {
    const res = await postTest(req("/api/notifications/test", "POST", sellerToken, { channel: "sms" }));
    expect(res.status).toBe(400);
  });

  it("400 when the channel is not configured on the server", async () => {
    const res = await postTest(req("/api/notifications/test", "POST", sellerToken, { channel: "telegram" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("پیکربندی");
  });

  it("400 when the channel is configured but the user is not connected", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const res = await postTest(req("/api/notifications/test", "POST", sellerToken, { channel: "telegram" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("متصل");
  });

  it("writes a system.test row, flushes past the debounce, and reports the held/sent tuple", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const db = getDb();
    await db.prepare("UPDATE users SET telegram_chat_id = ? WHERE id = ?").run("55384695", seller);
    // An all-day quiet window: the flush must hold rather than attempt a real send.
    await db.prepare(
      `INSERT INTO notification_channels (user_id, channel, enabled, quiet_start, quiet_end, critical_breaks_quiet, updated_at)
       VALUES (?, 'telegram', 1, '00:01', '00:00', 1, ?)`
    ).run(seller, new Date().toISOString());

    const res = await postTest(req("/api/notifications/test", "POST", sellerToken, { channel: "telegram" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result.channel).toBe("telegram");
    expect(json.result.status).toBe("held");
    expect(json.org.sent).toBe(0);
    expect(json.org.held).toBe(1);

    const n = (
      await db
        .prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND type_code = 'system.test'")
        .get(seller) as { c: number }
    ).c;
    expect(n).toBe(1);
    // Held, so the channel stamp stays NULL and the next sweep retries it.
    const stamp = await db
      .prepare("SELECT tg_flushed_at FROM notifications WHERE user_id = ? LIMIT 1")
      .get(seller) as { tg_flushed_at: string | null };
    expect(stamp.tg_flushed_at).toBe(null);
  });

  it("reports the CALLER's own outcome, not the org-wide flush total", async () => {
    // The regression: `flushNotifications` is org-wide and the asOf shift makes its
    // debounce guard unsatisfiable for everyone, so a coworker's backlog goes out on this
    // same call. If the route reported the org tuple, the caller would read `sent: 1` while
    // their own test was held by their own quiet hours.
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const db = getDb();
    const now = new Date().toISOString();

    // The caller: connected, but inside an all-day quiet window -> must be HELD.
    await db.prepare("UPDATE users SET telegram_chat_id = ? WHERE id = ?").run("55384695", seller);
    await db.prepare(
      `INSERT INTO notification_channels (user_id, channel, enabled, quiet_start, quiet_end, critical_breaks_quiet, updated_at)
       VALUES (?, 'telegram', 1, '00:01', '00:00', 1, ?)`
    ).run(seller, now);

    // A coworker in the same org: connected, no quiet hours, one pending loud row.
    const other = Number(
      (await db
        .prepare(
          "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id,telegram_chat_id) VALUES (?,?,?,?,1,?,1,?)"
        )
        .run(`o${Date.now()}${Math.random()}`, "x:y", "هم‌کار", "phone_sales", now, "55384696")).lastInsertRowid
    );
    await db.prepare(
      `INSERT INTO notifications (organization_id, user_id, type_code, title_fa, group_key, priority, created_at)
       VALUES (1, ?, 'task.assigned', 'کار جدید', 'task:1', 'HIGH', ?)`
    ).run(other, now);

    const res = await postTest(req("/api/notifications/test", "POST", sellerToken, { channel: "telegram" }));
    expect(res.status).toBe(200);
    const json = await res.json();

    // The org-wide flush really did send -- to the coworker.
    expect(json.org.sent).toBe(1);
    expect(sentMessages.map((m) => m.chatId)).toEqual(["55384696"]);
    // ...but the caller's own answer must be "held", never the org total.
    expect(json.result.channel).toBe("telegram");
    expect(json.result.status).toBe("held");

    // And the caller's own row is genuinely still unflushed.
    const mine = await db
      .prepare("SELECT tg_flushed_at FROM notifications WHERE user_id = ? AND type_code = 'system.test'")
      .get(seller) as { tg_flushed_at: string | null };
    expect(mine.tg_flushed_at).toBe(null);
  });

  it("carries the catalogue priority rather than a hardcoded literal", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const db = getDb();
    await db.prepare("UPDATE users SET telegram_chat_id = ? WHERE id = ?").run("55384695", seller);
    await db.prepare(
      `INSERT INTO notification_channels (user_id, channel, enabled, quiet_start, quiet_end, critical_breaks_quiet, updated_at)
       VALUES (?, 'telegram', 1, '00:01', '00:00', 1, ?)`
    ).run(seller, new Date().toISOString());
    // A tenant override wins over the NULL-org seed, exactly as `catalogueRow` resolves it.
    await db.prepare(
      `INSERT INTO notification_types
         (organization_id, code, name_fa, category, directedness, priority, group_scope, default_push, default_telegram, active, created_at, updated_at)
       VALUES (1, 'system.test', 'پیام آزمایشی', 'task', 'directed', 'CRITICAL', 'entity', 1, 1, 1, ?, ?)`
    ).run(new Date().toISOString(), new Date().toISOString());

    await postTest(req("/api/notifications/test", "POST", sellerToken, { channel: "telegram" }));
    const row = await db
      .prepare("SELECT priority FROM notifications WHERE user_id = ? AND type_code = 'system.test'")
      .get(seller) as { priority: string };
    expect(row.priority).toBe("CRITICAL");

    await db.prepare("DELETE FROM notification_types WHERE organization_id = 1 AND code = 'system.test'").run();
  });

  it("rate-limits a second test within the window", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const db = getDb();
    await db.prepare("UPDATE users SET telegram_chat_id = ? WHERE id = ?").run("55384695", seller);
    await db.prepare(
      `INSERT INTO notification_channels (user_id, channel, enabled, quiet_start, quiet_end, critical_breaks_quiet, updated_at)
       VALUES (?, 'telegram', 1, '00:01', '00:00', 1, ?)`
    ).run(seller, new Date().toISOString());

    const first = await postTest(req("/api/notifications/test", "POST", sellerToken, { channel: "telegram" }));
    expect(first.status).toBe(200);
    const second = await postTest(req("/api/notifications/test", "POST", sellerToken, { channel: "telegram" }));
    expect(second.status).toBe(429);
    expect((await second.json()).ok).toBe(false);
  });

  it("a 400 pre-check does not burn the caller's rate-limit slot", async () => {
    const blocked = await postTest(req("/api/notifications/test", "POST", sellerToken, { channel: "telegram" }));
    expect(blocked.status).toBe(400);
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const db = getDb();
    await db.prepare("UPDATE users SET telegram_chat_id = ? WHERE id = ?").run("55384695", seller);
    await db.prepare(
      `INSERT INTO notification_channels (user_id, channel, enabled, quiet_start, quiet_end, critical_breaks_quiet, updated_at)
       VALUES (?, 'telegram', 1, '00:01', '00:00', 1, ?)`
    ).run(seller, new Date().toISOString());
    const ok = await postTest(req("/api/notifications/test", "POST", sellerToken, { channel: "telegram" }));
    expect(ok.status).toBe(200);
  });
});
