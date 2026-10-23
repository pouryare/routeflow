import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-digest-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { digestBody } = await import("@/lib/morningDigest");
const { queueMorningDigests } = await import("@/lib/repo/morningDigest");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

describe("digestBody (F16)", () => {
  it("counts each panel's work, including what the panel cut off", () => {
    const body = digestBody(
      [
        { key: "unplanned", title: "سفارش‌های بی‌مسیر", items: [{ label: "a" }, { label: "b" }], more: 3 },
        { key: "exceptions", title: "هشدارها", items: [{ label: "c" }] },
      ],
      "این هفته تا امروز: ۲ سفارش تأییدشده"
    );
    expect(body).toBe("سفارش‌های بی‌مسیر: ۵ · هشدارها: ۱ · این هفته تا امروز: ۲ سفارش تأییدشده");
    expect(digestBody([], null)).toBe("امروز کاری منتظر شما نیست.");
  });
});

describe("queueMorningDigests", () => {
  it("queues one digest per owner per Tehran day, from 07:00, and only for that company's owners", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'دیگر', 'other', ?) ON CONFLICT DO NOTHING").run(now);
    const user = db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,'x',?,?,?,?,?)");
    const owner = Number((await user.run("o1", "مالک", "owner", 1, now, 1)).lastInsertRowid);
    await user.run("o0", "مالک قبلی", "owner", 0, now, 1);
    await user.run("s1", "فروشنده", "phone_sales", 1, now, 1);
    await user.run("o2", "مالک دیگر", "owner", 1, now, 2);
    const customer = Number((await db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('C1', 'م', ?, 1)").run(now)).lastInsertRowid);
    await db.prepare(
      `INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id, total_toman)
       VALUES ('S-1', ?, 'CONFIRMED', '2026-10-20', ?, ?, ?, 1, 100)`
    ).run(customer, owner, now, now);

    // 06:30 Tehran is 03:00 UTC: too early.
    expect(await queueMorningDigests(1, "2026-10-20T03:00:00Z")).toBe(0);
    // 07:30 Tehran.
    expect(await queueMorningDigests(1, "2026-10-20T04:00:00Z")).toBe(1);
    expect(await queueMorningDigests(1, "2026-10-20T08:00:00Z")).toBe(0);
    const rows = await db.prepare("SELECT user_id, type_code, title_fa, body_fa FROM notifications WHERE type_code = 'owner.digest'").all() as {
      user_id: number; body_fa: string; title_fa: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(owner);
    expect(rows[0].title_fa).toBe("خلاصهٔ صبح");
    expect(rows[0].body_fa).toContain("سفارش‌های بی‌مسیر: ۱");
    // The next day is a new digest.
    expect(await queueMorningDigests(1, "2026-10-21T04:00:00Z")).toBe(1);
    // The catalogue carries the type, so the owner can turn it off in notification settings.
    const t = await db.prepare("SELECT default_push, default_telegram FROM notification_types WHERE code = 'owner.digest' AND organization_id IS NULL").get() as { default_push: number; default_telegram: number };
    expect(t).toEqual({ default_push: 1, default_telegram: 1 });
  });
});
