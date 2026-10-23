import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-chqroute-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/cheques/route");
const { GET: GET_ONE, PATCH } = await import("@/app/api/cheques/[id]/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let mgrId = 0;
let sellerId = 0;
let custId = 0;
let otherChequeId = 0;

beforeAll(async () => {
  const db = getDb();
  await db.exec("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'Two','two','2026-01-01')");
  const now = new Date().toISOString();
  mgrId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'group_manager',NULL,1,?,1)"
      )
      .run("c-mgr", "x:y", "م", now)).lastInsertRowid
  );
  sellerId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'phone_sales',NULL,1,?,1)"
      )
      .run("c-seller", "x:y", "ف", now)).lastInsertRowid
  );
  custId = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('C1','x','RESTAURANT','active','2026-01-01',1)"
      )
      .run()).lastInsertRowid
  );
  const c2 = Number(
    (await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C2','x','active','2026-01-01',2)").run()).lastInsertRowid
  );
  otherChequeId = Number(
    (await db
      .prepare(
        "INSERT INTO cheques (organization_id,customer_id,amount_toman,cheque_no,due_date,status,received_at,received_by,created_at,updated_at) VALUES (2,?,1000,'X','2026-03-01','in_hand','x',?,?,?)"
      )
      .run(c2, mgrId, now, now)).lastInsertRowid
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

describe("/api/cheques", () => {
  let chequeId = 0;

  it("records a cheque", async () => {
    const res = await POST(
      jreq("/api/cheques", {
        method: "POST",
        body: JSON.stringify({
          customer_id: custId,
          amount_toman: 50_000,
          cheque_no: "1001",
          due_date: "2026-04-01",
          received_at: "2026-02-01",
        }),
      })
    );
    expect(res.status).toBe(201);
    chequeId = (await res.json()).cheque_id;
  });

  it("refuses a salesperson", async () => {
    const res = await GET(jreq("/api/cheques", { uid: sellerId, role: "phone_sales" }));
    expect(res.status).toBe(403);
  });

  it("advances in_hand -> deposited", async () => {
    const res = await PATCH(
      jreq(`/api/cheques/${chequeId}`, { method: "PATCH", body: JSON.stringify({ action: "advance", to: "deposited" }) }),
      ctx(chequeId)
    );
    expect(res.status).toBe(200);
  });

  it("409s an illegal transition", async () => {
    const res = await PATCH(
      jreq(`/api/cheques/${chequeId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "advance", to: "in_hand" }),
      }),
      ctx(chequeId)
    );
    expect(res.status).toBe(409);
  });

  it("404s a cheque in another org", async () => {
    const res = await GET_ONE(jreq(`/api/cheques/${otherChequeId}`), ctx(otherChequeId));
    expect(res.status).toBe(404);
  });
});
