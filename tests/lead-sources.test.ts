import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-lead-sources-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { leadSourceReport } = await import("@/lib/repo/leadSources");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const sess = (role: string, gid: number | null = null): Session =>
  ({ user: { id: 1 } as never, role: role as never, groupId: gid, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

describe("leadSourceReport (F137)", () => {
  const db = getDb();
  ensureWarehouse(db);
  const now = new Date().toISOString();
  const owner = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('ls','x','م','owner',1,?,1)").run(now).lastInsertRowid);
  const c = db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,source_code,organization_id) VALUES (?,?,?,?,?,1)");
  const insta = Number(c.run("L1", "a", "active", now, "INSTAGRAM").lastInsertRowid);
  c.run("L2", "b", "lead", now, "INSTAGRAM");
  c.run("L3", "c", "lead", now, "GOOGLE_MAPS");
  c.run("L4", "d", "lead", now, null);
  const product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  const packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
  const order = (date: string, packs: number) => {
    const o = createOrder(db, {
      customer_id: insta, order_date: date, created_by: owner, organization_id: 1, salesperson_user_id: owner,
      lines: [{ product_id: product, packaging_id: packaging, packs }],
    });
    db.prepare("UPDATE orders SET status = 'DELIVERED' WHERE id = ?").run(o.id);
  };
  order("2026-01-10", 2); // first delivered order
  order("2026-03-01", 3); // inside 90 days
  order("2026-06-01", 50); // outside the window

  it("counts leads and customers per source, with revenue in the first 90 days only", () => {
    const rows = leadSourceReport(sess("owner"));
    const ig = rows.find((r) => r.source === "INSTAGRAM")!;
    expect(ig).toMatchObject({ label: "اینستاگرام", leads: 2, converted: 1, rate: 0.5, revenue90: 5000 });
    expect(rows.find((r) => r.source === null)).toMatchObject({ label: "بدون منبع", leads: 1, converted: 0 });
    expect(rows[0].source).toBe("INSTAGRAM");
  });

  it("a role outside the CRM gets nothing", () => {
    expect(leadSourceReport(sess("delivery_driver"))).toEqual([]);
  });
});
