import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDbPath = path.join(os.tmpdir(), `rf-unload-${Date.now()}-${process.pid}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { recordMovement, onHand } = await import("@/lib/repo/stock");
const { createVanFacility, loadVan, deliverFromVan } = await import("@/lib/repo/vanStock");
const {
  reconcileUnload,
  shouldReturn,
  samplesFacility,
  DISPOSITIONS,
} = await import("@/lib/repo/unload");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const iso = () => new Date().toISOString();
const ctx = { org: 1, product: 0, warehouse: 0, van: 0, home: 0, run: 0 };

beforeAll(() => {
  const db = getDb();
  const addFacility = (slug: string, kind: string, name: string) =>
    Number(
      db
        .prepare(
          `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, organization_id, created_at, updated_at)
           VALUES (?, ?, ?, 35.5, 51.7, 0, ?, ?, ?)`
        )
        .run(`${slug}-${process.pid}`, kind, name, ctx.org, iso(), iso()).lastInsertRowid
    );
  ctx.product = Number(
    db
      .prepare(
        "INSERT INTO products (name, kg_per_base_unit, organization_id, created_at, updated_at) VALUES (?, 1, ?, ?, ?)"
      )
      .run("کالای تخلیه", ctx.org, iso(), iso()).lastInsertRowid
  );
  ctx.warehouse = addFacility("wh-u", "warehouse", "انبار");
  ctx.home = addFacility("home-u", "home", "خانه");
  recordMovement(ctx.org, {
    facility_id: ctx.warehouse,
    product_id: ctx.product,
    batch_id: null,
    base_qty: 100,
    kind: "PURCHASE_IN",
    occurred_at: iso(),
  });
  ctx.van = createVanFacility(ctx.org, "وانت تخلیه", `پلاک-تخلیه-${process.pid}`);
  const driver = Number(
    db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
         VALUES (?, 'x:y', 'راننده', 'delivery_driver', NULL, 1, ?, ?)`
      )
      .run(`u-driver-${process.pid}`, iso(), ctx.org).lastInsertRowid
  );
  ctx.run = Number(
    db
      .prepare(
        `INSERT INTO delivery_runs (driver_user_id, group_id, run_date, created_by, created_at, updated_at, organization_id)
         VALUES (?, NULL, '2026-10-20', ?, ?, ?, ?)`
      )
      .run(driver, driver, iso(), iso(), ctx.org).lastInsertRowid
  );
  // The unload card the reconciliation closes.
  db.prepare(
    `INSERT INTO run_facility_stops (run_id, facility_id, role, status, created_at, updated_at)
     VALUES (?, ?, 'unload', 'pending', ?, ?)`
  ).run(ctx.run, ctx.home, iso(), iso());
});

/** Put `qty` on the van. */
describe("shouldReturn", () => {
  it("asks the ledger rather than recomputing anything", () => {
    loadOnly(30);
    expect(shouldReturn(ctx.org, ctx.van, ctx.product)).toBe(30);
    // Delivered goods are gone from the van, so they are not part of what should come back.
    deliverFromVan(ctx.org, { facilityId: ctx.van, productId: ctx.product, qty: 12, actorId: null });
    expect(shouldReturn(ctx.org, ctx.van, ctx.product)).toBe(18);
    deliverFromVan(ctx.org, { facilityId: ctx.van, productId: ctx.product, qty: 18, actorId: null });
    expect(shouldReturn(ctx.org, ctx.van, ctx.product)).toBe(0);
    // A REFUSED stop leaves the balance untouched, so this cannot over-count by the refused
    // quantity the way the original `loaded - delivered` formula did.
    loadOnly(5);
    expect(shouldReturn(ctx.org, ctx.van, ctx.product)).toBe(5);
  });
});

