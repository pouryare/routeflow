import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-lead-runs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/lead-runs/route");
const { GET: GET_ONE, PATCH } = await import("@/app/api/lead-runs/[id]/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

/** A manager hands a driver a day of pins; the driver sees that day and nothing else.
 *
 *  The two rules worth pinning are the ones that make a driver's screen trustworthy: they
 *  see their own route and no one else's, and a driver cannot write a route onto somebody
 *  else's calendar. */

let ownerId = 0;
let managerId = 0;
let driverId = 0;
let otherDriverId = 0;
let inactiveDriverId = 0;
let groupId = 0;
let pinA = 0;
let pinB = 0;
let pinC = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  groupId = Number(
    db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('گروه', 'lead-runs', ?, 1)")
      .run(now).lastInsertRowid
  );
  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, 'x:y', ?, ?, ?, ?, ?, 1)"
  );
  ownerId = Number(user.run("run-owner", "مالک", "owner", null, 1, now).lastInsertRowid);
  managerId = Number(user.run("run-manager", "مدیر", "group_manager", groupId, 1, now).lastInsertRowid);
  driverId = Number(user.run("run-driver", "راننده یک", "driver", groupId, 1, now).lastInsertRowid);
  otherDriverId = Number(user.run("run-driver-2", "راننده دو", "driver", groupId, 1, now).lastInsertRowid);
  inactiveDriverId = Number(user.run("run-driver-off", "راننده خاموش", "driver", groupId, 0, now).lastInsertRowid);
  const loc = db.prepare(
    "INSERT INTO saved_locations (name, maps_url, lat, lng, resolution, group_id, created_at, organization_id) VALUES (?, ?, ?, 51.4, 'manual', ?, ?, 1)"
  );
  pinA = Number(loc.run("الف", "u/a", 35.70, groupId, now).lastInsertRowid);
  pinB = Number(loc.run("ب", "u/b", 35.71, groupId, now).lastInsertRowid);
  pinC = Number(loc.run("پ", "u/c", 35.72, groupId, now).lastInsertRowid);
});

const as = (uid: number, role: string, gid: number | null) =>
  `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid, oid: 1, tv: 0, name: "t" })}`;

const listRuns = (uid: number, role: string, gid: number | null, query = "") =>
  GET(new NextRequest(`http://localhost/api/lead-runs${query}`, {
    headers: { cookie: as(uid, role, gid) },
  }));
const createRun = (uid: number, role: string, gid: number | null, body: unknown) =>
  POST(new NextRequest("http://localhost/api/lead-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: as(uid, role, gid) },
    body: JSON.stringify(body),
  }));
const routeCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;
const patchRun = (uid: number, role: string, gid: number | null, id: number, body: unknown) =>
  PATCH(new NextRequest(`http://localhost/api/lead-runs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: as(uid, role, gid) },
    body: JSON.stringify(body),
  }), routeCtx(id));
const readRun = (uid: number, role: string, gid: number | null, id: number) =>
  GET_ONE(new NextRequest(`http://localhost/api/lead-runs/${id}`, {
    headers: { cookie: as(uid, role, gid) },
  }), routeCtx(id));

const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
/* Functions, not tuples. A `const MANAGER = [managerId, ...]` is evaluated when the module
   loads, which is before beforeAll has assigned any id -- so it captures 0, and uid 0 is
   exactly the retired shared-password session, which every route treats as signed out. The
   failure then looks like an auth bug rather than a test bug. */
const OWNER = () => [ownerId, "owner", null] as const;
const MANAGER = () => [managerId, "group_manager", groupId] as const;
const DRIVER = () => [driverId, "driver", groupId] as const;

