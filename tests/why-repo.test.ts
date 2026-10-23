import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-why-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { whyChain, WhyError } = await import("@/lib/repo/why");
const { periodOf } = await import("@/lib/analysis/period");
import type { Session } from "@/lib/session";
import type { Role, UserRow } from "@/lib/db";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const DATE_A = "2026-02-10";
const DATE_B = "2026-03-10";
const PA = periodOf(`${DATE_A}T00:00:00.000Z`);
const PB = periodOf(`${DATE_B}T00:00:00.000Z`);

function session(role: Role, uid: number, gid: number | null): Session {
  return { user: { id: uid, role, group_id: gid, organization_id: 1 } as UserRow, role, groupId: gid, organizationId: 1, roles: [role], hasRole: (x) => x === role };
}

let gA = 0;
let gB = 0;
let owner = 0;
let sellerA = 0;
let sellerB = 0;
let custA = 0;
let custB = 0;
let product = 0;
let pkg = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM order_events; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; DELETE FROM groups; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  gA = Number((await db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('شرق','e',?,1)").run(now)).lastInsertRowid);
  gB = Number((await db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('غرب','w',?,1)").run(now)).lastInsertRowid);
  owner = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','مالک','owner',?,1)").run(now)).lastInsertRowid);
  sellerA = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('sa','x','آرش','phone_sales',?,?,1)").run(gA, now)).lastInsertRowid);
  sellerB = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('sb','x','بیتا','phone_sales',?,?,1)").run(gB, now)).lastInsertRowid);
  custA = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('CA','الف','active',?,?,1)").run(now, gA)).lastInsertRowid);
  custB = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('CB','ب','active',?,?,1)").run(now, gB)).lastInsertRowid);
  product = Number((await db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('کره','K',0.25,?,?,1)").run(now, now)).lastInsertRowid);
  pkg = Number((await db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'ج',1,?)").run(product, now)).lastInsertRowid);
});

async function order(customerId: number, groupId: number, sellerId: number, dateIso: string, packs: number, opts?: { confirmed?: boolean; delivered?: boolean }) {
  const db = getDb();
  const now = new Date().toISOString();
  const oid = Number(
    (await db.prepare(
      "INSERT INTO orders (order_no,customer_id,group_id,salesperson_user_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES ('o'||abs(random()),?,?,?,'DELIVERED',?,?,?,?,1)"
    ).run(customerId, groupId, sellerId, dateIso, owner, now, now)).lastInsertRowid
  );
  await db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,?,?,1000,700,1,0.25,?)"
  ).run(oid, product, pkg, packs, packs, now);
  const ev = async (to: string) =>
    await db.prepare(
      "INSERT INTO order_events (organization_id,order_id,from_status,to_status,action,actor_user_id,created_at) VALUES (1,?,NULL,?,'x',?,?)"
    ).run(oid, to, owner, dateIso);
  if (opts?.confirmed !== false) await ev("CONFIRMED");
  if (opts?.delivered !== false) await ev("DELIVERED");
  return oid;
}

describe("why repo", () => {
  it("names the territory that moved the number, then descends", async () => {
    // period A: both groups sell 10 packs
    await order(custA, gA, sellerA, DATE_A, 10);
    await order(custB, gB, sellerB, DATE_A, 10);
    // period B: east holds, west collapses to 2
    await order(custA, gA, sellerA, DATE_B, 10);
    await order(custB, gB, sellerB, DATE_B, 2);

    const chain = await whyChain(session("owner", owner, null), "net_sales", PA, PB);
    expect(chain[0].dimension_fa).toBe("منطقه");
    expect(chain[0].contributions[0].key).toBe(String(gB));
    expect(chain[0].contributions[0].delta).toBeLessThan(0);
    expect(chain[1].dimension_fa).toBe("فروشنده");
    expect(chain[1].scope_fa).toBe("غرب");
    expect(chain[2].dimension_fa).toBe("مرحلهٔ قیف");
    expect(chain[2].headline).toMatch(/ثبت‌شده|تأییدشده|تحویل‌شده|تغییری/);
  });

  it("orders metric decomposes the same way", async () => {
    await order(custA, gA, sellerA, DATE_A, 5);
    await order(custB, gB, sellerB, DATE_A, 5);
    await order(custB, gB, sellerB, DATE_A, 5);
    await order(custA, gA, sellerA, DATE_B, 5);
    const chain = await whyChain(session("owner", owner, null), "orders", PA, PB);
    expect(chain[0].contributions[0].key).toBe(String(gB));
    expect(chain[0].delta).toBe(-2);
  });

  it("refuses a salesperson session", async () => {
    await expect((async () => await whyChain(session("phone_sales", sellerA, gA), "net_sales", PA, PB))()).rejects.toThrow(WhyError);
  });
});
