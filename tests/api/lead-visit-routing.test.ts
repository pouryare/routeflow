import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-visit-routing-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { POST } = await import("@/app/api/leads/locations/[id]/visit/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { nextActionFor } = await import("@/lib/crm/leadDesire");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

/** What a visit leaves behind, and who acts on it.
 *
 *  The bug this file exists for: the flow used to ask the driver "تبدیل به مشتری؟", write
 *  the answer to `convert_location`, and have nothing anywhere read it. A driver was asked
 *  a commercial question whose answer was discarded, and a lead ready to buy left no
 *  order, no task and no customer. These tests pin the replacement: the visit records what
 *  happened, and the follow-up is derived from that. */

let ownerId = 0;
let driverId = 0;
let salespersonId = 0;
let groupId = 0;
let locInGroup = 0;
let locOtherGroup = 0;
let locOnRun = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  // organization_id included because groups gains it in a migration, and scopeGroupIds
  // reads "WHERE organization_id = ?" for an owner -- a group left NULL is invisible to
  // one, which is its own kind of confusing test failure.
  groupId = Number(
    db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES (?, ?, ?, 1)")
      .run("گروه بازدید", "visit-routing", now).lastInsertRowid
  );
  const otherGroupId = Number(
    db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES (?, ?, ?, 1)")
      .run("گروه دیگر", "visit-routing-other", now).lastInsertRowid
  );
  const insertUser = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, 'x:y', ?, ?, ?, 1, ?, 1)"
  );
  ownerId = Number(insertUser.run("visit-owner", "مالک", "owner", null, now).lastInsertRowid);
  driverId = Number(insertUser.run("visit-driver", "راننده", "delivery_driver", groupId, now).lastInsertRowid);
  salespersonId = Number(insertUser.run("visit-sales", "فروشنده", "phone_sales", groupId, now).lastInsertRowid);
  const insertLoc = db.prepare(
    "INSERT INTO saved_locations (name, maps_url, lat, lng, resolution, group_id, created_at, organization_id) VALUES (?, ?, 35.7, 51.4, 'manual', ?, ?, 1)"
  );
  locInGroup = Number(insertLoc.run("هتل آریا", "https://maps.example/x", groupId, now).lastInsertRowid);
  locOtherGroup = Number(insertLoc.run("هتل دیگر", "https://maps.example/y", otherGroupId, now).lastInsertRowid);
  // locInGroup is not on a route on purpose: it is the "not your stop" case. locOnRun is.
  // insertLoc hardcodes the coordinates, so it takes only (name, url, group, created_at).
  locOnRun = Number(insertLoc.run("هتل روی مسیر", "https://maps.example/z", groupId, now).lastInsertRowid);
  const runId = Number(
    db.prepare(`INSERT INTO lead_runs (driver_user_id, group_id, run_date, status, planned_by, organization_id, created_at, updated_at)
                VALUES (?, ?, ?, 'planned', ?, ?, ?, ?)`)
      .run(driverId, groupId, "2026-09-25", ownerId, 1, now, now).lastInsertRowid
  );
  db.prepare("INSERT INTO lead_run_stops (run_id, location_id, sort_order, created_at) VALUES (?, ?, 0, ?)")
    .run(runId, locOnRun, now);
});

function as(uid: number, role: string, gid: number | null) {
  const token = createSessionToken({ uid, role: role as never, gid, oid: 1, tv: 0, name: "t" });
  return `${COOKIE_NAME}=${token}`;
}

