import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-away-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { markAway, clearAway, absencesBetween, activeDrivers } = await import("@/lib/repo/absences");
const { capacityAhead } = await import("@/lib/repo/capacityAhead");
const { createVehicle } = await import("@/lib/repo/routing");
const { tehranTodayIso } = await import("@/lib/jalali");
const { addDaysIso } = await import("@/lib/flows/dates");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

let drv = 0, mgr = 0;
const today = tehranTodayIso();
beforeAll(async () => {
  const db = getDb();
  drv = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('a-drv','x:y','راننده','delivery_driver',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
  mgr = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('a-mgr','x:y','مدیر','group_manager',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
});

describe("driver away days", () => {
  it("lists the drivers and marks one away, replacing an earlier mark", async () => {
    expect((await activeDrivers(1)).map((d) => d.id)).toEqual([drv]);
    const day = addDaysIso(today, 1);
    expect(await markAway(1, drv, day, "leave", null, mgr)).toBeNull();
    expect(await markAway(1, drv, day, "sick", "x", mgr)).toBeNull();
    const rows = await absencesBetween(1, today, addDaysIso(today, 3));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: drv, day, kind: "sick" });
  });
  it("refuses a past day and someone who is not a driver", async () => {
    expect(await markAway(1, drv, addDaysIso(today, -1), "off", null, mgr)).toMatch(/امروز/);
    expect(await markAway(1, mgr, today, "off", null, mgr)).toMatch(/راننده/);
  });
  it("takes the mark off", async () => {
    await clearAway(1, drv, addDaysIso(today, 1));
    expect(await absencesBetween(1, today, addDaysIso(today, 3))).toHaveLength(0);
  });
});

describe("capacity ahead", () => {
  it("counts a van without its driver as not running", async () => {
    await createVehicle(1, { name: "وانت", driver_default_id: drv, max_stops: 1 } as never);
    const day = addDaysIso(today, 2);
    await markAway(1, drv, day, "off", null, mgr);
    const loads = await capacityAhead(1, 3, today);
    expect(loads.map((l) => l.day)).toEqual([today, addDaysIso(today, 1), day]);
    expect(loads[1]).toMatchObject({ vans: 1, awayVans: 0, status: "ok" });
    expect(loads[2]).toMatchObject({ vans: 0, awayVans: 1 });
  });
});
