import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-mileage-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { dayKm, ROAD_FACTOR } = await import("@/lib/mileage");
const { myMileage, teamMileage } = await import("@/lib/repo/mileage");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("mileage estimate", () => {
  it("is zero for one visit and grows with the legs between visits", () => {
    expect(dayKm([{ lat: 35.7, lng: 51.4 }])).toBe(0);
    // 0.1 degree of latitude is about 11.1 km straight, times the road factor.
    expect(dayKm([{ lat: 35.7, lng: 51.4 }, { lat: 35.8, lng: 51.4 }])).toBeCloseTo(11.1 * ROAD_FACTOR, 0);
  });
});

const db = getDb();
const now = new Date().toISOString();
const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('mi-u','x:y','علی','field_rep',1,?,1)").run(now)).lastInsertRowid);
const shop = async (code: string, lat: number | null, lng: number | null) =>
  Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id,lat,lng) VALUES (?,?,'RESTAURANT','active','2026-01-01',1,?,?)").run(code, code, lat, lng)).lastInsertRowid);
const visit = (c: number, at: string) => db.prepare("INSERT INTO activities (organization_id, customer_id, user_id, type, occurred_at, created_at) VALUES (1,?,?,'visit',?,?)").run(c, user, at, now);

describe("a person's days", () => {
  it("counts visits in time order and skips shops with no place", async () => {
    const a = await shop("M1", 35.7, 51.4), b = await shop("M2", 35.8, 51.4), c = await shop("M3", null, null);
    await visit(b, "2026-11-10T09:00:00.000Z");
    await visit(a, "2026-11-10T08:00:00.000Z");
    await visit(c, "2026-11-10T10:00:00.000Z");
    const days = await myMileage(1, user, "2026-11-01", "2026-11-30");
    expect(days).toHaveLength(1);
    expect(days[0].visits).toBe(2);
    expect(days[0].km).toBeGreaterThan(10);
    expect((await teamMileage(1, "2026-11-01", "2026-11-30", null))[0]).toMatchObject({ user_id: user, visits: 2 });
  });
});
