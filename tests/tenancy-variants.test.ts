import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* Variants of the cross-tenant read found on 2026-10-22 (architecture audit, step 1.B): code
 * that classifies or aggregates "everything in the database" on behalf of one company.
 * tests/tenancy-routes.test.ts covers route handlers and tests/tenancy-owner-readers.test.ts the
 * owner-wide readers; these cover the rest: lead pins on the map page, the stock page's
 * purchase totals, territory (group) assignment, and the "last facility" guard. */

const testDbPath = path.join(os.tmpdir(), `rf-tenancy-variants-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { readLeadPins } = await import("@/lib/repo/leads");
const { monthPurchaseTotals } = await import("@/lib/purchases");
const { groupForPoint, recomputeCustomerGroups } = await import("@/lib/groups");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");
const facilityRoute = await import("@/app/api/facilities/[id]/route");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];
let districtId = 0;
let custA = 0;
let custB = 0;
const INSIDE = { lat: 35.7, lng: 51.4 };

beforeAll(async () => {
  const db = getDb();
  ({ a, b } = await seedTwoOrgs(db));
  const now = "2026-01-01T00:00:00.000Z";

  for (const [org, name] of [[1, "pin-a"], [2, "pin-b"]] as const) {
    await db.prepare(
      `INSERT INTO saved_locations (name, lat, lng, organization_id, maps_url, created_at) VALUES (?, 35.7, 51.4, ?, 'https://maps.example/x', ?)`
    ).run(name, org, now);
  }

  for (const [org, tag, userId] of [[1, "a", a.ownerId], [2, "b", b.ownerId]] as const) {
    const pid = Number(
      (await db.prepare("INSERT INTO purchases (supplier, purchase_date, created_by, created_at, organization_id) VALUES (?, '2026-03-05', ?, ?, ?)")
        .run(`s-${tag}`, userId, now, org)).lastInsertRowid
    );
    await db.prepare(
      "INSERT INTO purchase_lines (purchase_id, product_id, base_qty, unit_cost_toman, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(pid, org === 1 ? a.productId : b.productId, 10, org === 1 ? 1000 : 5000, now);
  }

  /* One shared district polygon around INSIDE, claimed by org A's group. */
  const square = { type: "Polygon", coordinates: [[[51.3, 35.6], [51.5, 35.6], [51.5, 35.8], [51.3, 35.8], [51.3, 35.6]]] };
  districtId = Number(
    (await db.prepare("INSERT INTO districts (name, level, boundary_geojson, updated_at) VALUES ('shared-d', 'mahalle', ?, ?)")
      .run(JSON.stringify(square), now)).lastInsertRowid
  );
  await db.prepare("UPDATE districts SET group_id = ? WHERE id = ?").run(a.groupId, districtId);

  const mkCust = async (code: string, org: number, group: number | null) =>
    Number(
      (await db.prepare(
        "INSERT INTO customers (customer_code, business_name, lat, lng, group_id, synced_at, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(code, code, INSIDE.lat, INSIDE.lng, group, now, org)).lastInsertRowid
    );
  custA = await mkCust("INSIDE-A", 1, null);
  custB = await mkCust("INSIDE-B", 2, b.groupId);
});

const groupOf = async (id: number) => (await getDb().prepare("SELECT group_id FROM customers WHERE id = ?").get(id) as { group_id: number | null }).group_id;

describe("readLeadPins (the /map page)", () => {
  it("returns only the caller's organisation's pins, or every tenant's for null", async () => {
    const names = async (org: number | null) => (await readLeadPins(getDb(), org)).map((p) => p.name).sort();
    expect(await names(1)).toEqual(["pin-a"]);
    expect(await names(2)).toEqual(["pin-b"]);
    expect(await names(null)).toEqual(["pin-a", "pin-b"]);
  });
});

describe("monthPurchaseTotals (the انبار page header)", () => {
  it("sums only the caller's organisation's purchases", async () => {
    expect(await monthPurchaseTotals(getDb(), 1, "2026-03-01")).toEqual({ n: 1, total: 10_000 });
    expect(await monthPurchaseTotals(getDb(), 2, "2026-03-01")).toEqual({ n: 1, total: 50_000 });
    expect(await monthPurchaseTotals(getDb(), null, "2026-03-01")).toEqual({ n: 2, total: 60_000 });
  });
});

describe("territory: a district claimed by one company's group is not another company's", () => {
  it("groupForPoint gives the claiming organisation its group and everyone else none", async () => {
    expect(await groupForPoint(getDb(), INSIDE.lat, INSIDE.lng, 1)).toBe(a.groupId);
    expect(await groupForPoint(getDb(), INSIDE.lat, INSIDE.lng, 2)).toBeNull();
  });

  it("recomputing org A's customers does not touch org B's, and B's never get A's group", async () => {
    await recomputeCustomerGroups(getDb(), 1);
    expect(await groupOf(custA)).toBe(a.groupId);
    expect(await groupOf(custB)).toBe(b.groupId); // untouched by A's recompute

    await recomputeCustomerGroups(getDb(), 2);
    expect(await groupOf(custB)).not.toBe(a.groupId);
    expect(await groupOf(custA)).toBe(a.groupId); // untouched by B's recompute
  });

  it("recomputing for null (platform_owner) handles each organisation against its own territory", async () => {
    await getDb().prepare("UPDATE customers SET group_id = NULL WHERE id IN (?, ?)").run(custA, custB);
    await recomputeCustomerGroups(getDb(), null);
    expect(await groupOf(custA)).toBe(a.groupId);
    expect(await groupOf(custB)).not.toBe(a.groupId);
  });
});

describe("the last-facility guard counts the caller's own organisation", () => {
  it("refuses to delete an organisation's only facility even when another company has some", async () => {
    const db = getDb();
    // Org 1 keeps exactly one facility (the fixture's warehouse); org 2 keeps its own.
    const mine = await db.prepare("SELECT id FROM facilities WHERE organization_id = 1 ORDER BY id").all() as { id: number }[];
    for (const f of mine.slice(1)) await db.prepare("DELETE FROM facilities WHERE id = ?").run(f.id);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM facilities WHERE organization_id = 2").get() as { n: number }).n).toBeGreaterThan(0);

    const cookie = `${COOKIE_NAME}=${createSessionToken({ uid: a.ownerId, role: "owner", gid: null, oid: 1, tv: 0, name: "A" })}`;
    const res = await facilityRoute.DELETE(
      new NextRequest(`http://localhost/api/facilities/${mine[0].id}`, { method: "DELETE", headers: { cookie } }),
      { params: Promise.resolve({ id: String(mine[0].id) }) } as never,
    );
    expect(res.status).toBe(400);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM facilities WHERE organization_id = 1").get() as { n: number }).n).toBe(1);
  });
});
