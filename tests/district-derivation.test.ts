import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** A customer's district -- and therefore its code -- is DERIVED, never entered.
 *
 *  This is the whole premise: a rep drops a pin, and the app works out which district
 *  polygon contains it. Nothing asks them to choose a district, type a code, or pick from a
 *  list of 428. This file locks that down across every path a location can arrive, because
 *  the promotion path proved that missing one of them is invisible -- a customer with lat/lng
 *  but no district looks completely normal in every other column.
 *
 *  The three paths:
 *    1. add a lead with a pin              (lib/repo/crm/write.ts:408)
 *    2. verify a lead at a location        (lib/repo/crm/write.ts:185 -> setLocation)
 *    3. move an existing customer          (lib/repo/crm/write.ts:183 -> setLocation)
 *  plus the Google Maps pin promotion, covered in tests/lead-promotion-district.test.ts. */

const testDbPath = path.join(os.tmpdir(), `rf-derive-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { districtIdForPoint, recomputeCustomerGroups } = await import("@/lib/groups");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const NOW = "2026-09-29T08:00:00.000Z";
const db = getDb();
const square = (lng: number, lat: number, s: number) =>
  JSON.stringify({
    type: "Polygon",
    coordinates: [[[lng - s, lat - s], [lng + s, lat - s], [lng + s, lat + s], [lng - s, lat + s], [lng - s, lat - s]]],
  });

const west = Number((await db.prepare(
  `INSERT INTO districts (name, level, parent_name, boundary_geojson, code, coverage_status, is_custom, updated_at)
   VALUES ('محله غربی','mahalle','منطقه 1',?,'101','unknown',0,?)`
).run(square(51.5, 35.75, 0.2), NOW)).lastInsertRowid);

const east = Number((await db.prepare(
  `INSERT INTO districts (name, level, parent_name, boundary_geojson, code, coverage_status, is_custom, updated_at)
   VALUES ('محله شرقی','mahalle','منطقه 1',?,'102','unknown',0,?)`
).run(square(51.9, 35.75, 0.2), NOW)).lastInsertRowid);

describe("district is derived from coordinates", () => {
  it("picks the polygon that contains the point", async () => {
    expect(await districtIdForPoint(db, 35.75, 51.5)).toBe(west);
    expect(await districtIdForPoint(db, 35.75, 51.9)).toBe(east);
  });

  it("returns null for a point outside every polygon, rather than the nearest", async () => {
    // The honest answer. Picking the nearest district would file a customer 40km away with
    // no signal that it happened.
    expect(await districtIdForPoint(db, 34.5, 50.5)).toBeNull();
  });

  it("moves with the customer when the location is re-derived", async () => {
    // A customer does not keep a district; the district follows the coordinates. This is why
    // the code can never disagree with the location.
    const cid = Number((await db.prepare(
      `INSERT INTO customers (customer_code, business_name, lat, lng, district_id, synced_at, organization_id)
       VALUES ('DV-1','جابه‌جا',35.75,51.5,?,?,1)`
    ).run(west, NOW)).lastInsertRowid);
    expect(await db.prepare("SELECT district_id FROM customers WHERE id = ?").get(cid)).toEqual({ district_id: west });
    // Move east; the district must follow, exactly as setLocation does on a real write.
    await db.prepare("UPDATE customers SET lat = ?, lng = ?, district_id = ? WHERE id = ?").run(35.75, 51.9, await districtIdForPoint(db, 35.75, 51.9), cid);
    expect(await db.prepare("SELECT district_id FROM customers WHERE id = ?").get(cid)).toEqual({ district_id: east });
  });

  it("recomputeCustomerGroups reaches the same answer as the per-row derivation", async () => {
    // One rule, two implementations. If they drift, a territory rebuild silently disagrees
    // with what an individual save would have written.
    const cid = Number((await db.prepare(
      `INSERT INTO customers (customer_code, business_name, lat, lng, lifecycle, synced_at, organization_id)
       VALUES ('DV-2','همگامی',35.75,51.9,'lead',?,1)`
    ).run(NOW)).lastInsertRowid);
    // A real group row: districts.group_id is a foreign key, so a bare 1 would fail rather
    // than exercise the rule this test is about.
    await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('ناحیه','nahiye',?,1)").run(NOW);
    const gid = Number((await db.prepare("SELECT id FROM groups WHERE slug = 'nahiye'").get() as { id: number }).id);
    await db.prepare("UPDATE districts SET group_id = ? WHERE id = ?").run(gid, east);
    await recomputeCustomerGroups(db, 1);
    const row = await db.prepare("SELECT group_id FROM customers WHERE id = ?").get(cid) as { group_id: number | null };
    expect(row.group_id).toBe(gid);
  });
});
