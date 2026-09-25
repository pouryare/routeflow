import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-convert-retains-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { POST } = await import("@/app/api/locations/[id]/convert/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

/** The convert route used to DELETE the saved_locations row after promoting it.
 *
 *  That reads fine -- a promoted venue is not a prospect -- but lead_list_items.location_id
 *  is ON DELETE CASCADE, so the delete also removed the stop from every route that
 *  referenced it. A manager converting a lead from the office could therefore pull a stop out
 *  of the run a driver was standing on, with no message to either of them. These tests pin
 *  the pin in place and the link in customers.lead_location_id. */

let ownerId = 0;
let groupId = 0;
let counter = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  groupId = Number(
    db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('گروه', 'convert-retains', ?, 1)")
      .run(now).lastInsertRowid
  );
  ownerId = Number(
    db.prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES ('owner','x:y','مالک','owner',NULL,1,?,1)")
      .run(now).lastInsertRowid
  );
});

/** A pin in the lead pool, optionally already on a route. */
function seedLead(name: string, onAList: boolean): number {
  const db = getDb();
  const now = new Date().toISOString();
  // Spread the coordinates so two leads never look like the same shop to the dedup check.
  const id = Number(
    db.prepare("INSERT INTO saved_locations (name, maps_url, lat, lng, resolution, group_id, created_at, organization_id) VALUES (?, ?, ?, 51.4, 'manual', ?, ?, 1)")
      .run(name, `https://maps.example/${name}`, 35.7 + counter++ * 0.002, groupId, now).lastInsertRowid
  );
  if (onAList) {
    const listId = Number(
      db.prepare("INSERT INTO lead_lists (name, organization_id, created_at, updated_at) VALUES (?, 1, ?, ?)").run(`فهرست ${name}`, now, now).lastInsertRowid
    );
    db.prepare("INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (?, ?, 0, ?)").run(listId, id, now);
  }
  return id;
}

const convert = (id: number) =>
  POST(
    new NextRequest(`http://localhost/api/locations/${id}/convert`, {
      method: "POST",
      headers: { cookie: `${COOKIE_NAME}=${createSessionToken({ uid: ownerId, role: "owner", gid: null, oid: 1, tv: 0, name: "t" })}` },
    }),
    { params: Promise.resolve({ id: String(id) }) } as never
  );
const pin = (id: number) => getDb().prepare("SELECT * FROM saved_locations WHERE id = ?").get(id) as { name: string } | undefined;
const itemsFor = (id: number) =>
  getDb().prepare("SELECT COUNT(*) AS n FROM lead_list_items WHERE location_id = ?").get(id) as { n: number };
const customerFor = (id: number) =>
  getDb().prepare("SELECT id, customer_code, lead_location_id FROM customers WHERE lead_location_id = ?").get(id) as
    | { id: number; customer_code: string; lead_location_id: number }
    | undefined;


describe("converting a lead keeps the pin", () => {
  it("leaves the saved_locations row in place", async () => {
    const id = seedLead("هتل الف", false);
    const res = await convert(id);
    expect(res.status).toBe(200);
    expect(pin(id)).toBeDefined();
  });

  it("keeps it on the list it was on -- the cascade this replaces would have emptied", async () => {
    const id = seedLead("هتل ب", true);
    expect(itemsFor(id).n).toBe(1);
    await convert(id);
    // The whole point. A route that loses a stop because somebody promoted the lead is a
    // route nobody can explain to the driver standing in front of it.
    expect(itemsFor(id).n).toBe(1);
    expect(pin(id)).toBeDefined();
  });

  it("links the customer back to the pin, and keeps the LEAD- namespace", async () => {
    const id = seedLead("هتل پ", false);
    const res = await convert(id);
    const body = (await res.json()) as { customerId: number; created: boolean };
    expect(body.created).toBe(true);
    const row = customerFor(id);
    expect(row?.id).toBe(body.customerId);
    // The code is deterministic, which is what makes a retry land on the same row.
    expect(row?.customer_code).toBe(`LEAD-${id}`);
  });

  it("writes no lifecycle: the order moves it, not the conversion", async () => {
    const id = seedLead("هتل ت", false);
    await convert(id);
    const row = getDb().prepare("SELECT lifecycle FROM customers WHERE lead_location_id = ?").get(id) as { lifecycle: string };
    // Rule 1 says a lead becomes a customer when it *buys*. Promotion alone is not a
    // purchase, so the row is still a lead until the order lands and the activity log runs.
    expect(row.lifecycle).toBe("lead");
  });
});

describe("converting twice", () => {
  it("returns the same customer rather than a second one", async () => {
    const id = seedLead("هتل ث", false);
    const first = (await (await convert(id)).json()) as { customerId: number; created: boolean };
    const second = (await (await convert(id)).json()) as { customerId: number; created: boolean };
    expect(second.customerId).toBe(first.customerId);
    expect(second.created).toBe(false);
    const all = getDb().prepare("SELECT COUNT(*) AS n FROM customers WHERE business_name = 'هتل ث'").get() as { n: number };
    expect(all.n).toBe(1);
  });
});

describe("a lead that cannot be promoted", () => {
  it("refuses a pin with no coordinates, and says why", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const id = Number(
      db.prepare("INSERT INTO saved_locations (name, maps_url, lat, lng, resolution, group_id, created_at, organization_id) VALUES ('بدون مختصات','u',NULL,NULL,'manual',?,?,1)")
        .run(groupId, now).lastInsertRowid
    );
    const res = await convert(id);
    expect(res.status).toBe(422);
    // Nothing half-done on the way out.
    expect(customerFor(id)).toBeUndefined();
    expect(pin(id)).toBeDefined();
  });
});
