import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-due-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { dueToday } = await import("@/lib/briefingSuggestions");
const { todayFor } = await import("@/lib/repo/briefing");
const { tehranTodayIso } = await import("@/lib/jalali");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const sig = (customerId: number, daysSinceLast: number, typicalGapDays: number) => ({ customerId, name: `م${customerId}`, phone: null, daysSinceLast, typicalGapDays });

describe("dueToday (F8)", () => {
  it("keeps customers between one and two usual gaps, without an open order, most overdue first", () => {
    const due = dueToday([sig(1, 6, 7), sig(2, 9, 7), sig(3, 15, 7), sig(4, 40, 30), sig(5, 14, 7), sig(6, 8, 7)], new Set([6]));
    expect(due.map((d) => d.customerId)).toEqual([5, 4, 2]);
  });
});

describe("the briefing's due-today panel", () => {
  it("lists the salesperson's due customers with a link to the quick order flow", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const seller = Number(
      db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('s','x','نازنین','phone_sales',1,?,1)").run(now).lastInsertRowid
    );
    const customer = (code: string, name: string) =>
      Number(db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES (?, ?, ?, 1)").run(code, name, now).lastInsertRowid);
    const weekly = customer("C1", "کافه هفتگی");
    const open = customer("C2", "کافه باز");
    const today = Date.parse(`${tehranTodayIso()}T00:00:00Z`);
    const day = (ago: number) => new Date(today - ago * 86_400_000).toISOString().slice(0, 10);
    let n = 0;
    const order = (c: number, ago: number, status = "DELIVERED") =>
      db.prepare(
        `INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id, salesperson_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
      ).run(`S-${++n}`, c, status, day(ago), seller, now, now, seller);
    for (const ago of [29, 22, 15, 8]) {
      order(weekly, ago);
      order(open, ago);
    }
    order(open, 0, "CONFIRMED");

    const s = { user: { id: seller } as never, role: "phone_sales", roles: ["phone_sales"], groupId: null, organizationId: 1, hasRole: () => false } as unknown as Session;
    const due = todayFor(s).panels.find((p) => p.key === "due_today")!;
    expect(due.items.map((i) => i.label)).toEqual(["کافه هفتگی"]);
    expect(due.items[0].href).toBe(`/sales/orders/new?customer=${weekly}&quick=1`);
    expect(due.items[0].sub).toContain("۷ روز");
  });
});
