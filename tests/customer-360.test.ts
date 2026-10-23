import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Session } from "@/lib/session";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-c360-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { customer360 } = await import("@/lib/repo/customer360");
const CustomerOpenItems = (await import("@/components/crm/CustomerOpenItems")).default;

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const sess = (role: string): Session =>
  ({ user: { id: 1 } as never, role: role as never, groupId: null, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

describe("customer360 (F47)", async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const u = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('c3','x','م','owner',1,?,1)").run(now)).lastInsertRowid);
  const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C3','x','active',?,1)").run(now)).lastInsertRowid);
  const cheque = db.prepare("INSERT INTO cheques (organization_id,customer_id,amount_toman,cheque_no,due_date,status,received_at,received_by,created_at,updated_at) VALUES (1,?,?,?,?,?,?,?,?,?)");
  await cheque.run(cust, 500000, "A1", "2026-11-01", "in_hand", now, u, now, now);
  await cheque.run(cust, 300000, "A2", "2026-10-01", "bounced", now, u, now, now);
  await cheque.run(cust, 900000, "A3", "2026-09-01", "cleared", now, u, now, now);
  const complaint = db.prepare("INSERT INTO quality_complaints (organization_id,customer_id,reported_at,category,severity,status,description,created_at) VALUES (1,?,?,?,?,?,?,?)");
  await complaint.run(cust, "2026-10-20T08:00:00Z", "spoilage", "high", "open", "ماست ترش بود", now);
  await complaint.run(cust, "2026-10-01T08:00:00Z", "packaging", "low", "resolved", null, now);

  it("a manager sees open cheques, bounced first, with their total, and open complaints", async () => {
    const d = await customer360(sess("owner"), 1, cust);
    expect(d.cheques?.items.map((c) => c.cheque_no)).toEqual(["A2", "A1"]);
    expect(d.cheques?.total_toman).toBe(800000);
    expect(d.complaints.map((c) => c.category)).toEqual(["spoilage"]);
    const html = renderToStaticMarkup(h(CustomerOpenItems, { data: d }));
    expect(html).toContain("چک‌های باز");
    expect(html).toContain("برگشت خورد");
    expect(html).toContain("ماست ترش بود");
  });

  it("a salesperson gets no cheque card, still the complaints; another company sees nothing", async () => {
    const d = await customer360(sess("phone_sales"), 1, cust);
    expect(d.cheques).toBeNull();
    expect(d.complaints).toHaveLength(1);
    expect(renderToStaticMarkup(h(CustomerOpenItems, { data: d }))).not.toContain("چک‌های باز");
    expect(await customer360(sess("owner"), 2, cust)).toEqual({ cheques: { items: [], total_toman: 0 }, complaints: [] });
  });
});
