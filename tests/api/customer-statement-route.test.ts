import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-stmtroute-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET } = await import("@/app/api/customers/[id]/statement/route");
const { recordPayment } = await import("@/lib/repo/payments");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let ownerId = 0;
let sellerId = 0;
let groupA = 0;
let groupB = 0;
let custA = 0;
let custB = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  groupA = Number(
    db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('A','a',?,1)").run(now).lastInsertRowid
  );
  groupB = Number(
    db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('B','b',?,1)").run(now).lastInsertRowid
  );
  ownerId = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES ('s-o','x:y','م','owner',NULL,1,?,1)"
      )
      .run(now).lastInsertRowid
  );
  sellerId = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES ('s-s','x:y','ف','salesperson',?,1,?,1)"
      )
      .run(groupA, now).lastInsertRowid
  );
  custA = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,lifecycle,group_id,synced_at,organization_id) VALUES ('CA','رستوران آ','active',?,'2026-01-01',1)"
      )
      .run(groupA).lastInsertRowid
  );
  custB = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,lifecycle,group_id,synced_at,organization_id) VALUES ('CB','رستوران ب','active',?,'2026-01-01',1)"
      )
      .run(groupB).lastInsertRowid
  );
  const o = Number(
    db
      .prepare(
        "INSERT INTO orders (order_no,customer_id,group_id,order_date,status,delivered_at,created_by,created_at,updated_at,organization_id) VALUES ('o1',?,?,?,'DELIVERED',?,?,?,?,1)"
      )
      .run(custA, groupA, "2026-01-01", "2026-01-01", ownerId, now, now).lastInsertRowid
  );
  const p = Number(
    db.prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES ('p','s',?,?,1)").run(now, now).lastInsertRowid
  );
  const pk = Number(
    db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'b',1,?)").run(p, now).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at) VALUES (?,?,?,1,1,60000,0,1,1,0,?)"
  ).run(o, p, pk, now);
  recordPayment(1, {
    customer_id: custA,
    amount_toman: 20_000,
    method: "CASH",
    received_at: "2026-01-05",
    received_by: ownerId,
  });
});

function cookie(uid: number, role: string, gid: number | null) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid, oid: 1, tv: 0, name: "م" })}`;
}
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) }) as never;
function jreq(id: number, uid: number, role: string, gid: number | null) {
  return new NextRequest(`http://localhost/api/customers/${id}/statement`, {
    headers: { cookie: cookie(uid, role, gid) },
  });
}

describe("/api/customers/[id]/statement", () => {
  it("returns orders, payments and computed debt", async () => {
    const res = await GET(jreq(custA, ownerId, "owner", null), ctx(custA));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orders).toHaveLength(1);
    expect(body.payments).toHaveLength(1);
    expect(body.debt.total).toBe(40_000); // 60_000 delivered - 20_000 paid
  });

  it("lets a salesperson see a customer in their own group", async () => {
    const res = await GET(jreq(custA, sellerId, "salesperson", groupA), ctx(custA));
    expect(res.status).toBe(200);
  });

  it("404s a customer outside the salesperson's group", async () => {
    const res = await GET(jreq(custB, sellerId, "salesperson", groupA), ctx(custB));
    expect(res.status).toBe(404);
  });
});
