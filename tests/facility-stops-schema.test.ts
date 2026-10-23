import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-facility-stops-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

// Dynamic: getDb reads ROUTEFLOW_DB_PATH at module load, so a static import would bind the
// real database rather than this file's.
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const iso = () => new Date().toISOString();

let seq = 0;

/** A fresh organisation, depot, driver, run and product per call.
 *
 *  Not idempotent BY DESIGN on the organisation: several tests need the same `facilities`
 *  slug and `users.username`, both of which are UNIQUE per tenant, so a shared fixture
 *  would collide. Each call gets its own org and its own ids instead. */
async function seed() {
  const db = getDb();
  const n = ++seq;
  const org = 7000 + n;
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, created_at) VALUES (?, ?, ?, ?)"
  ).run(org, `fs-org-${n}`, "t", iso());
  const facility = Number(
    (await db
      .prepare(
        `INSERT INTO facilities (slug, kind, name, lat, lng, organization_id, created_at, updated_at)
         VALUES (?, 'warehouse', 'انبار', 35.5, 51.7, ?, ?, ?)`
      )
      .run(`fs-depot-${n}`, org, iso(), iso())).lastInsertRowid
  );
  const driver = Number(
    (await db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
         VALUES (?, 'x:y', ?, 'delivery_driver', NULL, 1, ?, ?)`
      )
      .run(`fs-driver-${n}`, "راننده", iso(), org)).lastInsertRowid
  );
  const run = Number(
    (await db
      .prepare(
        `INSERT INTO delivery_runs (driver_user_id, group_id, run_date, created_by, created_at, updated_at, organization_id)
         VALUES (?, NULL, ?, ?, ?, ?, ?)`
      )
      .run(driver, `2026-10-${10 + n}`, driver, iso(), iso(), org)).lastInsertRowid
  );
  const product = Number(
    (await db
      .prepare(
        "INSERT INTO products (name, kg_per_base_unit, organization_id, created_at, updated_at) VALUES (?, 1, ?, ?, ?)"
      )
      .run(`کالا ${n}`, org, iso(), iso())).lastInsertRowid
  );
  return { db, org, facility, driver, run, product };
}

describe("facility stops schema", () => {
  it("creates both tables, empty", async () => {
    const db = getDb();
    for (const t of ["run_facility_stops", "run_unload_lines"]) {
      expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    }
  });

  it("carries no organization_id of its own", async () => {
    // Both reach delivery_runs, which is in TENANT_TABLES, so the tenant sweep already
    // stamps them. A redundant scope column is an invitation to filter against the wrong one.
    const db = getDb();
    for (const t of ["run_facility_stops", "run_unload_lines"]) {
      const cols = (await db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(
        (c) => c.name
      );
      expect(cols).not.toContain("organization_id");
    }
  });

  it("takes one load and one unload per run", async () => {
    const { db, facility, run } = await seed();
    const add = async (role: string) =>
      await db
        .prepare(
          `INSERT INTO run_facility_stops (run_id, facility_id, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(run, facility, role, iso(), iso());

    await add("load");
    await add("unload");
    // A second load is a data-entry mistake, not a second morning stop.
    await expect((async () => await add("load"))()).rejects.toThrow();
    await expect((async () => await add("unload"))()).rejects.toThrow();
  });

  it("refuses a role that is neither load nor unload", async () => {
    const { db, facility, run } = await seed();
    // 'load' and 'unload' are the only two jobs. A third role would need a THIRD meaning
    // behind it, and a stopover is not one of them.
    await expect((async () =>
      await db
        .prepare(
          `INSERT INTO run_facility_stops (run_id, facility_id, role, created_at, updated_at)
           VALUES (?, ?, 'stopover', ?, ?)`
        )
        .run(run, facility, iso(), iso()))()).rejects.toThrow();
  });

  it("takes all six dispositions and refuses a seventh", async () => {
    const { db, run, product } = await seed();
    const SIX = ["returned", "damaged", "expired", "discarded", "lost", "sample"];
    for (const disposition of SIX) {
      await (async () =>
        await db
          .prepare(
            `INSERT INTO run_unload_lines (run_id, product_id, disposition, qty_base, occurred_at, created_at)
             VALUES (?, ?, ?, 1, ?, ?)`
          )
          .run(run, product, disposition, iso(), iso()))();
    }
    // damaged and expired are separate values writing the same WRITE_OFF: "we broke it" and
    // "the supplier sent it expired" are different problems a manager needs to tell apart.
    expect(
      await db.prepare("SELECT COUNT(DISTINCT disposition) n FROM run_unload_lines").get()
    ).toEqual({ n: 6 });
    await expect((async () =>
      await db
        .prepare(
          `INSERT INTO run_unload_lines (run_id, product_id, disposition, qty_base, occurred_at, created_at)
           VALUES (?, ?, 'recycled', 1, ?, ?)`
        )
        .run(run, product, iso(), iso()))()).rejects.toThrow();
  });

  it("allows several lines for one unload -- that is the normal case", async () => {
    const { db, run, product } = await seed();
    // «خراب ۵ کیلو» beside «تاریخ مصرف گذشته ۲ کارتن».
    await db.prepare(
      `INSERT INTO run_unload_lines (run_id, product_id, disposition, qty_base, occurred_at, created_at)
       VALUES (?, ?, 'damaged', 5, ?, ?)`
    ).run(run, product, iso(), iso());
    await db.prepare(
      `INSERT INTO run_unload_lines (run_id, product_id, disposition, qty_base, occurred_at, created_at)
       VALUES (?, ?, 'expired', 2, ?, ?)`
    ).run(run, product, iso(), iso());
    expect(
      await db.prepare("SELECT COUNT(*) n FROM run_unload_lines WHERE run_id = ?").get(run)
    ).toEqual({ n: 2 });
  });

  /* THE REGRESSION THIS WHOLE DESIGN EXISTS TO AVOID.
   *
   * The tempting shortcut is to make delivery_stops.order_id nullable and squeeze a facility
   * in as another kind of stop. That silently DISABLES UNIQUE (run_id, order_id), because
   * SQLite treats NULLs as distinct from each other: two rows with a NULL order_id both pass.
   * No error, no warning, just the same order able to appear on a run twice.
   *
   * So this asserts delivery_stops' own guard still refuses a duplicate. If somebody later
   * "simplifies" by merging the tables, this fails -- which is the point. */
  it("delivery_stops still refuses the same order twice on one run", async () => {
    const { db, org, driver, run } = await seed();
    const customer = Number(
      (await db
        .prepare(
          `INSERT INTO customers (organization_id, customer_code, business_name, synced_at)
           VALUES (?, ?, 'مشتری', ?)`
        )
        .run(org, `fs-c-${seq}`, iso())).lastInsertRowid
    );
    const order = Number(
      (await db
        .prepare(
          `INSERT INTO orders (organization_id, customer_id, status, order_no, order_date, created_by, created_at, updated_at)
           VALUES (?, ?, 'CONFIRMED', ?, '2026-10-14', ?, ?, ?)`
        )
        .run(org, customer, `FS-${seq}`, driver, iso(), iso())).lastInsertRowid
    );
    const add = async () =>
      await db
        .prepare(
          `INSERT INTO delivery_stops (run_id, order_id, sort_order, status, collected_toman, created_at)
           VALUES (?, ?, 1, 'pending', 0, ?)`
        )
        .run(run, order, iso());

    await add();
    await expect((async () => await add())()).rejects.toThrow();
    expect(
      await db.prepare("SELECT COUNT(*) n FROM delivery_stops WHERE run_id = ?").get(run)
    ).toEqual({ n: 1 });
  });

  it("order_id is still NOT NULL, so the guard above cannot be bypassed", async () => {
    const db = getDb();
    const cols = await db.prepare("PRAGMA table_info(delivery_stops)").all() as {
      name: string;
      notnull: number;
    }[];
    expect(cols.find((c) => c.name === "order_id")?.notnull).toBe(1);
  });
});