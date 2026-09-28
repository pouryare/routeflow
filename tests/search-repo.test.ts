import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";

const testDbPath = path.join(os.tmpdir(), `rf-search-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { searchCustomers, searchOrders, searchUsers } = await import("@/lib/repo/search");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const sess = (id: number, role: string, gid: number | null): Session =>
  ({ user: { id } as never, role: role as never, groupId: gid, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

let owner = 0, mgrA = 0, sellerA = 0, sellerA2 = 0, groupA = 0, groupB = 0, custA = 0, custB = 0;
let orderMineId = 0, orderOther = "";

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM groups; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES (?,?,?,1)");
  groupA = Number(g.run("A", "a", now).lastInsertRowid);
  groupB = Number(g.run("B", "b", now).lastInsertRowid);
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)"
  );
  const tag = Date.now();
  owner = Number(u.run(`o${tag}`, "x", "م", "owner", null, now).lastInsertRowid);
  mgrA = Number(u.run(`m${tag}`, "x", "مد", "group_manager", groupA, now).lastInsertRowid);
  sellerA = Number(u.run(`s${tag}`, "x", "ف", "phone_sales", groupA, now).lastInsertRowid);
  sellerA2 = Number(u.run(`t${tag}`, "x", "ف۲", "phone_sales", groupA, now).lastInsertRowid);
  const c = db.prepare(
    "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES (?,?,'active',?,?,1)"
  );
  custA = Number(c.run("CA1", "سوپر یاس", now, groupA).lastInsertRowid);
  custB = Number(c.run("CB1", "سوپر یاسمن", now, groupB).lastInsertRowid);

  const product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  const packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
  const line = [{ product_id: product, packaging_id: packaging, packs: 1 }];
  const today = now.slice(0, 10);
  orderMineId = createOrder(db, { customer_id: custA, order_date: today, created_by: owner, organization_id: 1, salesperson_user_id: sellerA, lines: line }).id;
  orderOther = createOrder(db, { customer_id: custA, order_date: today, created_by: owner, organization_id: 1, salesperson_user_id: sellerA2, lines: line }).order_no;
});

describe("searchCustomers", () => {
  it("a group manager finds their own group's shop and not the other group's", () => {
    const ids = searchCustomers(getDb(), sess(mgrA, "group_manager", groupA), "سوپر").map((h) => h.id);
    expect(ids).toEqual([`customer:${custA}`]);
  });

  it("an owner reaches every group in their organisation", () => {
    const ids = searchCustomers(getDb(), sess(owner, "owner", null), "سوپر").map((h) => h.id).sort();
    expect(ids).toEqual([`customer:${custA}`, `customer:${custB}`].sort());
  });

  it("a salesperson gets no customers: search must not be a side door to a list they cannot open", () => {
    expect(searchCustomers(getDb(), sess(sellerA, "phone_sales", groupA), "سوپر")).toEqual([]);
  });

  it("folds Arabic ي into Persian ی", () => {
    expect(searchCustomers(getDb(), sess(owner, "owner", null), "ياسمن").map((h) => h.id)).toEqual([`customer:${custB}`]);
  });

  it("matches the customer code too, and links to the shop on the map", () => {
    const [h] = searchCustomers(getDb(), sess(owner, "owner", null), "CB1");
    expect(h.href).toBe(`/map?c=${custB}`);
  });

  it("does not answer a one-letter query", () => {
    expect(searchCustomers(getDb(), sess(owner, "owner", null), "س")).toEqual([]);
  });
});

describe("searchOrders", () => {
  it("a salesperson finds only their own order", () => {
    const ids = searchOrders(getDb(), sess(sellerA, "phone_sales", groupA), "سوپر").map((h) => h.id);
    expect(ids).toEqual([`order:${orderMineId}`]);
  });

  it("an owner finds both, newest first, linked to the order page", () => {
    const hits = searchOrders(getDb(), sess(owner, "owner", null), "سوپر");
    expect(hits).toHaveLength(2);
    expect(hits[0].href).toMatch(/^\/sales\/orders\/\d+$/);
  });

  it("finds an order number typed in Persian digits", () => {
    const persian = orderOther.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
    const hits = searchOrders(getDb(), sess(owner, "owner", null), persian);
    expect(hits.map((h) => h.id)).toHaveLength(1);
  });

  it("prints no raw English status to a Persian reader", () => {
    for (const h of searchOrders(getDb(), sess(owner, "owner", null), "سوپر")) {
      expect(h.sub ?? "").not.toMatch(/[A-Z_]{4,}/);
    }
  });

  it("gives a driver nothing", () => {
    expect(searchOrders(getDb(), sess(sellerA, "delivery_driver", groupA), "سوپر")).toEqual([]);
  });
});

describe("searchUsers (Login-As candidates)", () => {
  it("an owner finds their people by name", () => {
    const ids = searchUsers(getDb(), sess(owner, "owner", null), "ف").map((h) => h.id);
    expect(ids).toEqual([]); // one letter is too short
    const hits = searchUsers(getDb(), sess(owner, "owner", null), "مد");
    expect(hits.map((h) => h.id)).toEqual([`user:${mgrA}`]);
    expect(hits[0].sub).toMatch(/[؀-ۿ]/);
  });

  it("nobody but an owner gets the section", () => {
    expect(searchUsers(getDb(), sess(mgrA, "group_manager", groupA), "ف۲")).toEqual([]);
    expect(searchUsers(getDb(), sess(sellerA, "phone_sales", groupA), "ف۲")).toEqual([]);
  });

  it("never offers themselves, another owner or a deactivated account", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,?,?,1)")
      .run(`o2${Date.now()}`, "x", "مالک دوم", "owner", null, 1, now);
    db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,?,?,1)")
      .run(`gone${Date.now()}`, "x", "مالک رفته", "phone_sales", null, 0, now);
    const labels = searchUsers(db, sess(owner, "owner", null), "مالک").map((h) => h.label);
    expect(labels).toEqual([]);
  });
});