describe("a manager plans a route", () => {
  it("creates one with ordered stops, and gets the day back", async () => {
    const res = await createRun(...MANAGER(), { driver_user_id: driverId, run_date: TOMORROW, location_ids: [pinB, pinA] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { run: { stops: Array<{ location_id: number }> }; reused: boolean };
    expect(body.reused).toBe(false);
    // The order the manager chose is the order kept, not sorted by id.
    expect(body.run.stops.map((s) => s.location_id)).toEqual([pinB, pinA]);
  });

  it("refuses a second run for the same driver and day, rather than making two", async () => {
    // The UNIQUE(driver_user_id, run_date) is the rule. Re-planning a day must reuse the
    // run, because a driver shown two of them is shown an arbitrary one.
    const res = await createRun(...MANAGER(), { driver_user_id: driverId, run_date: TOMORROW, location_ids: [pinC] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reused: boolean };
    expect(body.reused).toBe(true);
    const rows = getDb()
      .prepare("SELECT COUNT(*) AS n FROM lead_runs WHERE driver_user_id = ? AND run_date = ?")
      .get(driverId, TOMORROW) as { n: number };
    expect(rows.n).toBe(1);
  });

  it("reuses rather than emptying: the original stops survive a re-plan", async () => {
    const stops = getDb()
      .prepare("SELECT location_id FROM lead_run_stops s JOIN lead_runs r ON r.id = s.run_id WHERE r.driver_user_id = ? ORDER BY s.sort_order")
      .all(driverId) as Array<{ location_id: number }>;
    expect(stops.map((s) => s.location_id)).toEqual([pinB, pinA]);
  });

  it("refuses a driver who is not a driver, or is deactivated", async () => {
    const notADriver = await createRun(...MANAGER(), { driver_user_id: managerId, run_date: TOMORROW, location_ids: [pinA] });
    expect(notADriver.status).toBe(422);
    const off = await createRun(...MANAGER(), { driver_user_id: inactiveDriverId, run_date: TOMORROW, location_ids: [pinA] });
    expect(off.status).toBe(422);
  });

  it("refuses a pin that does not exist, rather than sending a driver to nowhere", async () => {
    const res = await createRun(...MANAGER(), { driver_user_id: otherDriverId, run_date: TOMORROW, location_ids: [pinA, 999999] });
    expect(res.status).toBe(404);
  });

  it("refuses a Jalali or otherwise malformed date", async () => {
    // A Jalali string here would sort wrongly against a real ISO date and the driver would
    // simply never see the run -- the worst failure a route can have.
    for (const bad of ["1405-07-01", "tomorrow", "", 20260925]) {
      const res = await createRun(...MANAGER(), { driver_user_id: otherDriverId, run_date: bad, location_ids: [pinA] });
      expect(res.status, String(bad)).toBe(400);
    }
  });

  it("will not let a driver plan anything", async () => {
    const res = await createRun(...DRIVER(), { driver_user_id: otherDriverId, run_date: TOMORROW, location_ids: [pinA] });
    expect(res.status).toBe(403);
  });
});

describe("a driver sees their own day", () => {
  it("and nobody else's", async () => {
    const mine = (await (await listRuns(...DRIVER())).json()) as { run: { driver_user_id: number } | null };
    expect(mine.run?.driver_user_id).toBe(driverId);

    await createRun(...MANAGER(), { driver_user_id: otherDriverId, run_date: TOMORROW, location_ids: [pinC] });
    const theirs = (await (await listRuns(otherDriverId, "driver", groupId)).json()) as { run: { driver_user_id: number } | null };
    expect(theirs.run?.driver_user_id).toBe(otherDriverId);
    // Two runs now exist for tomorrow; each driver still resolves to exactly one.
    const all = getDb().prepare("SELECT COUNT(*) AS n FROM lead_runs").get() as { n: number };
    expect(all.n).toBe(2);
  });

  it("derives the words and the follow-up on each stop, from the pin itself", async () => {
    getDb().prepare("UPDATE saved_locations SET visit_outcome = 'READY_TO_BUY' WHERE id = ?").run(pinA);
    const body = (await (await listRuns(...DRIVER())).json()) as {
      run: { stops: Array<{ location_id: number; outcome_label: string; next_action: string | null }> };
    };
    const a = body.run.stops.find((s) => s.location_id === pinA)!;
    expect(a.outcome_label).toBe("آماده خرید");
    expect(a.next_action).toBe("order");
    getDb().prepare("UPDATE saved_locations SET visit_outcome = NULL WHERE id = ?").run(pinA);
  });

  it("and can reorder it, which is the one thing a driver may change", async () => {
    const before = (await (await listRuns(...DRIVER())).json()) as { run: { id: number; stops: Array<{ location_id: number }> } };
    const flipped = [...before.run.stops].map((s) => s.location_id).reverse();
    const res = await patchRun(...DRIVER(), before.run.id, { location_ids: flipped });
    expect(res.status).toBe(200);
    const after = (await res.json()) as { run: { stops: Array<{ location_id: number }> } };
    expect(after.run.stops.map((s) => s.location_id)).toEqual(flipped);
    // Put it back for the tests that follow.
    await patchRun(...DRIVER(), before.run.id, { location_ids: [...flipped].reverse() });
  });

  it("but cannot hand the route on, move it, or close it", async () => {
    const body = (await (await listRuns(...DRIVER())).json()) as { run: { id: number } };
    for (const patch of [{ driver_user_id: otherDriverId }, { run_date: "2026-01-01" }, { status: "done" }]) {
      const res = await patchRun(...DRIVER(), body.run.id, patch);
      expect(res.status, JSON.stringify(patch)).toBe(403);
    }
  });

  it("and cannot read another driver's run", async () => {
    const theirs = (await (await listRuns(otherDriverId, "driver", groupId)).json()) as { run: { id: number } };
    const res = await readRun(...DRIVER(), theirs.run.id);
    // 404, not 403: a 403 would confirm somebody else's route exists.
    expect(res.status).toBe(404);
  });
});

describe("the manager's roster", () => {
  it("lists the runs they can see, and only those", async () => {
    const body = (await (await listRuns(...MANAGER())).json()) as { runs: Array<{ id: number }> };
    expect(body.runs.length).toBe(2);
  });

  it("offers assignable drivers, and no one else", async () => {
    const body = (await (await listRuns(...MANAGER(), "?drivers=1")).json()) as { drivers: Array<{ id: number }> };
    const ids = body.drivers.map((d) => d.id);
    expect(ids).toContain(driverId);
    expect(ids).toContain(otherDriverId);
    // Deactivated and non-drivers are not offered: offering them is how a route vanishes.
    expect(ids).not.toContain(inactiveDriverId);
    expect(ids).not.toContain(managerId);
  });

  it("reports a move onto an occupied day instead of merging two routes", async () => {
    const body = (await (await listRuns(...MANAGER())).json()) as { runs: Array<{ id: number; driver_user_id: number }> };
    const otherRun = body.runs.find((r) => r.driver_user_id === otherDriverId)!;
    const res = await patchRun(...MANAGER(), otherRun.id, { driver_user_id: driverId });
    expect(res.status).toBe(409);
  });
});
