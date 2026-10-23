import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-caplearn-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { learnCapacityFromRuns, resolvedCapacityFactorsFor, MIN_LEARN_N } = await import(
  "@/lib/repo/capacityLearning"
);

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let driver = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM capacity_factors WHERE organization_id IS NOT NULL; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  driver = Number(
    (await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('d','x','ر','delivery_driver',?,1)").run(now)).lastInsertRowid
  );
});

async function rainRun(dateOffset: number, plannedMin: number, actualMin: number) {
  const db = getDb();
  const now = new Date().toISOString();
  const runDate = new Date(Date.now() - dateOffset * 86_400_000).toISOString().slice(0, 10);
  await db.prepare(
    `INSERT INTO delivery_runs
       (driver_user_id, run_date, status, weather_json, planned_duration_min, actual_duration_min,
        capacity_stops, created_by, created_at, updated_at, organization_id)
     VALUES (?, ?, 'done', ?, ?, ?, NULL, ?, ?, ?, 1)`
  ).run(
    driver,
    runDate,
    JSON.stringify({ conditions: ["heavy_rain"] }),
    plannedMin,
    actualMin,
    driver,
    now,
    now
  );
}

const speedOf = (rows: { condition_code: string; speed_factor: number }[]) =>
  rows.find((r) => r.condition_code === "heavy_rain")!.speed_factor;

describe("capacity learning repo", () => {
  it("six rain runs that all ran long → a learned speed factor below the shipped 0.85", async () => {
    for (let i = 0; i < 6; i++) await rainRun(i + 2, 100, 130); // 1.3x planned
    const applied = await learnCapacityFromRuns(1);
    expect(applied).toBe(6);

    const tenant = await getDb()
      .prepare("SELECT learned_speed_factor, learned_n FROM capacity_factors WHERE organization_id = 1 AND condition_code = 'heavy_rain'")
      .get() as { learned_speed_factor: number; learned_n: number };
    expect(tenant.learned_n).toBe(6);
    expect(tenant.learned_speed_factor).toBeLessThan(0.85);
    expect(tenant.learned_speed_factor).toBeGreaterThan(0.3);

    // resolved: n >= MIN_LEARN_N → the learned value wins
    expect(MIN_LEARN_N).toBe(5);
    expect(speedOf(await resolvedCapacityFactorsFor(1))).toBeCloseTo(tenant.learned_speed_factor, 6);
  });

  it("below MIN_LEARN_N runs, the resolved factor is still the configured one", async () => {
    for (let i = 0; i < 3; i++) await rainRun(i + 2, 100, 130);
    await learnCapacityFromRuns(1);
    const tenant = await getDb()
      .prepare("SELECT learned_n FROM capacity_factors WHERE organization_id = 1 AND condition_code = 'heavy_rain'")
      .get() as { learned_n: number };
    expect(tenant.learned_n).toBe(3);
    expect(speedOf(await resolvedCapacityFactorsFor(1))).toBeCloseTo(0.85, 6); // the shipped heavy_rain default
  });

  it("with no learning at all, resolved === the shipped defaults", async () => {
    const rows = await resolvedCapacityFactorsFor(1);
    expect(speedOf(rows)).toBeCloseTo(0.85, 6);
    expect(rows.find((r) => r.condition_code === "snow_ice")!.speed_factor).toBeCloseTo(0.6, 6);
  });
});
