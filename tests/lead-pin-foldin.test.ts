import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-foldin-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, foldLeadPinsIntoCustomers } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("lead-pin fold-in", () => {
  it("converts pinned leads to customers and clears the pins", () => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (3,'T','t','2026-01-01')`);
    db.exec(`INSERT INTO groups (id,name,slug,created_at,organization_id) VALUES (30,'G','g','2026-01-01',3)`);
    // A pin in a lead list...
    db.exec(`INSERT INTO saved_locations (id, name, maps_url, address, lat, lng, resolution, notes, group_id, created_at, updated_at, organization_id)
             VALUES (900, 'رستوران تست', 'https://maps.example/x', 'جایی', 35.7, 51.4, 'manual', 'یادداشت', 30, '2026-01-01','2026-01-01', 3)`);
    db.exec(`INSERT INTO lead_lists (id, name, created_at, updated_at) VALUES (40, 'L', '2026-01-01','2026-01-01')`);
    db.exec(`INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (40, 900, 0, '2026-01-01')`);
    // ...and a pin NOT in any list (left alone)
    db.exec(`INSERT INTO saved_locations (id, name, maps_url, resolution, group_id, created_at, updated_at, organization_id)
             VALUES (901, 'رها', 'https://maps.example/y', 'manual', 30, '2026-01-01','2026-01-01', 3)`);

    foldLeadPinsIntoCustomers(db);

    const cust = db
      .prepare(
        "SELECT customer_code, lifecycle, organization_id, group_id, business_name, notes FROM customers WHERE customer_code='LEAD-900'"
      )
      .get() as
      | { customer_code: string; lifecycle: string; organization_id: number; group_id: number; business_name: string; notes: string }
      | undefined;
    expect(cust).toMatchObject({
      lifecycle: "lead",
      organization_id: 3,
      group_id: 30,
      business_name: "رستوران تست",
      notes: "یادداشت",
    });
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=900").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM lead_list_items WHERE location_id=900").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=901").get()).toBeTruthy(); // untouched

    // idempotent
    expect(() => foldLeadPinsIntoCustomers(db)).not.toThrow();
    expect(
      db.prepare("SELECT COUNT(*) n FROM customers WHERE customer_code='LEAD-900'").get()
    ).toMatchObject({ n: 1 });
  });

  it("records that it ran, so the boot migration skips it", () => {
    const marker = getDb()
      .prepare("SELECT value FROM app_meta WHERE key = 'lead_pin_foldin_done'")
      .get();
    expect(marker).toBeTruthy();
  });
});
