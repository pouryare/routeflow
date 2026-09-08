import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-weather-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { snapshotFor, upsertSnapshot, runWeatherAdjustment, capacityFactorsFor } = await import(
  "@/lib/repo/weather"
);

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM weather_snapshots; DELETE FROM capacity_factors WHERE organization_id IS NOT NULL;");
  db.prepare("INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?)").run(
    new Date().toISOString()
  );
});

const CELL = { lat: 35.7, lng: 51.42, date: "2026-03-01" };

function seedRain(precip = 9) {
  upsertSnapshot({
    lat_r: 35.7,
    lng_r: 51.42,
    forecast_date: "2026-03-01",
    temp_min: 5,
    temp_max: 12,
    precip_prob: 90,
    precip_mm: precip,
    snow_mm: 0,
    wind_kmh: 15,
    gust_kmh: 25,
    visibility_m: 8000,
    weather_code: 63,
    raw_json: "{}",
  });
}

describe("weather repo", () => {
  it("upserts a snapshot -- one row, latest values", () => {
    seedRain(9);
    seedRain(15);
    const rows = getDb().prepare("SELECT precip_mm FROM weather_snapshots").all() as { precip_mm: number }[];
    expect(rows).toEqual([{ precip_mm: 15 }]);
    expect(snapshotFor(35.703, 51.418, "2026-03-01")?.precip_mm).toBe(15);
  });

  it("runWeatherAdjustment reads the snapshot and returns the heavy-rain factor", () => {
    seedRain();
    const adj = runWeatherAdjustment(1, CELL);
    expect(adj.conditions).toContain("heavy_rain");
    expect(adj.factors[0].stop).toBe(0.8); // the shipped default
  });

  it("a tenant capacity_factors override wins over the default", () => {
    seedRain();
    getDb()
      .prepare(
        "INSERT INTO capacity_factors (organization_id, condition_code, stop_factor, service_time_factor, speed_factor, max_duration_factor, note_fa, updated_at) VALUES (1,'heavy_rain',0.5,1.2,0.85,1,'شدید',?)"
      )
      .run(new Date().toISOString());
    const mine = capacityFactorsFor(1).find((r) => r.condition_code === "heavy_rain");
    expect(mine?.stop_factor).toBe(0.5);
    // org 2 still sees the default
    expect(capacityFactorsFor(2).find((r) => r.condition_code === "heavy_rain")?.stop_factor).toBe(0.8);
    expect(runWeatherAdjustment(1, CELL).factors[0].stop).toBe(0.5);
  });

  it("returns a neutral adjustment when there is no snapshot", () => {
    const adj = runWeatherAdjustment(1, CELL);
    expect(adj).toMatchObject({ conditions: [], factors: [], cold_chain_capped: false });
  });
});