describe("reconcileUnload", () => {
  it("refuses to declare less than the balance, and names the gap", () => {
    loadOnly(10);
    expect(() => unload([{ productId: ctx.product, disposition: "returned", qty: 6 }])).toThrow(
      /4|۴/
    );
    // Nothing was written: a half-reconciliation leaves the van wrong with no record.
    expect(shouldReturn(ctx.org, ctx.van, ctx.product)).toBe(10);
    expect(lines()).toEqual({ n: 0 });
  });

  it("refuses to declare more than the balance", () => {
    loadOnly(4);
    expect(() => unload([{ productId: ctx.product, disposition: "returned", qty: 9 }])).toThrow();
  });

  it("takes every line or writes none", () => {
    loadOnly(12);
    // «خراب ۵ کیلو» beside «۳ برگشتی» -- two dispositions, and 8 of 12 accounted for.
    expect(() =>
      unload([
        { productId: ctx.product, disposition: "damaged", qty: 5 },
        { productId: ctx.product, disposition: "returned", qty: 3 },
      ])
    ).toThrow();
    expect(lines()).toEqual({ n: 0 });
  });

  it("returns goods to the facility and empties the van", () => {
    loadOnly(10);
    unload([{ productId: ctx.product, disposition: "returned", qty: 10 }]);
    expect(shouldReturn(ctx.org, ctx.van, ctx.product)).toBe(0);
    expect(onHand(ctx.org, { product_id: ctx.product, facility_id: ctx.home })).toBeGreaterThan(0);
    // The unload card is closed by the same call.
    const card = getDb()
      .prepare("SELECT status FROM run_facility_stops WHERE run_id = ? AND role = 'unload'")
      .get(ctx.run) as { status: string };
    expect(card.status).toBe("done");
  });

  it("writes off goods without returning them anywhere", () => {
    loadOnly(8);
    unload([
      { productId: ctx.product, disposition: "damaged", qty: 5 },
      { productId: ctx.product, disposition: "expired", qty: 3 },
    ]);
    expect(shouldReturn(ctx.org, ctx.van, ctx.product)).toBe(0);
    // damaged and expired are separate dispositions writing the same WRITE_OFF -- different
    // problems, and a manager needs to see which one keeps happening.
    const rows = getDb()
      .prepare("SELECT disposition, qty_base FROM run_unload_lines ORDER BY disposition")
      .all() as unknown as { disposition: string; qty_base: number }[];
    expect(rows).toEqual([
      { disposition: "damaged", qty_base: 5 },
      { disposition: "expired", qty_base: 3 },
    ]);
  });

  it("takes every disposition the table allows", () => {
    for (const disposition of DISPOSITIONS) {
      loadOnly(2);
      unload([{ productId: ctx.product, disposition, qty: 2 }]);
      expect(shouldReturn(ctx.org, ctx.van, ctx.product)).toBe(0);
    }
  });

  it("gives samples a real destination, once per tenant", () => {
    const first = samplesFacility(ctx.org);
    expect(samplesFacility(ctx.org)).toBe(first);
    const row = getDb()
      .prepare("SELECT slug, name, kind FROM facilities WHERE id = ?")
      .get(first) as { slug: string; name: string; kind: string };
    expect(row).toEqual({ slug: "samples-given", name: "نمونه‌های داده‌شده", kind: "other" });
  });

  it("a sample leaves stock and does not come back as on-hand", () => {
    loadOnly(6);
    unload([{ productId: ctx.product, disposition: "sample", qty: 6 }]);
    expect(shouldReturn(ctx.org, ctx.van, ctx.product)).toBe(0);
    // SAMPLE_OUT is a movement OUT and nothing comes back in, so the goods are gone from the
    // books rather than sitting on a shelf somewhere still being counted as stock.
    expect(
      onHand(ctx.org, { product_id: ctx.product, facility_id: samplesFacility(ctx.org) })
    ).toBe(0);
  });
});

/** Start every test from an EMPTY van.
 *
 *  These tests share one van and one product, so a balance left behind by an earlier test
 *  silently changes what the next one means: declaring 6 of 10 is a shortfall, but declaring
 *  6 of 15 is a DIFFERENT shortfall and the error names a different gap. Every test passed
 *  alone and failed in sequence, which is how that was found. */
beforeEach(() => {
  const left = shouldReturn(ctx.org, ctx.van, ctx.product);
  if (left > 0) {
    deliverFromVan(ctx.org, { facilityId: ctx.van, productId: ctx.product, qty: left, actorId: null });
  }
  getDb().prepare("DELETE FROM run_unload_lines").run();
  getDb()
    .prepare("UPDATE run_facility_stops SET status = 'pending', done_at = NULL WHERE run_id = ?")
    .run(ctx.run);
});

/** Put `qty` on the van. */
function loadOnly(qty: number) {
  loadVan(ctx.org, { facilityId: ctx.van, productId: ctx.product, qty, actorId: null });
}

/** How many unload lines have been recorded -- the test for "nothing was written". */
const lines = () =>
  getDb().prepare("SELECT COUNT(*) n FROM run_unload_lines").get() as unknown as { n: number };

const unload = (l: Parameters<typeof reconcileUnload>[0]["lines"]) =>
  reconcileUnload({
    runId: ctx.run,
    organizationId: ctx.org,
    vanFacilityId: ctx.van,
    facilityId: ctx.home,
    lines: l,
    actorId: null,
  });