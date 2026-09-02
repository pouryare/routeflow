import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-adminreps-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/admin/representatives/route");
const { GET: GET_ONE, PATCH } = await import("@/app/api/admin/representatives/[id]/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { ONBOARDING_STEPS } = await import("@/lib/repOnboarding");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let ownerId = 0;
let sellerId = 0;
let custId = 0;

beforeAll(() => {
  const db = getDb();
  db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'Two','two','2026-01-01')`);
  const now = new Date().toISOString();
  ownerId = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'owner',NULL,1,?,1)"
      )
      .run("ar-owner", "x:y", "مالک", now).lastInsertRowid
  );
  sellerId = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'salesperson',NULL,1,?,1)"
      )
      .run("ar-seller", "x:y", "فروشنده", now).lastInsertRowid
  );
  custId = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('W1','عمده‌فروش','WHOLESALE','qualified','2026-01-01',1)"
      )
      .run().lastInsertRowid
  );
  // A rep in org 2 with the same rep_code -- collision must be allowed across orgs.
  const otherCust = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('W1','x','WHOLESALE','active','2026-01-01',2)"
      )
      .run().lastInsertRowid
  );
  db.prepare(
    "INSERT INTO representative_profiles (organization_id,customer_id,rep_code,stage,credit_terms_days,created_at,updated_at) VALUES (2,?,'R1','active',0,?,?)"
  ).run(otherCust, now, now);
});

function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}
function req(
  url: string,
  init: { method?: string; body?: string; as?: number; role?: string } = {}
) {
  const { as = ownerId, role = "owner", method, body } = init;
  return new NextRequest(`http://localhost${url}`, {
    method,
    body,
    headers: { "Content-Type": "application/json", cookie: cookie(as, role) },
  });
}
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

describe("/api/admin/representatives", () => {
  let repId = 0;

  it("creates a representative and seeds its onboarding", async () => {
    const res = await POST(
      req("/api/admin/representatives", { method: "POST", body: JSON.stringify({ customer_id: custId, rep_code: "R1" }) })
    );
    expect(res.status).toBe(201);
    repId = (await res.json()).id;

    const one = await GET_ONE(req(`/api/admin/representatives/${repId}`), ctx(repId));
    const body = await one.json();
    expect(body.onboarding.length).toBe(ONBOARDING_STEPS.length);
    expect(body.representative.stage).toBe("prospect");
  });

  it("rejects a duplicate rep_code within the org", async () => {
    const c2 = Number(
      getDb()
        .prepare(
          "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('W2','y','WHOLESALE','qualified','2026-01-01',1)"
        )
        .run().lastInsertRowid
    );
    const res = await POST(
      req("/api/admin/representatives", { method: "POST", body: JSON.stringify({ customer_id: c2, rep_code: "R1" }) })
    );
    expect(res.status).toBe(409);
  });

  it("lists the org's representatives (not org 2's)", async () => {
    const body = await (await GET(req("/api/admin/representatives"))).json();
    expect(body.representatives.map((r: { rep_code: string }) => r.rep_code)).toEqual(["R1"]);
    expect(body.representatives[0].business_name).toBe("عمده‌فروش");
  });

  it("409s advancing straight to active before onboarding", async () => {
    const res = await PATCH(
      req(`/api/admin/representatives/${repId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "advance", stage: "active" }),
      }),
      ctx(repId)
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/مجاز نیست|کامل نشده/);
  });

  it("ticks an onboarding step", async () => {
    const res = await PATCH(
      req(`/api/admin/representatives/${repId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "complete_step", step_code: "contract_signed" }),
      }),
      ctx(repId)
    );
    expect(res.status).toBe(200);
    const one = await (await GET_ONE(req(`/api/admin/representatives/${repId}`), ctx(repId))).json();
    expect(one.onboarding.find((s: { step_code: string }) => s.step_code === "contract_signed").completed_at).toBeTruthy();
  });

  it("refuses a salesperson", async () => {
    expect((await GET(req("/api/admin/representatives", { as: sellerId, role: "salesperson" }))).status).toBe(403);
  });

  it("404s another org's representative id", async () => {
    const other = getDb().prepare("SELECT id FROM representative_profiles WHERE organization_id = 2").get() as {
      id: number;
    };
    const res = await GET_ONE(req(`/api/admin/representatives/${other.id}`), ctx(other.id));
    expect(res.status).toBe(404);
  });
});