function post(locationId: number, answers: unknown[], who: { uid: number; role: string; gid: number | null }) {
  return new NextRequest(`http://localhost/api/leads/locations/${locationId}/visit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: as(who.uid, who.role, who.gid) },
    body: JSON.stringify({ answers }),
  });
}
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;
const DRIVER = () => ({ uid: driverId, role: "delivery_driver", gid: groupId });

/** The path a driver walks when the owner says yes, we are buying. */
const boughtNow = [
  { step: "navigate", option: "go" },
  { step: "what_happened", option: "ok" },
  { step: "detail_status", option: "buy" },
  { step: "sold", option: "now" },
  { step: "rate", option: "stars", value: "5,4,5" },
  { step: "skip", option: "WAITING_ON_THEM" },
];
const boughtLater = boughtNow.map((a) => (a.option === "now" ? { ...a, option: "office" } : a));

function task(id: number) {
  return getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    | { kind: string; title: string; assignee_user_id: number | null; role_hint: string | null; due_at: string; priority: string; entity_id: number }
    | undefined;
}
function location(id: number) {
  return getDb().prepare("SELECT * FROM saved_locations WHERE id = ?").get(id) as
    | { visit_outcome: string | null; status: string | null; rating_potential: number | null }
    | undefined;
}


describe("a driver records a visit that closed a sale", () => {
  it("leaves an order task for the office, not a decision for the driver", async () => {
    const res = await POST(post(locOnRun, boughtNow, DRIVER()), ctx(locOnRun));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { next_task_id: number | null };
    expect(body.next_task_id).not.toBeNull();

    const t = task(body.next_task_id!);
    expect(t?.kind).toBe("order");
    expect(t?.title).toBe("ثبت سفارش");
    // The driver did not take the work; the office has to do the paperwork. This mirrors
    // the handoff-call task, which also leaves the assignee empty for a manager to pick up.
    expect(t?.assignee_user_id).toBeNull();
    expect(t?.role_hint).toBe("group_manager");
    expect(t?.entity_id).toBe(locOnRun);
  });

  it("records the outcome and the stars against the location", () => {
    const loc = location(locOnRun);
    expect(loc?.visit_outcome).toBe("READY_TO_BUY");
    expect(loc?.status).toBe("visited");
    expect(loc?.rating_potential).toBe(5);
  });

  it("does not convert the lead and does not remove the pin -- that is the order's job", () => {
    // The dead end this replaces asked the driver, stored an answer nobody read, and left
    // the lead exactly where it was. Rule 1 is that a lead becomes a customer when it
    // buys, so the visit must not invent a customer...
    const customers = getDb().prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number };
    expect(customers.n).toBe(0);
    // ...and it must not delete the row either. saved_locations is referenced by
    // lead_list_items with ON DELETE CASCADE, so deleting it here would quietly rip the
    // stop out of the route the driver is standing on.
    expect(location(locOnRun)).toBeDefined();
  });

  it("still files the order for a buyer who says not yet, just not urgently", async () => {
    const immediate = await POST(post(locOnRun, boughtNow, DRIVER()), ctx(locOnRun));
    const immediateBody = (await immediate.json()) as { next_task_id: number | null };
    const deferred = await POST(post(locOnRun, boughtLater, DRIVER()), ctx(locOnRun));
    const deferredBody = (await deferred.json()) as { next_task_id: number | null };

    const now = task(immediateBody.next_task_id!)!;
    const later = task(deferredBody.next_task_id!)!;
    expect(later.kind).toBe("order");
    // Tomorrow morning rather than this instant: the difference between the two answers is
    // urgency, not whether anybody is told. Compared against the other answer rather than
    // against the clock, so this cannot rot into a flaky test at some hour of the day.
    expect(Date.parse(later.due_at)).toBeGreaterThan(Date.parse(now.due_at));
  });
});

describe("the follow-ups that already worked still work", () => {
  it("a partial interest still hands off to a phone call", async () => {
    const res = await POST(
      post(locOnRun, [
        { step: "navigate", option: "go" },
        { step: "what_happened", option: "ok" },
        { step: "detail_status", option: "partial" },
        { step: "rate", option: "stars", value: "3,3,3" },
        { step: "skip", option: "WAITING_ON_THEM" },
      ], DRIVER()),
      ctx(locOnRun)
    );
    const body = (await res.json()) as { next_task_id: number | null };
    expect(task(body.next_task_id!)?.kind).toBe("call");
    expect(location(locOnRun)?.visit_outcome).toBe("INTERESTED");
  });

  it("a miss the driver wants to retry still leaves a reminder", async () => {
    const res = await POST(
      post(locOnRun, [
        { step: "navigate", option: "go" },
        { step: "what_happened", option: "no" },
        { step: "why_failed", option: "noowner" },
        { step: "reminder", option: "tomorrow" },
        { step: "rate", option: "stars", value: "2,2,4" },
        { step: "skip", option: "WAITING_ON_THEM" },
      ], DRIVER()),
      ctx(locOnRun)
    );
    const body = (await res.json()) as { next_task_id: number | null };
    expect(task(body.next_task_id!)?.kind).toBe("reminder");
    expect(location(locOnRun)?.visit_outcome).toBe("VISIT_NO_OWNER");
  });

  it("and the derived action agrees with the task that was actually filed", async () => {
    // One source of truth: the read model in lib/crm/leadDesire and the branch in
    // applyLeadVisit have to tell the same story, or the card on the driver's phone will
    // promise a call nobody was asked to make.
    const res = await POST(
      post(locOnRun, [
        { step: "navigate", option: "go" },
        { step: "what_happened", option: "ok" },
        { step: "detail_status", option: "buy" },
        { step: "sold", option: "now" },
        { step: "rate", option: "stars", value: "4,4,4" },
        { step: "skip", option: "WAITING_ON_THEM" },
      ], DRIVER()),
      ctx(locOnRun)
    );
    const body = (await res.json()) as { next_task_id: number | null };
    expect(nextActionFor(location(locOnRun)?.visit_outcome)).toBe(task(body.next_task_id!)?.kind);
  });
});

describe("who may record a visit", () => {
  it("refuses a role that neither sells nor drives", async () => {
    // A real salesperson row, not a salesperson token over somebody else's id: getSession
    // re-reads the user and takes the role from the database, so a forged claim resolves
    // to the real one and this test would silently be testing the owner.
    const res = await POST(
      post(locInGroup, boughtNow, { uid: salespersonId, role: "phone_sales", gid: groupId }),
      ctx(locOnRun)
    );
    expect(res.status).toBe(403);
  });

  it("refuses a driver a location outside their own group", async () => {
    const res = await POST(post(locOtherGroup, boughtNow, DRIVER()), ctx(locOtherGroup));
    expect(res.status).toBe(404);
  });
});
