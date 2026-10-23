import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDbPath = path.join(os.tmpdir(), `rf-vanstock-${Date.now()}-${process.pid}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, dbReady } = await import("@/lib/db");
const { onHand, recordMovement } = await import("@/lib/repo/stock");
const { createVanFacility, loadVan, deliverFromVan } = await import("@/lib/repo/vanStock");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const iso = () => new Date().toISOString();
const ctx = { org: 1, product: 0, warehouse: 0, van: 0 };

beforeAll(async () => {
  const db = getDb();
  ctx.product = Number(
    (await db.prepare("INSERT INTO products (name, kg_per_base_unit, organization_id, created_at, updated_at) VALUES (?, 1, ?, ?, ?)")
      .run("کالای وانت", ctx.org, iso(), iso())).lastInsertRowid,
  );
  ctx.warehouse = Number(
    (await db.prepare(
      "INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, updated_at, organization_id, created_at) VALUES (?, 'warehouse', 'انبار', 0, 0, 1, ?, ?, ?)",
    ).run(`wh-${process.pid}`, iso(), ctx.org, iso())).lastInsertRowid,
  );
  // Stock already in the warehouse to load from.
  await recordMovement(ctx.org, {
    facility_id: ctx.warehouse,
    product_id: ctx.product,
    batch_id: null,
    base_qty: 100,
    kind: "PURCHASE_IN",
    occurred_at: iso(),
  });
});

describe("the facilities migration", () => {
  it("widens the kind CHECK without duplicating or orphaning a single row", async () => {
    // THE REGRESSION, and the reason this file has a migration test at all.
    //
    // A first attempt added its own rebuild alongside `rebuildForTenantUnique`. Both ran, in
    // sequence, and 2 facilities became 4 — every warehouse duplicated, with no error anywhere.
    // It only surfaced because a REAL-DATA migration test was pointed at a production backup;
    // the fresh-database tests were perfectly happy, because on a fresh database the second
    // rebuild is a no-op.
    //
    // So the property is asserted directly: a database that already carries facilities and the
    // tenant UNIQUE constraint (i.e. a migrated production database) keeps exactly its rows, and
    // ends up able to hold a van.
    const db = getDb();
    const iso2 = iso();
    const seed = (await db.prepare(
      "INSERT INTO facilities (slug, kind, name, lat, lng, organization_id, created_at, updated_at) VALUES (?, 'home', ?, NULL, NULL, ?, ?, ?)",
    ).run(`mig-${process.pid}`, "خانه قدیمی", ctx.org, iso2, iso2)).lastInsertRowid;

    type FacRow = { id: number; slug: string; kind: string; organization_id: number | null };
    const read = async () =>
      await db.prepare("SELECT id, slug, kind, organization_id FROM facilities ORDER BY id").all() as unknown as FacRow[];
    const countSeed = (rows: FacRow[]) => rows.filter((r) => r.slug === `mig-${process.pid}`).length;

    const rowsBefore = await read();
    expect(countSeed(rowsBefore)).toBe(1);

    // Force the rebuild path the way production takes it, then re-read.
    await dbReady();
    const rowsAfter = await read();

    expect(rowsAfter).toEqual(rowsBefore);
    expect(countSeed(rowsAfter)).toBe(1);
    expect(seed).toBeGreaterThan(0);
  });

  it("lets a van be created against a database that already had warehouses", async () => {
    const vanId = await createVanFacility(ctx.org, "وانت-نهایی", `FINAL-${process.pid}`);
    const row = await getDb().prepare("SELECT kind, organization_id FROM facilities WHERE id = ?").get(vanId) as {
      kind: string;
      organization_id: number;
    };
    expect(row.kind).toBe("van");
    expect(row.organization_id).toBe(ctx.org);
  });
});

describe("createVanFacility", () => {
  it("creates a facility a van can hold stock in", async () => {
    // Today there is no `locations` table and `stock_movements.facility_id` references a
    // warehouse. So "the driver had it on the van" was something that happened and was never
    // written down — and a delivery from the van would decrement the WAREHOUSE a second time.
    const id = await createVanFacility(ctx.org, `وانت-${process.pid}`, "پلاک تست");
    const row = await getDb().prepare("SELECT kind, name FROM facilities WHERE id = ?").get(id) as {
      kind: string;
      name: string;
    };
    expect(row.kind).toBe("van");
  });

  it("is idempotent for the same plate, so a reload does not create a second van", async () => {
    const plate = `پلاک-تکراری-${process.pid}`;
    const first = await createVanFacility(ctx.org, `وانت-۲-${process.pid}`, plate);
    const second = await createVanFacility(ctx.org, `وانت-۲-${process.pid}`, plate);
    expect(second).toBe(first);
  });
});

describe("loadVan", () => {
  it("moves stock warehouse -> van as a PAIR of movements, leaving the total unchanged", async () => {
    ctx.van = await createVanFacility(ctx.org, `وانت-بار-${process.pid}`, `پلاک-بار-${process.pid}`);

    const before = await onHand(ctx.org, { product_id: ctx.product, facility_id: ctx.warehouse });
    const vanBefore = await onHand(ctx.org, { product_id: ctx.product, facility_id: ctx.van });

    await loadVan(ctx.org, { facilityId: ctx.van, productId: ctx.product, qty: 30, actorId: null });

    // The warehouse gave up exactly what the van took. Nothing was created or destroyed.
    expect(await onHand(ctx.org, { product_id: ctx.product, facility_id: ctx.warehouse })).toBe(before - 30);
    expect(await onHand(ctx.org, { product_id: ctx.product, facility_id: ctx.van })).toBe(vanBefore + 30);

    // Both legs are recorded, and each against the facility it actually belongs to: the van
    // RECEIVES (TRANSFER_IN) and the warehouse LOSES (TRANSFER_OUT). Asserted per facility,
    // because "two rows exist somewhere" would still pass if both had landed on the same one —
    // which is the exact shape of the double-count this phase exists to prevent.
    const db = getDb();
    const kindsAt = async (facilityId: number) =>
      (await db.prepare("SELECT kind FROM stock_movements WHERE facility_id = ? ORDER BY id").all(facilityId) as { kind: string }[]).map((k) => k.kind);

    expect(await kindsAt(ctx.van)).toEqual(["TRANSFER_IN"]);
    expect(await kindsAt(ctx.warehouse)).toEqual(["PURCHASE_IN", "TRANSFER_OUT"]);
  });

  it("refuses to load more than the warehouse actually holds", async () => {
    // A van cannot carry stock that was never there. Without this the warehouse goes negative
    // and every later "what is on hand" answer is quietly wrong.
    const onHandNow = await onHand(ctx.org, { product_id: ctx.product, facility_id: ctx.warehouse });
    await expect((async () =>
      await loadVan(ctx.org, { facilityId: ctx.van, productId: ctx.product, qty: onHandNow + 1, actorId: null }))()).rejects.toThrow();
  });
});

describe("deliverFromVan", () => {
  it("decrements the VAN, and never the warehouse — the double-count this phase exists to stop", async () => {
    // THE REGRESSION. A delivery writes DELIVERY_OUT against a facility. There was nowhere to
    // record that the goods had already left the warehouse when the van was loaded, so a van
    // delivery would hit the warehouse a second time and quietly inflate what it holds.
    const db = getDb();
    const whBefore = await onHand(ctx.org, { product_id: ctx.product, facility_id: ctx.warehouse });
    const vanBefore = await onHand(ctx.org, { product_id: ctx.product, facility_id: ctx.van });

    await deliverFromVan(ctx.org, { facilityId: ctx.van, productId: ctx.product, qty: 10, actorId: null });

    expect(await onHand(ctx.org, { product_id: ctx.product, facility_id: ctx.van })).toBe(vanBefore - 10);
    expect(await onHand(ctx.org, { product_id: ctx.product, facility_id: ctx.warehouse })).toBe(whBefore);

    // And the movement is recorded as a DELIVERY_OUT so the ledger reads correctly.
    const last = await db
      .prepare("SELECT kind FROM stock_movements WHERE facility_id = ? ORDER BY id DESC LIMIT 1")
      .get(ctx.van) as { kind: string };
    expect(last.kind).toBe("DELIVERY_OUT");
  });

  it("refuses to deliver more than the van holds", async () => {
    const vanNow = await onHand(ctx.org, { product_id: ctx.product, facility_id: ctx.van });
    await expect((async () =>
      await deliverFromVan(ctx.org, { facilityId: ctx.van, productId: ctx.product, qty: vanNow + 1, actorId: null }))()).rejects.toThrow();
  });
});

describe("vanFacilityFor", () => {
  /* delivery_runs carries NO vehicle column, so a delivery knows its driver and nothing about
   * which van the goods came off. `vehicles.driver_default_id` is the only link there is, and
   * it is a DEFAULT -- recorded here so the limitation is visible rather than discovered the
   * first time somebody swaps vans for a day. */

  it("returns null for a driver with no van, rather than throwing", async () => {
    const { vanFacilityFor } = await import("@/lib/repo/vanStock");
    const db = getDb();
    const stranger = Number(
      (await db
        .prepare(
          "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, 'x:y', ?, 'delivery_driver', NULL, 1, ?, ?)",
        )
        .run(`no-van-${process.pid}`, "بدون وانت", iso(), ctx.org)).lastInsertRowid,
    );
    // A driver with no van is an ordinary state. The caller needs to be able to ASK without a
    // try/catch, and a missing van must not fail somebody's delivery at the door.
    expect(await vanFacilityFor(ctx.org, stranger)).toBeNull();
  });

  it("resolves a driver's default van to a facility, idempotently", async () => {
    const { vanFacilityFor } = await import("@/lib/repo/vanStock");
    const db = getDb();
    const driver = Number(
      (await db
        .prepare(
          "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, 'x:y', ?, 'delivery_driver', NULL, 1, ?, ?)",
        )
        .run(`has-van-${process.pid}`, "راننده", iso(), ctx.org)).lastInsertRowid,
    );
    const plate = `پلاک-${process.pid}-r`;
    await db.prepare(
      `INSERT INTO vehicles (organization_id, plate, name, driver_default_id, active, created_at, updated_at)
       VALUES (?, ?, 'وانت راننده', ?, 1, ?, ?)`,
    ).run(ctx.org, plate, driver, iso(), iso());

    const first = await vanFacilityFor(ctx.org, driver);
    const second = await vanFacilityFor(ctx.org, driver);
    // Idempotent on the plate: two calls cannot split one van's stock across two facilities,
    // which is exactly what createVanFacility's own comment warns about.
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });
});