import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-weather-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("weather schema", () => {
  it("creates weather_snapshots and capacity_factors", () => {
    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) n FROM weather_snapshots").get()).toEqual({ n: 0 });
    expect((TENANT_TABLES as readonly string[]).includes("capacity_factors")).toBe(true);
  });

  it("seeds the six condition defaults with a NULL organisation", () => {
    const rows = getDb()
      .prepare("SELECT condition_code FROM capacity_factors WHERE organization_id IS NULL")
      .all() as { condition_code: string }[];
    expect(rows.map((r) => r.condition_code).sort()).toEqual(
      ["dust_storm", "extreme_heat", "fog", "heavy_rain", "high_wind", "snow_ice"].sort()
    );
    getDb();
    getDb();
    expect(
      (getDb().prepare("SELECT COUNT(*) n FROM capacity_factors WHERE organization_id IS NULL").get() as { n: number }).n
    ).toBe(6);
  });

  it("weather_snapshots is unique per (lat_r, lng_r, forecast_date) and upserts", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const sql =
      "INSERT INTO weather_snapshots (lat_r,lng_r,forecast_date,temp_max,fetched_at) VALUES (35.7,51.42,'2026-03-01',?,?) " +
      "ON CONFLICT (lat_r,lng_r,forecast_date) DO UPDATE SET temp_max = excluded.temp_max";
    db.prepare(sql).run(12, now);
    db.prepare(sql).run(18, now);
    const row = db
      .prepare("SELECT COUNT(*) n, MAX(temp_max) t FROM weather_snapshots WHERE forecast_date = '2026-03-01'")
      .get() as { n: number; t: number };
    expect(row).toEqual({ n: 1, t: 18 });
  });
});
