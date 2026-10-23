import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-promote-district-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { promoteLeadToCustomer } = await import("@/lib/repo/crm/conversion");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const NOW = "2026-09-29T08:00:00.000Z";
const db = getDb();

/** A coarse enclosing بخش and a fine محله nested inside it, so the point-in-ring result
 *  depends on the ordering rule and not just on "something matched". */
const square = (lng: number, lat: number, size: number) =>
  JSON.stringify({
    type: "Polygon",
    coordinates: [[[lng - size, lat - size], [lng + size, lat - size], [lng + size, lat + size], [lng - size, lat + size], [lng - size, lat - size]]],
  });

const coarse = Number((await db.prepare(
  `INSERT INTO districts (name, level, parent_name, boundary_geojson, code, coverage_status, is_custom, updated_at)
   VALUES ('بخش رودهن','mantaghe','',?,'B11','unknown',0,?)`
).run(square(51.93, 35.73, 0.4), NOW)).lastInsertRowid);

const fine = Number((await db.prepare(
  `INSERT INTO districts (name, level, parent_name, boundary_geojson, code, coverage_status, is_custom, updated_at)
   VALUES ('هراز','mahalle','منطقه 14',?,'1405','unknown',0,?)`
).run(square(51.93, 35.73, 0.02), NOW)).lastInsertRowid);

/** An owner, not phone_sales: canSeeBusiness lets an owner see every business in its own
 *  organisation, so the dedupe path is REACHABLE. A phone_sales session would redact its own
 *  matches and the promotion would correctly refuse with a 409 -- which is the point of that
 *  guard, and not what these tests are about. */
const session = { role: "owner", organizationId: 1, user: { id: 1 }, groupId: null } as never;

const pin = async (name: string, lat: number, lng: number) =>
  Number((await db.prepare(
    `INSERT INTO saved_locations (name, maps_url, lat, lng, created_at, organization_id)
     VALUES (?,?,?,?,?,1)`
  ).run(name, `https://maps.example/${encodeURIComponent(name)}`, lat, lng, NOW)).lastInsertRowid);

const districtOf = async (id: number) =>
  await db.prepare("SELECT district_id FROM customers WHERE id = ?").get(id) as { district_id: number | null };

/** A promoted pin carries its district, so its code comes for free.
 *
 *  This is the path every Google Maps pin takes: a rep drops a pin, the first purchase
 *  promotes it to a customer, and that is where a business first becomes a customer. When
 *  the INSERT listed every column except district_id, a promoted customer got lat and lng
 *  but no district -- so it had no code, no territory and no place on the map, and the
 *  defect was invisible because every other field looked right. */
describe("promoting a pin derives its district", () => {
  it("sets district_id from the pin's own coordinates", async () => {
    const id = await pin("رستوران پردیس", 35.73, 51.93);
    const { customerId, created } = await promoteLeadToCustomer(1, id, session);
    expect(created).toBe(true);
    // The fine محله, not the coarse بخش that also contains the point.
    expect((await districtOf(customerId)).district_id).toBe(fine);
  });

  it("is idempotent: a retry keeps the same district", async () => {
    const id = await pin("تست دوباره", 35.7301, 51.9301);
    const first = await promoteLeadToCustomer(1, id, session);
    const second = await promoteLeadToCustomer(1, id, session);
    expect(second.customerId).toBe(first.customerId);
    expect(second.created).toBe(false);
    expect((await districtOf(first.customerId)).district_id).toBe(fine);
  });

  it("leaves district_id NULL for a pin matching nothing, rather than guessing", async () => {
    // An honest NULL: a point outside every polygon has no district, and inventing one from
    // the nearest would be a guess wearing a foreign key.
    const id = await pin("بیابان", 34.5, 50.5);
    const { customerId } = await promoteLeadToCustomer(1, id, session);
    expect((await districtOf(customerId)).district_id).toBeNull();
  });

  it("fills a linked customer's district only when it has none", async () => {
    // The dedupe path links a pin to a business that is ALREADY a customer. That customer
    // was located by its own means, so its district is not ours to overwrite -- a pin is an
    // approximate drop and could be across the city. COALESCE fills the gap and leaves a
    // real classification alone.
    const linked = Number((await db.prepare(
      `INSERT INTO customers (customer_code, business_name, lat, lng, district_id, lifecycle, synced_at, organization_id)
       VALUES ('LD-1','همان رستوران',35.73,51.93,?, 'lead', ?, 1)`
    ).run(fine, NOW)).lastInsertRowid);
    const id = await pin("همان رستوران", 35.7305, 51.9305);
    const res = await promoteLeadToCustomer(1, id, session);
    expect(res.created).toBe(false);
    expect(res.customerId).toBe(linked);
    expect((await districtOf(linked)).district_id, "an existing district must not be overwritten by a pin").toBe(fine);
  });

  it("gives a linked customer with no district the pin's district", async () => {
    const linked = Number((await db.prepare(
      `INSERT INTO customers (customer_code, business_name, lat, lng, lifecycle, synced_at, organization_id)
       VALUES ('LD-2','بدون منطقه',35.73,51.93,'lead',?,1)`
    ).run(NOW)).lastInsertRowid);
    expect((await districtOf(linked)).district_id).toBeNull();
    const id = await pin("بدون منطقه", 35.7305, 51.9305);
    await promoteLeadToCustomer(1, id, session);
    expect((await districtOf(linked)).district_id, "a gap may be filled from a real coordinate").toBe(fine);
  });

  it("still carries lat/lng, so a later edit can re-derive", async () => {
    const id = await pin("موقعیت", 35.73, 51.93);
    const { customerId } = await promoteLeadToCustomer(1, id, session);
    const row = await db.prepare("SELECT lat, lng FROM customers WHERE id = ?").get(customerId) as { lat: number; lng: number };
    expect(row.lat).toBe(35.73);
    expect(row.lng).toBe(51.93);
    expect(coarse).not.toBe(fine);
  });
});
