import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-payroute-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/payments/route");
const { GET: GET_ONE, POST: MUT_ONE } = await import("@/app/api/payments/[id]/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let mgrId = 0;
let sellerId = 0;
let custId = 0;
let orderId = 0;
let otherOrgPaymentId = 0;

beforeAll(() => {
  const db = getDb();
  db.exec("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'Two','two','2026-01-01')");
  const now = new Date().toISOString();
  mgrId = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'group_manager',NULL,1,?,1)"
      )
      .run("p-mgr", "x:y", "م", now).lastInsertRowid
  );
  sellerId = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'salesperson',NULL,1,?,1)"
      )
      .run("p-seller", "x:y", "ف", now).lastInsertRowid
  );
  custId = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('C1','x','RESTAURANT','active','2026-01-01',1)"
      )
      .run().lastInsertRowid
  );
  orderId = Number(
    db
      .prepare(
        "INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,created_by,created_at,updated_at,organization_id) VALUES ('o1',?,?,'DELIVERED',?,?,?,?,1)"
      )
      .run(custId, "2026-01-01", "2026-01-01", mgrId, now, now).lastInsertRowid
  );
  // an order line so the order has a real total
  const p = Number(
    db.prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES ('p','s',?,?,1)").run(now, now).lastInsertRowid
  );
  const pk = Number(
    db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'b',1,?)").run(p, now).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at) VALUES (?,?,?,1,1,30000,0,1,1,0,?)"
  ).run(orderId, p, pk, now);

  // A payment belonging to org 2.
  const c2 = Number(
    db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C2','x','active','2026-01-01',2)").run().lastInsertRowid
  );
  otherOrgPaymentId = Number(
    db
      .prepare(
        "INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,created_at) VALUES (2,?,1000,'CASH','x',?,?)"
      )
      .run(c2, mgrId, now).lastInsertRowid
  );
});

function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}
function jreq(url: string, opts: { method?: string; body?: string; uid?: number; role?: string } = {}) {
  const { method, body, uid = mgrId, role = "group_manager" } = opts;
  return new NextRequest(`http://localhost${url}`, {
    method,
    body,
    headers: { "Content-Type": "application/json", cookie: cookie(uid, role) },
  });
}
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

describe("/api/payments", () => {
  let paymentId = 0;

  it("a salesperson can record a payment and it auto-allocates", async () => {
    const res = await POST(
      jreq("/api/payments", {
        method: "POST",
        uid: sellerId,
        role: "salesperson",
        body: JSON.stringify({
          customer_id: custId,
          amount_toman: 30_000,
          method: "CASH",
          received_at: "2026-02-01",
        }),
      })
    );
    expect(res.status).toBe(201);
    paymentId = (await res.json()).id;
    expect(paymentId).toBeGreaterThan(0);
  });

  it("lists payments for a customer", async () => {
    const res = await GET(jreq(`/api/payments?customer_id=${custId}`));
    const body = await res.json();
    expect(body.payments).toHaveLength(1);
  });

  it("400s an unknown method", async () => {
    const res = await POST(
      jreq("/api/payments", {
        method: "POST",
        body: JSON.stringify({ customer_id: custId, amount_toman: 1, method: "WIRE", received_at: "x" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("404s a payment in another org", async () => {
    const res = await GET_ONE(jreq(`/api/payments/${otherOrgPaymentId}`), ctx(otherOrgPaymentId));
    expect(res.status).toBe(404);
  });

  it("voids once, then 409s the second void", async () => {
    const ok = await MUT_ONE(
      jreq(`/api/payments/${paymentId}?action=void`, { method: "POST", body: JSON.stringify({ reason: "خطا" }) }),
      ctx(paymentId)
    );
    expect(ok.status).toBe(200);
    const again = await MUT_ONE(
      jreq(`/api/payments/${paymentId}?action=void`, { method: "POST", body: JSON.stringify({ reason: "دوباره" }) }),
      ctx(paymentId)
    );
    expect(again.status).toBe(409);
  });

  it("refuses a salesperson voiding", async () => {
    const res = await MUT_ONE(
      jreq(`/api/payments/${paymentId}?action=void`, {
        method: "POST",
        uid: sellerId,
        role: "salesperson",
        body: JSON.stringify({ reason: "x" }),
      }),
      ctx(paymentId)
    );
    expect(res.status).toBe(403);
  });
});
