import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { tableInfo } from "./helpers/schema";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-tenancy-writers-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct } = await import("@/lib/catalogue");
const { recordPurchase } = await import("@/lib/purchases");
const { createRun } = await import("@/lib/delivery");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");
const districts = await import("@/app/api/districts/route");
const locations = await import("@/app/api/locations/route");
const facilities = await import("@/app/api/facilities/route");
const convert = await import("@/app/api/locations/[id]/convert/route");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

// Everything a write path touches has to carry the writer's organisation. A row
// inserted with a NULL organization_id is invisible to every owner/organisation
// filter -- a silent leak, not a loud one -- so these tests pin each write path to
// a second organisation and check the row landed there.
const ORG2 = 2;
const ctx = { owner2: 0, driver2: 0, product2: 0 };

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  await db.exec(`INSERT INTO organizations (id, name, slug, created_at) VALUES (${ORG2}, 'Two', 'two', '${now}')`);

  const user = db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
     VALUES (?, 'x:y', ?, ?, NULL, 1, ?, ?)`
  );
  ctx.owner2 = Number((await user.run("owner-two", "مالک دو", "owner", now, ORG2)).lastInsertRowid);
  ctx.driver2 = Number(
    (await db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
         VALUES (?, 'x:y', ?, 'delivery_driver', NULL, 1, ?, ?)`
      )
      .run("driver-two", "راننده دو", now, ORG2)).lastInsertRowid
  );
  // This file exercises TWO tenants, so org 2 needs its own warehouse. The old auto-create
  // quietly made one per tenant at 0,0; ensureWarehouse makes a real one, per org.
  await ensureWarehouse(db, ORG2);
  ctx.product2 = await createProduct(db, { name: "کالای دو", kg_per_base_unit: 1, organization_id: ORG2 });
});

function cookie() {
  const token = createSessionToken({ uid: ctx.owner2, role: "owner", gid: null, oid: ORG2, tv: 0, name: "مالک دو" });
  return `${COOKIE_NAME}=${token}`;
}

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie: cookie() },
  });
}

const orgOf = async (table: string, id: number) =>
  (await getDb().prepare(`SELECT organization_id FROM ${table} WHERE id = ?`).get(id) as { organization_id: number })
    .organization_id;

describe("lib writers stamp the caller's organisation", () => {
  it("createProduct", async () => {
    expect(await orgOf("products", ctx.product2)).toBe(ORG2);
  });

  it("recordPurchase", async () => {
    const id = await recordPurchase(getDb(), {
      supplier: "تامین‌کننده",
      purchase_date: "2026-05-01",
      created_by: ctx.owner2,
      organization_id: ORG2,
      lines: [{ product_id: ctx.product2, base_qty: 10, unit_cost_toman: 1000 }],
    });
    expect(await orgOf("purchases", id)).toBe(ORG2);
  });

  it("createRun", async () => {
    const id = await createRun(getDb(), {
      driver_user_id: ctx.driver2,
      run_date: "2026-05-01",
      created_by: ctx.owner2,
      organization_id: ORG2,
    });
    expect(await orgOf("delivery_runs", id)).toBe(ORG2);
  });
});

describe("API write paths stamp the session's organisation", () => {
  it("POST /api/districts", async () => {
    const res = await districts.POST(
      post("/api/districts", {
        name: "محله آزمون دو",
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        coverage_status: "unknown",
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    // districts is the one write path that does NOT stamp an organisation, and that is the
    // point of it: Tehran's 22 منطقه are shared reference data, identical for every
    // organisation, so a per-tenant copy would drift until منطقه 14 meant two places. The row
    // has no organization_id column at all -- asserting one here would re-add the very
    // tenancy this table was removed from.
    const db = getDb();
    // The real assertion: the column is gone, so no organisation could have been stamped.
    // This is the whole point of districts being shared, and it is why the org-stamping
    // check above does not apply to this route.
    expect(
      (await tableInfo("districts")).map((c) => c.name),
      "districts must not carry an organization_id"
    ).not.toContain("organization_id");

    const row = await db.prepare("SELECT is_custom, group_id FROM districts WHERE id = ?").get(body.id) as
      | { is_custom: number; group_id: number | null }
      | undefined;
    expect(row, "the drawn district must exist").toBeDefined();
    expect(row!.is_custom).toBe(1);
    // group_id is what scopes a district for territory instead, and it is nullable on
    // purpose: a district nobody has claimed yet is a real state, and this session's user
    // has no group. So NULL here is the correct outcome, not a missing stamp.
    expect(row!.group_id).toBeNull();
  });

  it("POST /api/locations", async () => {
    const res = await locations.POST(
      post("/api/locations", {
        items: [{ name: "پین دو", mapsUrl: "https://maps.example/two", lat: 35.7, lng: 51.4 }],
      })
    );
    expect(res.status).toBe(200);
    const row = await getDb()
      .prepare("SELECT id FROM saved_locations WHERE maps_url = ?")
      .get("https://maps.example/two") as { id: number };
    expect(await orgOf("saved_locations", row.id)).toBe(ORG2);
  });

  it("POST /api/facilities", async () => {
    const res = await facilities.POST(
      post("/api/facilities", { name: "انبار دو", kind: "warehouse", lat: 35.7, lng: 51.4 })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(await orgOf("facilities", body.id)).toBe(ORG2);
  });

  it("POST /api/locations/[id]/convert", async () => {
    const now = new Date().toISOString();
    const loc = await getDb()
      .prepare(
        `INSERT INTO saved_locations (name, maps_url, address, lat, lng, resolution, group_id, created_at, updated_at, organization_id)
         VALUES (?, ?, ?, ?, ?, 'manual', NULL, ?, ?, ?)`
      )
      .run("مشتری بالقوه دو", "https://maps.example/lead-two", "جایی", 35.71, 51.41, now, now, ORG2);
    const locId = Number(loc.lastInsertRowid);

    const res = await convert.POST(post(`/api/locations/${locId}/convert`, {}), {
      params: Promise.resolve({ id: String(locId) }),
    } as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(await orgOf("customers", body.customerId)).toBe(ORG2);
  });
});
