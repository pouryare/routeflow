import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Session } from "@/lib/session";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-week-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { weekWindows, changePercent } = await import("@/lib/weekCompare");
const { weekVsLast } = await import("@/lib/repo/weekCompare");
const { default: WeekCompareCard } = await import("@/components/today/WeekCompareCard");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const sess = (id: number, role: string, org = 1): Session =>
  ({ user: { id } as never, role: role as never, groupId: null, organizationId: org, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

describe("weekWindows (F67)", () => {
  it("runs from Saturday and sets the same days of last week against it", () => {
    // 2026-10-20 is a Tuesday: Saturday 17th to Tuesday, against 10th to 13th.
    expect(weekWindows("2026-10-20")).toEqual({
      thisWeek: { from: "2026-10-17", toExcl: "2026-10-21" },
      lastWeek: { from: "2026-10-10", toExcl: "2026-10-14" },
      days: 4,
    });
    expect(weekWindows("2026-10-23").days).toBe(7); // Friday
    expect(weekWindows("2026-10-17").thisWeek).toEqual({ from: "2026-10-17", toExcl: "2026-10-18" });
  });

  it("gives no percent against a zero week", () => {
    expect(changePercent(5, 0)).toBeNull();
    expect(changePercent(15, 10)).toBe(50);
    expect(changePercent(5, 10)).toBe(-50);
  });
});

describe("weekVsLast", () => {
  it("counts confirmed orders, sales, deliveries and payments in each window, in the owner's company only", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const owner = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('o','x','مالک','owner',1,?,1)").run(now)).lastInsertRowid);
    await db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'دیگر', 'other', ?) ON CONFLICT DO NOTHING").run(now);
    const cust = async (org: number) =>
      Number((await db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES (?, 'م', ?, ?)").run(`C${org}`, now, org)).lastInsertRowid);
    const c1 = await cust(1);
    const c2 = await cust(2);
    let n = 0;
    const order = async (customer: number, org: number, date: string, status: string, total: number, deliveredAt: string | null = null) =>
      await db.prepare(
        `INSERT INTO orders (order_no, customer_id, status, order_date, delivered_at, created_by, created_at, updated_at, organization_id, total_toman)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(`N${++n}`, customer, status, date, deliveredAt, owner, now, now, org, total);
    await order(c1, 1, "2026-10-18", "CONFIRMED", 100);
    await order(c1, 1, "2026-10-19", "DELIVERED", 200, "2026-10-19T10:00:00Z");
    await order(c1, 1, "2026-10-19", "DRAFT", 999);
    await order(c1, 1, "2026-10-11", "DELIVERED", 400, "2026-10-12T10:00:00Z");
    await order(c1, 1, "2026-10-15", "CONFIRMED", 999); // last week, but after Tuesday
    await order(c2, 2, "2026-10-18", "CONFIRMED", 999);
    const pay = async (customer: number, org: number, at: string, amount: number) =>
      await db.prepare("INSERT INTO payments (organization_id, customer_id, amount_toman, method, received_at, received_by, created_at) VALUES (?, ?, ?, 'CASH', ?, ?, ?)")
        .run(org, customer, amount, at, owner, now);
    await pay(c1, 1, "2026-10-20T09:00:00Z", 50);
    await pay(c1, 1, "2026-10-11T09:00:00Z", 25);
    await pay(c2, 2, "2026-10-20T09:00:00Z", 999);

    const w = (await weekVsLast(sess(owner, "owner"), "2026-10-20"))!;
    expect(w.now).toEqual({ orders: 2, sales_toman: 300, delivered: 1, collected_toman: 50 });
    expect(w.before).toEqual({ orders: 1, sales_toman: 400, delivered: 1, collected_toman: 25 });
    expect(await weekVsLast(sess(9, "phone_sales"), "2026-10-20")).toBeNull();

    const html = renderToStaticMarkup(createElement(WeekCompareCard, w));
    expect(html).toContain("این هفته در برابر هفتهٔ قبل");
    expect(html).toContain("+۱۰۰٪"); // orders 2 against 1
  });
});
