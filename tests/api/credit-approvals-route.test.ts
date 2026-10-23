import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-caroute-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/admin/credit-approvals/route");
const { POST: DECIDE } = await import("@/app/api/admin/credit-approvals/[id]/decide/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let mgrId = 0;
let sellerId = 0;
let custId = 0;
let orderId = 0;
let otherApprovalId = 0;

beforeAll(async () => {
  const db = getDb();
  await db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'Two','two','2026-01-01')`);
  const now = new Date().toISOString();
  mgrId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'group_manager',NULL,1,?,1)"
      )
      .run("ca-mgr", "x:y", "مدیر", now)).lastInsertRowid
  );
  sellerId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'phone_sales',NULL,1,?,1)"
      )
      .run("ca-seller", "x:y", "فروشنده", now)).lastInsertRowid
  );
  custId = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('C1','x','RESTAURANT','active','2026-01-01',1)"
      )
      .run()).lastInsertRowid
  );
  orderId = Number(
    (await db
      .prepare(
        "INSERT INTO orders (order_no,customer_id,order_date,status,credit_hold,created_by,created_at,updated_at,organization_id) VALUES ('o1',?,?,'PENDING_CREDIT',1,?,?,?,1)"
      )
      .run(custId, "2026-01-01", mgrId, now, now)).lastInsertRowid
  );
  // An approval belonging to org 2.
  otherApprovalId = Number(
    (await db
      .prepare(
        "INSERT INTO credit_approvals (organization_id,order_id,requested_by,requested_at,customer_balance_toman,credit_limit_toman,overage_toman,status) VALUES (2,?,?,?,1,0,1,'pending')"
      )
      .run(orderId, mgrId, now)).lastInsertRowid
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

describe("/api/admin/credit-approvals", () => {
  let approvalId = 0;

  it("a salesperson can request an approval", async () => {
    const res = await POST(
      jreq("/api/admin/credit-approvals", {
        method: "POST",
        uid: sellerId,
        role: "phone_sales",
        body: JSON.stringify({
          order_id: orderId,
          customer_id: custId,
          customer_balance_toman: 4_000_000,
          credit_limit_toman: 1_000_000,
        }),
      })
    );
    expect(res.status).toBe(201);
    approvalId = (await res.json()).id;
  });

  it("a manager lists and decides it", async () => {
    const list = await (await GET(jreq("/api/admin/credit-approvals?status=pending"))).json();
    expect(list.approvals.map((a: { id: number }) => a.id)).toContain(approvalId);

    const res = await DECIDE(
      jreq(`/api/admin/credit-approvals/${approvalId}/decide`, {
        method: "POST",
        body: JSON.stringify({ verdict: "approved", reason: "ok" }),
      }),
      ctx(approvalId)
    );
    expect(res.status).toBe(200);
  });

  it("a second decision on the same request is 409", async () => {
    const res = await DECIDE(
      jreq(`/api/admin/credit-approvals/${approvalId}/decide`, {
        method: "POST",
        body: JSON.stringify({ verdict: "rejected" }),
      }),
      ctx(approvalId)
    );
    expect(res.status).toBe(409);
  });

  it("a salesperson cannot decide", async () => {
    const res = await DECIDE(
      jreq(`/api/admin/credit-approvals/${approvalId}/decide`, {
        method: "POST",
        uid: sellerId,
        role: "phone_sales",
        body: JSON.stringify({ verdict: "approved" }),
      }),
      ctx(approvalId)
    );
    expect(res.status).toBe(403);
  });

  it("cannot decide another organisation's approval", async () => {
    const res = await DECIDE(
      jreq(`/api/admin/credit-approvals/${otherApprovalId}/decide`, {
        method: "POST",
        body: JSON.stringify({ verdict: "approved" }),
      }),
      ctx(otherApprovalId)
    );
    expect(res.status).toBe(409); // not found -> CreditApprovalError -> 409, never 200
  });
});
