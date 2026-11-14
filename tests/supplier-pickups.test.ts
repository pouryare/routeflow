import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-pick-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { addPickup, markCollected, pickupChoices } = await import("@/lib/repo/pickups");
const { tehranTodayIso } = await import("@/lib/jalali");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

let driver = 0, other = 0, run = 0, place = 0;
beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const mk = async (u: string) => Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,'x:y','م','delivery_driver',1,?,1)").run(u, now)).lastInsertRowid);
  driver = await mk("p-d1"); other = await mk("p-d2");
  run = Number((await db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, created_at, updated_at, organization_id) VALUES (?, ?, 'planned', ?, ?, ?, 1)").run(driver, tehranTodayIso(), driver, now, now)).lastInsertRowid);
  place = Number((await db.prepare("INSERT INTO facilities (slug, kind, name, created_at, updated_at, organization_id) VALUES ('f1','factory','کارخانه',?,?,1)").run(now, now)).lastInsertRowid);
});

describe("supplier pickups on a run", () => {
  it("offers the coming run and the place, adds a pickup once, and only the run's driver can tick it", async () => {
    const c = await pickupChoices(1);
    expect(c.runs.map((r) => r.id)).toContain(run);
    expect(c.places.map((p) => p.id)).toContain(place);
    expect(await addPickup(1, run, place, null)).toBeNull();
    expect(await addPickup(1, run, place, null)).toMatch(/همین/);
    const stop = Number(((await getDb().prepare("SELECT id FROM run_facility_stops WHERE run_id = ? AND role = 'pickup'").get(run)) as { id: number }).id);
    expect(await markCollected(1, other, stop)).toMatch(/پیدا نشد/);
    expect(await markCollected(1, driver, stop)).toBeNull();
    expect(await markCollected(1, driver, stop)).toMatch(/پیدا نشد/);
  });
});
