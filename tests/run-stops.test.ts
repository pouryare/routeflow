import { describe, it, expect, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDbPath = path.join(os.tmpdir(), `rf-runstops-${Date.now()}-${process.pid}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { stopsForRuns, stopCountsByRun, remainingByRun } = await import("@/lib/repo/runStops");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const iso = () => new Date().toISOString();
const ids: { run: number; facility: number; order: number } = { run: 0, facility: 0, order: 0 };

beforeAll(async () => {
  const db = getDb();
  ids.facility = Number(
    (await db
      .prepare(
        `INSERT INTO facilities (slug, kind, name, lat, lng, organization_id, created_at, updated_at)
         VALUES ('rs-depot', 'warehouse', 'انبار', 35.5, 51.7, 1, ?, ?)`
      )
      .run(iso(), iso())).lastInsertRowid
  );
  const driver = Number(
    (await db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
         VALUES ('rs-driver', 'x:y', 'راننده', 'delivery_driver', NULL, 1, ?, 1)`
      )
      .run(iso())).lastInsertRowid
  );
  ids.run = Number(
    (await db
      .prepare(
        `INSERT INTO delivery_runs (driver_user_id, group_id, run_date, created_by, created_at, updated_at, organization_id)
         VALUES (?, NULL, '2026-10-25', ?, ?, ?, 1)`
      )
      .run(driver, driver, iso(), iso())).lastInsertRowid
  );
  const customer = Number(
    (await db
      .prepare(
        `INSERT INTO customers (organization_id, customer_code, business_name, synced_at) VALUES (1, 'RS-1', 'مشتری', ?)`
      )
      .run(iso())).lastInsertRowid
  );
  ids.order = Number(
    (await db
      .prepare(
        `INSERT INTO orders (organization_id, customer_id, status, order_no, order_date, created_by, created_at, updated_at)
         VALUES (1, ?, 'CONFIRMED', 'RS-1', '2026-10-25', ?, ?, ?)`
      )
      .run(customer, driver, iso(), iso())).lastInsertRowid
  );
  // TWO orders, because delivery_stops carries UNIQUE (run_id, order_id). The first attempt
  // reused one order for both doorsteps and this guard -- the very one task 3.2 exists to
  // protect -- refused it. Writing this fixture is the guard working, not failing.
  const addOrder = async (no: string) =>
    Number(
      (await db
        .prepare(
          `INSERT INTO orders (organization_id, customer_id, status, order_no, order_date, created_by, created_at, updated_at)
           VALUES (1, ?, 'CONFIRMED', ?, '2026-10-25', ?, ?, ?)`
        )
        .run(customer, no, driver, iso(), iso())).lastInsertRowid
    );
  const addStop = async (order: number, sort: number, status: string) =>
    await db
      .prepare(
        `INSERT INTO delivery_stops (run_id, order_id, sort_order, status, collected_toman, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`
      )
      .run(ids.run, order, sort, status, iso());
  await addStop(ids.order, 1, "delivered");
  await addStop(await addOrder("RS-2"), 2, "pending");

  const addFacility = async (role: string, status: string) =>
    await db
      .prepare(
        `INSERT INTO run_facility_stops (run_id, facility_id, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(ids.run, ids.facility, role, status, iso(), iso());
  await addFacility("load", "done");
  await addFacility("unload", "pending");
});

describe("stopsForRuns", () => {
  it("counts the load and the unload as stops", async () => {
    // Four things happen on this run: two doorsteps, a load and an unload. Before this
    // existed every reader said two, and the arithmetic that decided how long a day takes
    // was teaching the model that loading a van is free.
    expect((await stopCountsByRun(getDb(), [ids.run])).get(ids.run)).toBe(4);
  });

  it("puts the load first and the unload last, and never numbers the unload", async () => {
    const stops = await stopsForRuns(getDb(), [ids.run]);
    expect(stops[0].role).toBe("load");
    expect(stops[stops.length - 1].role).toBe("unload");
    // The unload has NO position, so it must not appear to sit between two doorsteps.
    const unloadIndex = stops.findIndex((s) => s.role === "unload");
    expect(unloadIndex).toBe(stops.length - 1);
  });

  it("counts what is still outstanding", async () => {
    // One doorstep pending and the unload pending. The unload stays outstanding until the
    // driver confirms it: the question is "did the extras physically come back", and a
    // queued-but-unsent reconciliation has not answered it.
    expect((await remainingByRun(getDb(), [ids.run])).get(ids.run)).toBe(2);
  });

  it("says which table a stop came from", async () => {
    const stops = await stopsForRuns(getDb(), [ids.run]);
    expect(stops.filter((s) => s.entity === "delivery")).toHaveLength(2);
    expect(stops.filter((s) => s.entity === "facility")).toHaveLength(2);
    expect(stops.filter((s) => s.entity === "facility").every((s) => s.facility_id === ids.facility)).toBe(
      true
    );
  });

  it("returns nothing for no runs, rather than touching the database", async () => {
    expect(await stopsForRuns(getDb(), [])).toEqual([]);
  });
});