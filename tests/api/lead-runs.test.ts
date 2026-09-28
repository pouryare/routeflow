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
  driverId = Number(user.run("run-driver", "راننده یک", "delivery_driver", groupId, 1, now).lastInsertRowid);
  otherDriverId = Number(user.run("run-driver-2", "راننده دو", "delivery_driver", groupId, 1, now).lastInsertRowid);
  inactiveDriverId = Number(user.run("run-driver-off", "راننده خاموش", "delivery_driver", groupId, 0, now).lastInsertRowid);
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
/* The override cases get their own day. They rewrite a run's stops, and the cases below read
 * the TOMORROW run -- sharing the date would make those assertions depend on this ordering. */
const LATER = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
/* Functions, not tuples. A `const MANAGER = [managerId, ...]` is evaluated when the module
   loads, which is before beforeAll has assigned any id -- so it captures 0, and uid 0 is
   exactly the retired shared-password session, which every route treats as signed out. The
   failure then looks like an auth bug rather than a test bug. */
const OWNER = () => [ownerId, "owner", null] as const;
const MANAGER = () => [managerId, "group_manager", groupId] as const;
const DRIVER = () => [driverId, "delivery_driver", groupId] as const;

describe("a manager plans a route", () => {
  it("creates one with ordered stops, and gets the day back", async () => {
    const res = await createRun(...MANAGER(), { driver_user_id: driverId, run_date: TOMORROW, location_ids: [pinB, pinA] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { run: { stops: Array<{ location_id: number }> }; reused: boolean };
    expect(body.reused).toBe(false);
    // The order the manager chose is the order kept, not sorted by id.
    expect(body.run.stops.map((s) => s.location_id)).toEqual([pinB, pinA]);
  });

  it("refuses a second run for a day the driver already has planned", async () => {
    /* UNIQUE(driver_user_id, run_date) is the rule, but on its own it was not enough: the
       old code answered a collision by handing back the old run, which reported success
       while throwing away the stops the manager had just picked. Refusing says what
       actually happened. */
    const res = await createRun(...MANAGER(), { driver_user_id: driverId, run_date: TOMORROW, location_ids: [pinC] });
    expect(res.status).toBe(409);
    const rows = getDb()
      .prepare("SELECT COUNT(*) AS n FROM lead_runs WHERE driver_user_id = ? AND run_date = ?")
      .get(driverId, TOMORROW) as { n: number };
    expect(rows.n).toBe(1);
  });

  it("leaves a planned day's stops untouched after a refused re-plan", async () => {
    const stops = getDb()
      .prepare("SELECT location_id FROM lead_run_stops s JOIN lead_runs r ON r.id = s.run_id WHERE r.driver_user_id = ? ORDER BY s.sort_order")
      .all(driverId) as Array<{ location_id: number }>;
    expect(stops.map((s) => s.location_id)).toEqual([pinB, pinA]);
  });

  it("replaces a finished day, but only once the manager has confirmed it", async () => {
    const first = await createRun(...MANAGER(), { driver_user_id: driverId, run_date: LATER, location_ids: [pinA] });
    expect(first.status).toBe(201);
    const runId = ((await first.json()) as { run: { id: number } }).run.id;
    await patchRun(...MANAGER(), runId, { status: "done" });

    // Still refused without the override: the UI shows the warning before offering it.
    const refused = await createRun(...MANAGER(), { driver_user_id: driverId, run_date: LATER, location_ids: [pinB] });
    expect(refused.status).toBe(409);

    const res = await createRun(...MANAGER(), {
      driver_user_id: driverId, run_date: LATER, location_ids: [pinC], override: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reused: boolean;
      run: { status: string; stops: Array<{ location_id: number }> };
    };
    expect(body.reused).toBe(true);
    // The override actually writes. This is the step the old reuse path silently skipped,
    // and it is the one that matters: the manager's chosen stops are on the route.
    expect(body.run.stops.map((s) => s.location_id)).toEqual([pinC]);
    expect(body.run.status).toBe("planned");
  });

  it("never overwrites an active day, even with the override set", async () => {
    // That run is 'planned' again after the override above. Re-planning it must still fail:
    // a driver cannot be in two places at once, and that is not the manager's to decide.
    const res = await createRun(...MANAGER(), {
      driver_user_id: driverId, run_date: LATER, location_ids: [pinA], override: true,
    });
    expect(res.status).toBe(409);
    // Remove it for the tests that follow. Two of them count every run in the fixture, and
    // a third resolves the driver's "current" run by recency, so a leftover here would
    // silently become their answer. Stops go with it (ON DELETE CASCADE).
    getDb().prepare("DELETE FROM lead_runs WHERE driver_user_id = ? AND run_date = ?").run(driverId, LATER);
  });

  it("refuses a driver who is not a driver, or is deactivated", async () => {
    const notADriver = await createRun(...MANAGER(), { driver_user_id: managerId, run_date: TOMORROW, location_ids: [pinA] });
    expect(notADriver.status).toBe(422);
    const off = await createRun(...MANAGER(), { driver_user_id: inactiveDriverId, run_date: TOMORROW, location_ids: [pinA] });
    expect(off.status).toBe(422);
  });

  it("refuses a pin that does not exist, rather than sending a driver to nowhere", async () => {
    // `pinC` rather than `pinA`: the assignment guard refuses a lead that is on another
    // driver's live route with a 409, and an earlier test here hands `pinA` to one. The
    // point of this test is the nonexistent pin, so it uses a lead nothing is holding, and
    // the 404 still comes from `setRunStops` rather than from the guard.
    const res = await createRun(...MANAGER(), { driver_user_id: otherDriverId, run_date: TOMORROW, location_ids: [pinC, 999999] });
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
    const theirs = (await (await listRuns(otherDriverId, "delivery_driver", groupId)).json()) as { run: { driver_user_id: number } | null };
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
    const theirs = (await (await listRuns(otherDriverId, "delivery_driver", groupId)).json()) as { run: { id: number } };
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

/** The leads page has to know who is holding which lead, and a lead must not end up on two
 *  drivers' routes.
 *
 *  Both halves of one arrangement: the phone book is the convenience -- the pool can show
 *  what is available -- and the 409 is the rule standing behind it when the phone book
 *  fails to load.
 *
 *  These build their own pins rather than reusing pinA/B/C, because the describe above
 *  assigns those and the order in which a shared pool of three leads is handed out is not
 *  something these assertions should depend on. */
describe("assignment awareness", () => {
  let taken = 0;
  let free = 0;
  const loc = (name: string, url: string) => {
    const stmt = getDb().prepare(
      "INSERT INTO saved_locations (name, maps_url, lat, lng, resolution, group_id, created_at, organization_id) VALUES (?, ?, 35.80, 51.4, 'manual', ?, ?, 1)"
    );
    return Number(stmt.run(name, url, groupId, new Date().toISOString()).lastInsertRowid);
  };

  // Awaited: the hand-over is what every assertion below is measured against, and an
  // un-awaited create leaves `taken` unassigned when the first test reads the phone book.
  beforeAll(async () => {
    taken = loc("سپرده‌شده", "u/taken");
    free = loc("آزاد", "u/free");
    const res = await createRun(ownerId, "owner", null, {
      driver_user_id: driverId,
      run_date: "2026-07-01",
      location_ids: [taken],
    });
    expect(res.status).toBe(201);
  });

  const assignments = async (uid: number, role: string, gid: number | null) => {
    const res = await GET(new NextRequest("http://localhost/api/lead-runs?assignments=1", { headers: { cookie: as(uid, role, gid) } }));
    return (await res.json()).assignments as Array<{ location_id: number; driver_name: string | null; run_date: string; run_id: number }>;
  };

  it("names the driver holding each lead, and says nothing about a free one", async () => {
    const rows = await assignments(managerId, "group_manager", groupId);
    const mine = rows.find((a) => a.location_id === taken);
    expect(mine?.driver_name).toBe("راننده یک");
    expect(mine?.run_date).toBe("2026-07-01");
    expect(rows.some((a) => a.location_id === free)).toBe(false);
  });

  it("refuses to hand another driver's lead to someone else, and says whose it is", async () => {
    const res = await createRun(managerId, "group_manager", groupId, {
      driver_user_id: otherDriverId,
      run_date: "2026-07-02",
      location_ids: [taken],
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("راننده یک");
  });

  it("writes nothing when it refuses", async () => {
    const before = (await (await listRuns(managerId, "group_manager", groupId)).json()).runs.length;
    await createRun(managerId, "group_manager", groupId, {
      driver_user_id: otherDriverId,
      run_date: "2026-07-03",
      location_ids: [taken],
    });
    expect((await (await listRuns(managerId, "group_manager", groupId)).json()).runs.length).toBe(before);
  });

  it("lets the holder re-plan a lead they already hold", async () => {
    // The clash test is `driver_user_id != ?`, so a driver's own earlier plan is not in the way.
    const res = await createRun(managerId, "group_manager", groupId, {
      driver_user_id: driverId,
      run_date: "2026-07-04",
      location_ids: [taken],
    });
    expect(res.status).toBe(201);
  });

  it("is not a back door around the guard via an override", async () => {
    // Overriding a finished day reopens it. The clash check runs ahead of that branch, so a
    // lead on someone else's live route still cannot be smuggled in with `override: true`.
    const res = await createRun(managerId, "group_manager", groupId, {
      driver_user_id: otherDriverId,
      run_date: "2026-07-05",
      location_ids: [taken],
      override: true,
    });
    expect(res.status).toBe(409);
  });

  it("releases a lead once its route is finished, and the guard lifts with it", async () => {
    // *Every* run holding it, not just one: the test above deliberately put `taken` on a
    // second live route, and a lead is only released when nothing unfinished holds it.
    const holding = (await assignments(managerId, "group_manager", groupId)).filter((a) => a.location_id === taken);
    expect(holding.length).toBeGreaterThan(1);
    for (const a of holding) {
      expect((await patchRun(managerId, "group_manager", groupId, a.run_id, { status: "done" })).status).toBe(200);
    }

    // Gone from the phone book...
    expect((await assignments(managerId, "group_manager", groupId)).some((a) => a.location_id === taken)).toBe(false);
    // ...and no longer refused for someone else.
    const res = await createRun(managerId, "group_manager", groupId, {
      driver_user_id: otherDriverId,
      run_date: "2026-07-06",
      location_ids: [taken],
    });
    expect(res.status).toBe(201);
  });

  it("scopes a manager to their own group and an owner to the org", async () => {
    const managerView = await assignments(managerId, "group_manager", groupId);
    const ownerView = await assignments(ownerId, "owner", null);
    expect(ownerView.length).toBeGreaterThanOrEqual(managerView.length);
  });
});
