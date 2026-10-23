import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-batchroute-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/sales/batches/route");
const { GET: GET_ONE, PATCH } = await import("@/app/api/sales/batches/[id]/route");
const { GET: TRACE } = await import("@/app/api/sales/batches/[id]/trace/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let mgrId = 0;
let sellerId = 0;
let prod = 0;
let otherOrgBatch = 0;

beforeAll(async () => {
  const db = getDb();
  await db.exec("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'Two','two','2026-01-01')");
  const now = new Date().toISOString();
  mgrId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'group_manager',NULL,1,?,1)"
      )
      .run("b-mgr", "x:y", "م", now)).lastInsertRowid
  );
  sellerId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'phone_sales',NULL,1,?,1)"
      )
      .run("b-seller", "x:y", "ف", now)).lastInsertRowid
  );
  prod = Number(
    (await db.prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES ('کره',?,?,?,1)").run(`s${Date.now()}`, now, now)).lastInsertRowid
  );
  const p2 = Number(
    (await db.prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES ('x',?,?,?,2)").run(`s2${Date.now()}`, now, now)).lastInsertRowid
  );
  otherOrgBatch = Number(
    (await db.prepare("INSERT INTO batches (organization_id,product_id,batch_code,qty_received_base,unit_cost_toman,status,created_at,updated_at) VALUES (2,?,?,10,0,'active',?,?)").run(p2, "OTHER", now, now)).lastInsertRowid
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

describe("/api/sales/batches", () => {
  let batchId = 0;

  it("creates a batch", async () => {
    const res = await POST(
      jreq("/api/sales/batches", {
        method: "POST",
        body: JSON.stringify({ product_id: prod, qty_received_base: 20, batch_code: "MANUAL-1" }),
      })
    );
    expect(res.status).toBe(201);
    batchId = (await res.json()).id;
  });

  it("409s a duplicate code", async () => {
    const res = await POST(
      jreq("/api/sales/batches", {
        method: "POST",
        body: JSON.stringify({ product_id: prod, qty_received_base: 5, batch_code: "MANUAL-1" }),
      })
    );
    expect(res.status).toBe(409);
  });

  it("refuses a salesperson", async () => {
    const res = await GET(jreq("/api/sales/batches", { uid: sellerId, role: "phone_sales" }));
    expect(res.status).toBe(403);
  });

  it("advances status, and 409s an illegal move", async () => {
    const ok = await PATCH(
      jreq(`/api/sales/batches/${batchId}`, { method: "PATCH", body: JSON.stringify({ action: "status", to: "quarantined" }) }),
      ctx(batchId)
    );
    expect(ok.status).toBe(200);
    const bad = await PATCH(
      jreq(`/api/sales/batches/${batchId}`, { method: "PATCH", body: JSON.stringify({ action: "status", to: "expired" }) }),
      ctx(batchId)
    );
    expect(bad.status).toBe(409);
  });

  it("404s a batch in another org", async () => {
    const res = await GET_ONE(jreq(`/api/sales/batches/${otherOrgBatch}`), ctx(otherOrgBatch));
    expect(res.status).toBe(404);
    const t = await TRACE(jreq(`/api/sales/batches/${otherOrgBatch}/trace`), ctx(otherOrgBatch));
    expect(t.status).toBe(404);
  });
});
