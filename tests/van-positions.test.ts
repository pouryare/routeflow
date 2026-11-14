import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-vans-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { tehranTodayIso } = await import("@/lib/jalali");
const { recordPosition, vansFor } = await import("@/lib/repo/vanPositions");
const { parsePosition, ageLabel, isStale } = await import("@/lib/vanPositions");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("F6 position rules", () => {
  it("refuses nonsense and cell-tower guesses, and keeps a good fix", () => {
    expect(parsePosition({ lat: 35.7, lng: 51.4, accuracy: 12.4 })).toEqual({ lat: 35.7, lng: 51.4, accuracyM: 12 });
    expect(parsePosition({ lat: 35.7, lng: 51.4 })).toEqual({ lat: 35.7, lng: 51.4, accuracyM: null });
    for (const bad of [null, {}, { lat: 91, lng: 0 }, { lat: "1", lng: 2 }, { lat: 1, lng: 2, accuracy: 9000 }, { lat: NaN, lng: 1 }]) expect(typeof parsePosition(bad)).toBe("string");
  });
  it("says how old a dot is and when it is stale", () => {
    expect(ageLabel(10_000)).toBe("همین الان");
    expect(ageLabel(3 * 60_000)).toContain("دقیقه");
    expect(ageLabel(3 * 3_600_000)).toContain("ساعت");
    expect(isStale(60_000)).toBe(false);
    expect(isStale(6 * 60_000)).toBe(true);
  });
});

describe("F6 recording", () => {
  it("keeps a position only while the run is in progress, and shows it to the owner", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const mk = async (name: string, role: string) => Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,'x',?,?,1,?,1)").run(name, name, role, now)).lastInsertRowid);
    const driver = await mk("drv", "delivery_driver");
    const owner = await mk("own", "owner");
    const driverSession = { user: { id: driver, display_name: "راننده" }, organizationId: 1, role: "delivery_driver" } as never;
    const ownerSession = { user: { id: owner, display_name: "م" }, organizationId: 1, role: "owner", groupId: null } as never;

    expect(await recordPosition(driverSession, { lat: 35.7, lng: 51.4, accuracyM: 10 })).toBe("no_run");
    const run = Number((await db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, created_at, updated_at, organization_id) VALUES (?, ?, 'in_progress', ?, ?, ?, 1)").run(driver, tehranTodayIso(), owner, now, now)).lastInsertRowid);
    expect(await recordPosition(driverSession, { lat: 35.7, lng: 51.4, accuracyM: 10 })).toBe("saved");
    expect(await recordPosition(driverSession, { lat: 35.8, lng: 51.5, accuracyM: null })).toBe("saved");
    const dots = await vansFor(ownerSession);
    expect(dots).toHaveLength(1);
    expect(dots[0]).toMatchObject({ user_id: driver, lat: 35.8, lng: 51.5 });

    await db.prepare("UPDATE delivery_runs SET status = 'done' WHERE id = ?").run(run);
    expect(await vansFor(ownerSession)).toHaveLength(0);
    expect(await recordPosition(driverSession, { lat: 35.9, lng: 51.5, accuracyM: null })).toBe("no_run");
  });
});
