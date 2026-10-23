import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-mvroute-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("../helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { GET, POST } = await import("@/app/api/sales/stock/movements/route");
const { GET: EXPIRY } = await import("@/app/api/sales/stock/expiry/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let mgrId = 0;
let sellerId = 0;
let prod = 0;

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  mgrId = Number(
    (await db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'group_manager',NULL,1,?,1)").run("m-mgr", "x:y", "م", now)).lastInsertRowid
  );
  sellerId = Number(
    (await db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'phone_sales',NULL,1,?,1)").run("m-seller", "x:y", "ف", now)).lastInsertRowid
  );
  prod = Number(
    (await db.prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES ('کره',?,?,?,1)").run(`s${Date.now()}`, now, now)).lastInsertRowid
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

describe("/api/sales/stock/movements", () => {
  it("records a manual ADJUSTMENT", async () => {
    // Stock has to exist before it can be written off: a manual movement may not go below zero.
    const seed = await POST(
      jreq("/api/sales/stock/movements", {
        method: "POST",
        body: JSON.stringify({ product_id: prod, base_qty: 10, kind: "ADJUSTMENT", notes: "موجودی اولیه" }),
      })
    );
    expect(seed.status).toBe(201);
    const res = await POST(
      jreq("/api/sales/stock/movements", {
        method: "POST",
        body: JSON.stringify({ product_id: prod, base_qty: -3, kind: "ADJUSTMENT", notes: "شکست" }),
      })
    );
    expect(res.status).toBe(201);
    const list = await GET(jreq("/api/sales/stock/movements"));
    expect((await list.json()).movements).toHaveLength(2);
  });

  it("409s a manual movement that would take stock below zero, and leaves the ledger alone", async () => {
    const before = (await (await GET(jreq("/api/sales/stock/movements"))).json()).movements.length;
    const res = await POST(
      jreq("/api/sales/stock/movements", {
        method: "POST",
        body: JSON.stringify({ product_id: prod, base_qty: -500, kind: "ADJUSTMENT" }),
      })
    );
    expect(res.status).toBe(409);
    const after = (await (await GET(jreq("/api/sales/stock/movements"))).json()).movements.length;
    expect(after).toBe(before);
  });

  it("400s a DELIVERY_OUT (written only by its own flow)", async () => {
    const res = await POST(
      jreq("/api/sales/stock/movements", {
        method: "POST",
        body: JSON.stringify({ product_id: prod, base_qty: -1, kind: "DELIVERY_OUT" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("400s a zero quantity", async () => {
    const res = await POST(
      jreq("/api/sales/stock/movements", {
        method: "POST",
        body: JSON.stringify({ product_id: prod, base_qty: 0, kind: "COUNT" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("refuses a salesperson on movements but allows them on expiry", async () => {
    const denied = await GET(jreq("/api/sales/stock/movements", { uid: sellerId, role: "phone_sales" }));
    expect(denied.status).toBe(403);
    const ok = await EXPIRY(jreq("/api/sales/stock/expiry", { uid: sellerId, role: "phone_sales" }));
    expect(ok.status).toBe(200);
  });
});
