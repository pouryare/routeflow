import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-lcroute-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { PATCH } = await import("@/app/api/customers/[id]/lifecycle/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let ownerId = 0;
let driverId = 0;
let custId = 0;
let otherCustId = 0;

beforeAll(async () => {
  const db = getDb();
  await db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'Two','two','2026-01-01')`);
  const now = new Date().toISOString();
  ownerId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'owner',NULL,1,?,1)"
      )
      .run("lc-owner", "x:y", "مالک", now)).lastInsertRowid
  );
  driverId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'delivery_driver',NULL,1,?,1)"
      )
      .run("lc-driver", "x:y", "راننده", now)).lastInsertRowid
  );
  custId = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('L1','x','lead','2026-01-01',1)"
      )
      .run()).lastInsertRowid
  );
  otherCustId = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('L1','y','lead','2026-01-01',2)"
      )
      .run()).lastInsertRowid
  );
});

function cookie(uid: number, role: string, oid = 1) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid, tv: 0, name: "م" })}`;
}
function req(id: number, lifecycle: string, who: "owner" | "delivery_driver" = "owner") {
  const c = who === "delivery_driver" ? cookie(driverId, "delivery_driver") : cookie(ownerId, "owner");
  return new NextRequest(`http://localhost/api/customers/${id}/lifecycle`, {
    method: "PATCH",
    body: JSON.stringify({ lifecycle }),
    headers: { "Content-Type": "application/json", cookie: c },
  });
}
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

describe("PATCH /api/customers/[id]/lifecycle", () => {
  it("applies a legal transition", async () => {
    const res = await PATCH(req(custId, "qualified"), ctx(custId));
    expect(res.status).toBe(200);
    expect(
      (await getDb().prepare("SELECT lifecycle FROM customers WHERE id=?").get(custId) as { lifecycle: string })
        .lifecycle
    ).toBe("qualified");
  });

  it("rejects an illegal transition with 409", async () => {
    const res = await PATCH(req(custId, "lead"), ctx(custId)); // qualified -> lead not allowed
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/مجاز نیست/);
  });

  it("rejects an unknown lifecycle value with 400", async () => {
    expect((await PATCH(req(custId, "bogus"), ctx(custId))).status).toBe(400);
  });

  it("refuses a driver", async () => {
    expect((await PATCH(req(custId, "active", "delivery_driver"), ctx(custId))).status).toBe(403);
  });

  it("cannot touch another organisation's customer", async () => {
    const res = await PATCH(req(otherCustId, "qualified"), ctx(otherCustId));
    expect(res.status).toBe(409); // not found -> LifecycleError -> 409, never 200
    expect(
      (await getDb().prepare("SELECT lifecycle FROM customers WHERE id=?").get(otherCustId) as { lifecycle: string })
        .lifecycle
    ).toBe("lead");
  });
});
