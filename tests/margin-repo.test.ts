import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-margin-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { marginBy, materialiseMargin, MarginError } = await import("@/lib/repo/margin");
const { snapshot } = await import("@/lib/repo/kpiSnapshots");
const { toJalali } = await import("@/lib/jalali");
import type { Session } from "@/lib/session";
import type { Role, UserRow } from "@/lib/db";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const DATE = "2026-03-10";
const j = toJalali(`${DATE}T00:00:00.000Z`)!;
const PERIOD = `${j.jy}-${String(j.jm).padStart(2, "0")}`;

function session(role: Role, uid: number, gid: number | null): Session {
  return {
    user: { id: uid, role, group_id: gid, organization_id: 1 } as UserRow,
    role,
    groupId: gid,
    organizationId: 1,
  };
}

let owner = 0;
let seller = 0;
let groupId = 0;
let custA = 0;
let custB = 0;
let butter = 0;
let cheese = 0;
let pkgB = 0;
let pkgC = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM kpi_snapshots; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM representative_profiles; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; DELETE FROM groups; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  groupId = Number(
    db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('شرق','east',?,1)").run(now).lastInsertRowid
  );
  owner = Number(
    db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','مالک','owner',?,1)").run(now).lastInsertRowid
  );
  seller = Number(
    db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('s','x','فروشنده','salesperson',?,?,1)").run(groupId, now).lastInsertRowid
  );
  custA = Number(
    db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('CA','مغازهٔ الف','active',?,?,1)").run(now, groupId).lastInsertRowid
  );
  custB = Number(
    db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('CB','مغازهٔ ب','active',?,?,1)").run(now, groupId).lastInsertRowid
  );
  butter = Number(
    db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('کره','KR',0.25,?,?,1)").run(now, now).lastInsertRowid
  );
  cheese = Number(
    db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('پنیر','PN',0.5,?,?,1)").run(now, now).lastInsertRowid
  );
  pkgB = Number(db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'جعبه',1,?)").run(butter, now).lastInsertRowid);
  pkgC = Number(db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'جعبه',1,?)").run(cheese, now).lastInsertRowid);
});

/** one delivered order, one line: `packs` packs at (price, cost) per pack. */
function order(customerId: number, productId: number, pkg: number, packs: number, price: number, cost: number) {
  const db = getDb();
  const now = new Date().toISOString();
  const oid = Number(
    db.prepare(
      "INSERT INTO orders (order_no,customer_id,group_id,salesperson_user_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES ('o'||abs(random()),?,?,?,'DELIVERED',?,?,?,?,1)"
    ).run(customerId, groupId, seller, DATE, seller, now, now).lastInsertRowid
  );
  const kg = productId === butter ? 0.25 : 0.5;
  db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,?,?,?,?,1,?,?)"
  ).run(oid, productId, pkg, packs, packs, price, cost, kg, now);
  return oid;
}

describe("margin repo", () => {
  it("marginBy customer: rows sorted by margin, margin_pct matches hand-calc", () => {
    order(custA, butter, pkgB, 10, 1000, 700); // rev 10_000 cost 7_000 margin 3_000 (30%)
    order(custB, cheese, pkgC, 5, 2000, 1900); // rev 10_000 cost 9_500 margin 500 (5%)
    const rows = marginBy(1, "customer", PERIOD, session("owner", owner, null));
    expect(rows.map((r) => r.label)).toEqual(["مغازهٔ الف", "مغازهٔ ب"]);
    expect(rows[0].margin_toman).toBe(3000);
    expect(rows[0].margin_pct).toBeCloseTo(0.3);
    expect(rows[1].margin_pct).toBeCloseTo(0.05);
  });

  it("marginBy product groups by SKU", () => {
    order(custA, butter, pkgB, 10, 1000, 700);
    order(custB, butter, pkgB, 4, 1000, 700);
    const rows = marginBy(1, "product", PERIOD, session("owner", owner, null));
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("کره");
    expect(rows[0].revenue_toman).toBe(14_000);
    expect(rows[0].margin_toman).toBe(14 * 300);
  });

  it("marginBy representative only counts customers that have a rep profile", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO representative_profiles (organization_id,customer_id,rep_code,stage,credit_terms_days,created_at,updated_at) VALUES (1,?,'R-A','active',0,?,?)"
    ).run(custA, now, now);
    order(custA, butter, pkgB, 10, 1000, 700);
    order(custB, butter, pkgB, 10, 1000, 700); // no rep profile -> excluded
    const rows = marginBy(1, "representative", PERIOD, session("owner", owner, null));
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toContain("R-A");
    expect(rows[0].revenue_toman).toBe(10_000);
  });

  it("refuses a salesperson session", () => {
    expect(() => marginBy(1, "customer", PERIOD, session("salesperson", seller, groupId))).toThrow(MarginError);
  });

  it("materialiseMargin writes an org gross_margin snapshot equal to total margin / total revenue", () => {
    order(custA, butter, pkgB, 10, 1000, 700); // margin 3_000 / rev 10_000
    order(custB, cheese, pkgC, 5, 2000, 1900); // margin 500 / rev 10_000
    const written = materialiseMargin(1, PERIOD);
    expect(written).toBeGreaterThan(0);
    expect(snapshot(1, "net_sales", { scope_type: "org", period: PERIOD })).toBe(20_000);
    expect(snapshot(1, "gross_profit", { scope_type: "org", period: PERIOD })).toBe(3_500);
    expect(snapshot(1, "gross_margin", { scope_type: "org", period: PERIOD })).toBeCloseTo(0.175);
    // per-salesperson row present
    expect(snapshot(1, "net_sales", { scope_type: "salesperson", scope_id: seller, period: PERIOD })).toBe(20_000);
  });

  it("materialiseMargin is idempotent", () => {
    order(custA, butter, pkgB, 10, 1000, 700);
    materialiseMargin(1, PERIOD);
    materialiseMargin(1, PERIOD);
    const n = (getDb().prepare("SELECT COUNT(*) n FROM kpi_snapshots WHERE metric='net_sales' AND scope_type='org'").get() as { n: number }).n;
    expect(n).toBe(1);
  });
});
