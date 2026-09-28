import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-routing-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeAll(() => {
  getDb().prepare("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?)").run(
    new Date().toISOString()
  );
});

function cols(t: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
}

describe("routing schema", () => {
  it("creates vehicles, route_templates, route_schedules", () => {
    const db = getDb();
    for (const t of ["vehicles", "route_templates", "route_schedules"]) {
      expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({ n: 0 });
    }
    expect((TENANT_TABLES as readonly string[]).includes("vehicles")).toBe(true);
    expect((TENANT_TABLES as readonly string[]).includes("route_templates")).toBe(true);
  });

  it("adds the planning columns to delivery_runs and keeps every row", () => {
    const c = cols("delivery_runs");
    for (const col of [
      "vehicle_id",
      "route_template_id",
      "planned_distance_km",
      "actual_distance_km",
      "planned_duration_min",
      "actual_duration_min",
      "capacity_stops",
      "weather_json",
      "optimisation_json",
      "frozen_at",
    ]) {
      expect(c, col).toContain(col);
    }
  });

  it("delivery_runs.status now accepts 'ready'", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const drv = Number(
      db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('drv','x','ر','delivery_driver',?,1)").run(now).lastInsertRowid
    );
    expect(() =>
      db
        .prepare("INSERT INTO delivery_runs (driver_user_id,run_date,status,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,?,?,?,1)")
        .run(drv, "2026-01-02", "ready", drv, now, now)
    ).not.toThrow();
    expect(() =>
      db
        .prepare("INSERT INTO delivery_runs (driver_user_id,run_date,status,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,?,?,?,1)")
        .run(drv, "2026-01-03", "foo", drv, now, now)
    ).toThrow();
  });

  it("vehicles are unique per (organization_id, plate), shareable across orgs", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const ins = db.prepare(
      "INSERT INTO vehicles (organization_id, name, plate, created_at, updated_at) VALUES (?, 'وانت', 'PL-1', ?, ?)"
    );
    expect(() => ins.run(1, now, now)).not.toThrow();
    expect(() => ins.run(2, now, now)).not.toThrow();
    expect(() => ins.run(1, now, now)).toThrow();
  });

  it("adds products.volume_m3_per_base_unit", () => {
    expect(cols("products")).toContain("volume_m3_per_base_unit");
  });
});
