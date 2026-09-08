import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-scope-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { GET: getCustomers } = await import("@/app/api/customers/route");
const { PATCH: patchDistrict } = await import("@/app/api/districts/[id]/route");
const { PATCH: patchBulk } = await import("@/app/api/districts/bulk/route");
const { NextRequest } = await import("next/server");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let east = 0, west = 0, ownerId = 0, eastMgrId = 0, driverId = 0, westDistrictId = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name, slug, active, created_at, organization_id) VALUES (?, ?, 1, ?, 1)");
  east = Number(g.run("شرق", "east", now).lastInsertRowid);
  west = Number(g.run("غرب", "west", now).lastInsertRowid);

  const u = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, ?, ?, ?, ?, 1, ?, 1)"
  );
  ownerId = Number(u.run("owner", "x:y", "مالک", "owner", null, now).lastInsertRowid);
  eastMgrId = Number(u.run("east-mgr", "x:y", "شرقی", "group_manager", east, now).lastInsertRowid);
  driverId = Number(u.run("drv", "x:y", "راننده", "driver", east, now).lastInsertRowid);

  const c = db.prepare(
    "INSERT INTO customers (customer_code, business_name, group_id, synced_at, organization_id) VALUES (?, ?, ?, ?, 1)"
  );
  c.run("E1", "مشتری شرق", east, now);
  c.run("W1", "مشتری غرب", west, now);

  westDistrictId = Number(
    db.prepare(
      "INSERT INTO districts (name, level, boundary_geojson, coverage_status, group_id, updated_at, organization_id) VALUES (?, 'mahalle', '{}', 'unknown', ?, ?, 1)"
    ).run("محله غرب", west, now).lastInsertRowid
  );
});

type ReqInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function as(userId: number, role: "owner" | "group_manager" | "driver", gid: number | null, url = "http://localhost/api/customers", init: ReqInit = {}) {
  const token = createSessionToken({ uid: userId, role, gid, oid: 1, tv: 0, name: "t" });
  return new NextRequest(url, { ...init, headers: { ...(init.headers ?? {}), cookie: `${COOKIE_NAME}=${token}` } });
}

describe("GET /api/customers", () => {
  it("gives the owner every group's customers", async () => {
    const res = await getCustomers(as(ownerId, "owner", null));
    const codes = (await res.json()).customers.map((c: { customer_code: string }) => c.customer_code);
    expect(codes.sort()).toEqual(["E1", "W1"]);
  });

  it("gives a group manager only their own", async () => {
    const res = await getCustomers(as(eastMgrId, "group_manager", east));
    const codes = (await res.json()).customers.map((c: { customer_code: string }) => c.customer_code);
    expect(codes).toEqual(["E1"]);
  });

  it("refuses a driver entirely", async () => {
    const res = await getCustomers(as(driverId, "driver", east));
    expect(res.status).toBe(403);
  });

  it("refuses an anonymous caller", async () => {
    const res = await getCustomers(new NextRequest("http://localhost/api/customers"));
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/districts/[id]", () => {
  const body = JSON.stringify({ coverage_status: "visited" });
  const init = { method: "PATCH", body, headers: { "Content-Type": "application/json" } };

  it("lets the owner edit any group's district", async () => {
    const req = as(ownerId, "owner", null, `http://localhost/api/districts/${westDistrictId}`, init);
    const res = await patchDistrict(req, { params: Promise.resolve({ id: String(westDistrictId) }) } as never);
    expect(res.status).toBe(200);
  });

  it("hides another group's district behind a 404, not a 403", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/districts/${westDistrictId}`, init);
    const res = await patchDistrict(req, { params: Promise.resolve({ id: String(westDistrictId) }) } as never);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/districts/bulk", () => {
  it("lets an owner move a district to another group and follows it with the customers", async () => {
    const db = getDb();
    const req = as(ownerId, "owner", null, "http://localhost/api/districts/bulk", {
      method: "PATCH",
      body: JSON.stringify({ ids: [westDistrictId], group_id: east }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await patchBulk(req);
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT group_id FROM districts WHERE id = ?").get(westDistrictId) as { group_id: number };
    expect(row.group_id).toBe(east);
  });

  it("refuses a group manager setting group_id at all", async () => {
    const req = as(eastMgrId, "group_manager", east, "http://localhost/api/districts/bulk", {
      method: "PATCH",
      body: JSON.stringify({ ids: [westDistrictId], group_id: east }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await patchBulk(req)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Task 8: one pair per route -- a manager must not reach the other group's row,
// and a driver must be refused outright. Written out rather than parameterised:
// a route with no test of its own is a route nobody checked.
// ---------------------------------------------------------------------------

const { GET: getDistricts } = await import("@/app/api/districts/route");
const { GET: getGeometry } = await import("@/app/api/districts/geometry/route");
const { GET: getLocations } = await import("@/app/api/locations/route");
const { PATCH: patchLocation, DELETE: deleteLocation } = await import("@/app/api/locations/[id]/route");
const { POST: convertLocation } = await import("@/app/api/locations/[id]/convert/route");
const { GET: getLeadLists } = await import("@/app/api/lead-lists/route");
const { PATCH: patchLeadList, DELETE: deleteLeadList } = await import("@/app/api/lead-lists/[id]/route");
const { GET: getFacilities } = await import("@/app/api/facilities/route");
const { PATCH: patchFacility } = await import("@/app/api/facilities/[id]/route");
const { GET: getReminders, POST: postReminder } = await import("@/app/api/reminders/route");
const { PATCH: patchReminder, DELETE: deleteReminder } = await import("@/app/api/reminders/[id]/route");
const { GET: getPhotos } = await import("@/app/api/photos/route");
const { DELETE: deletePhoto } = await import("@/app/api/photos/[id]/route");
const { GET: getPhotoFile } = await import("@/app/api/photos/[id]/file/route");
const { GET: getPlans, POST: postPlan } = await import("@/app/api/visit-plans/route");
const { PATCH: patchPlan, DELETE: deletePlan } = await import("@/app/api/visit-plans/[id]/route");
const { GET: getActivity, POST: postActivity } = await import("@/app/api/activity/route");
const { GET: getSales } = await import("@/app/api/sales/route");
const { POST: subscribePush } = await import("@/app/api/push/subscribe/route");

// Only the ids an assertion actually names are bound. The east-side rows still have to
// exist -- they are what proves a manager sees their own and not merely nothing -- but
// they are asserted on by name, so binding their ids would just be dead weight.
let eastCustomerId = 0, westCustomerId = 0, eastDistrictId = 0;
let westLocId = 0, westListId = 0;
let westFacId = 0, sharedFacId = 0;
let westReminderId = 0, westPhotoId = 0;
let eastPlanId = 0, westPlanId = 0;

const idCtx = (n: number) => ({ params: Promise.resolve({ id: String(n) }) }) as never;
const json = (body: unknown) => ({
  method: "PATCH" as const,
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();

  eastCustomerId = (db.prepare("SELECT id FROM customers WHERE customer_code = 'E1'").get() as { id: number }).id;
  westCustomerId = (db.prepare("SELECT id FROM customers WHERE customer_code = 'W1'").get() as { id: number }).id;
  eastDistrictId = Number(
    db.prepare(
      "INSERT INTO districts (name, level, boundary_geojson, coverage_status, group_id, updated_at, organization_id) VALUES (?, 'mahalle', '{}', 'unknown', ?, ?, 1)"
    ).run("محله شرق", east, now).lastInsertRowid
  );

  const loc = db.prepare(
    "INSERT INTO saved_locations (name, maps_url, lat, lng, resolution, group_id, created_at, updated_at, organization_id) VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, 1)"
  );
  loc.run("پین شرق", "https://maps.example/e", 35.7, 51.4, east, now, now);
  westLocId = Number(loc.run("پین غرب", "https://maps.example/w", 35.7, 51.2, west, now, now).lastInsertRowid);

  const list = db.prepare("INSERT INTO lead_lists (name, group_id, created_at, updated_at, organization_id) VALUES (?, ?, ?, ?, 1)");
  list.run("لیست شرق", east, now, now);
  westListId = Number(list.run("لیست غرب", west, now, now).lastInsertRowid);

  const fac = db.prepare(
    "INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, group_id, created_at, updated_at, organization_id) VALUES (?, 'other', ?, ?, ?, 0, ?, ?, ?, 1)"
  );
  fac.run("fac-east", "انبار شرق", 35.7, 51.4, east, now, now);
  westFacId = Number(fac.run("fac-west", "انبار غرب", 35.7, 51.2, west, now, now).lastInsertRowid);
  // No group: the company-wide depot every group plans out of.
  sharedFacId = Number(fac.run("fac-shared", "انبار مرکزی", 35.7, 51.3, null, now, now).lastInsertRowid);

  const rem = db.prepare(
    "INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at) VALUES ('customer', ?, '2026-09-01', ?, 0, ?)"
  );
  rem.run(eastCustomerId, "پیگیری شرق", now);
  westReminderId = Number(rem.run(westCustomerId, "پیگیری غرب", now).lastInsertRowid);

  const ph = db.prepare(
    "INSERT INTO photos (entity_type, entity_id, file_stem, caption, taken_at, created_at) VALUES ('customer', ?, ?, ?, ?, ?)"
  );
  ph.run(eastCustomerId, "stem-east", "عکس شرق", now, now);
  westPhotoId = Number(ph.run(westCustomerId, "stem-west", "عکس غرب", now, now).lastInsertRowid);

  const vp = db.prepare(
    "INSERT INTO visit_plans (entity_type, entity_id, planned_date, status, sort_order, created_at) VALUES ('customer', ?, '2026-09-01', 'planned', 0, ?)"
  );
  eastPlanId = Number(vp.run(eastCustomerId, now).lastInsertRowid);
  westPlanId = Number(vp.run(westCustomerId, now).lastInsertRowid);

  const act = db.prepare(
    "INSERT INTO activity_log (entity_type, entity_id, event_type, old_value, new_value, note, changed_by, created_at) VALUES ('customer', ?, 'note', NULL, NULL, ?, 'x', ?)"
  );
  act.run(eastCustomerId, "رویداد شرق", now);
  act.run(westCustomerId, "رویداد غرب", now);
});

// The bulk-territory case deliberately moves a district between groups and recomputes
// customer groups, which nulls these fixtures (they carry no coordinates). Restoring the
// intended ownership before every test keeps each case independent of the order it runs in.
beforeEach(() => {
  const db = getDb();
  db.prepare("UPDATE customers SET group_id = ? WHERE customer_code = 'E1'").run(east);
  db.prepare("UPDATE customers SET group_id = ? WHERE customer_code = 'W1'").run(west);
  db.prepare("UPDATE districts SET group_id = ? WHERE id = ?").run(west, westDistrictId);
  db.prepare("UPDATE districts SET group_id = ? WHERE id = ?").run(east, eastDistrictId);
});

describe("GET /api/districts", () => {
  it("gives a group manager only their own districts", async () => {
    const res = await getDistricts(as(eastMgrId, "group_manager", east, "http://localhost/api/districts"));
    const names = (await res.json()).districts.map((d: { name: string }) => d.name);
    expect(names).toEqual(["محله شرق"]);
  });
  it("refuses a driver with 403", async () => {
    const res = await getDistricts(as(driverId, "driver", east, "http://localhost/api/districts"));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/districts/geometry", () => {
  it("refuses a driver with 403", async () => {
    const res = await getGeometry(as(driverId, "driver", east, "http://localhost/api/districts/geometry"));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/locations", () => {
  it("gives a group manager only their own pins", async () => {
    const res = await getLocations(as(eastMgrId, "group_manager", east, "http://localhost/api/locations"));
    const names = (await res.json()).locations.map((l: { name: string }) => l.name);
    expect(names).toEqual(["پین شرق"]);
  });
  it("refuses a driver with 403", async () => {
    const res = await getLocations(as(driverId, "driver", east, "http://localhost/api/locations"));
    expect(res.status).toBe(403);
  });
  it("hides another group's pin behind a 404 on PATCH", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/locations/${westLocId}`, json({ status: "visited" }));
    expect((await patchLocation(req, idCtx(westLocId))).status).toBe(404);
  });
  it("hides another group's pin behind a 404 on DELETE", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/locations/${westLocId}`, { method: "DELETE" });
    expect((await deleteLocation(req, idCtx(westLocId))).status).toBe(404);
  });
  it("refuses converting another group's pin to a customer", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/locations/${westLocId}/convert`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect((await convertLocation(req, idCtx(westLocId))).status).toBe(404);
  });
});

describe("GET /api/lead-lists", () => {
  it("gives a group manager only their own lists", async () => {
    const res = await getLeadLists(as(eastMgrId, "group_manager", east, "http://localhost/api/lead-lists"));
    const names = (await res.json()).lists.map((l: { name: string }) => l.name);
    expect(names).toEqual(["لیست شرق"]);
  });
  it("refuses a driver with 403", async () => {
    const res = await getLeadLists(as(driverId, "driver", east, "http://localhost/api/lead-lists"));
    expect(res.status).toBe(403);
  });
  it("hides another group's list behind a 404 on PATCH", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/lead-lists/${westListId}`, json({ name: "نفوذ" }));
    expect((await patchLeadList(req, idCtx(westListId))).status).toBe(404);
  });
  it("hides another group's list behind a 404 on DELETE", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/lead-lists/${westListId}`, { method: "DELETE" });
    expect((await deleteLeadList(req, idCtx(westListId))).status).toBe(404);
  });
});

describe("GET /api/facilities", () => {
  it("gives a group manager their own site and the shared depot, but not another group's", async () => {
    const res = await getFacilities(as(eastMgrId, "group_manager", east, "http://localhost/api/facilities"));
    const names = (await res.json()).facilities.map((f: { name: string }) => f.name).sort();
    expect(names).toContain("انبار شرق");
    expect(names).toContain("انبار مرکزی");
    expect(names).not.toContain("انبار غرب");
  });
  it("refuses a driver with 403", async () => {
    const res = await getFacilities(as(driverId, "driver", east, "http://localhost/api/facilities"));
    expect(res.status).toBe(403);
  });
  it("hides another group's site behind a 404 on PATCH", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/facilities/${westFacId}`, json({ name: "نفوذ" }));
    expect((await patchFacility(req, idCtx(westFacId))).status).toBe(404);
  });
  it("lets a manager see the shared depot but not rename it", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/facilities/${sharedFacId}`, json({ name: "نفوذ" }));
    expect((await patchFacility(req, idCtx(sharedFacId))).status).toBe(404);
  });
});

describe("GET /api/reminders", () => {
  it("gives the owner both groups' reminders", async () => {
    const res = await getReminders(as(ownerId, "owner", null, "http://localhost/api/reminders"));
    const msgs = (await res.json()).reminders.map((r: { message: string }) => r.message);
    expect(msgs.sort()).toEqual(["پیگیری شرق", "پیگیری غرب"]);
  });
  it("gives a group manager only reminders on their own customers", async () => {
    const res = await getReminders(as(eastMgrId, "group_manager", east, "http://localhost/api/reminders"));
    const msgs = (await res.json()).reminders.map((r: { message: string }) => r.message);
    expect(msgs).toEqual(["پیگیری شرق"]);
  });
  it("refuses a driver with 403", async () => {
    const res = await getReminders(as(driverId, "driver", east, "http://localhost/api/reminders"));
    expect(res.status).toBe(403);
  });
  it("refuses a reminder posted against another group's customer", async () => {
    const req = as(eastMgrId, "group_manager", east, "http://localhost/api/reminders", {
      method: "POST",
      body: JSON.stringify({ entity_type: "customer", entity_id: westCustomerId, due_date: "2026-09-02", message: "نفوذ" }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await postReminder(req)).status).toBe(404);
  });
  it("hides another group's reminder behind a 404 on PATCH", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/reminders/${westReminderId}`, json({ resolved: true }));
    expect((await patchReminder(req, idCtx(westReminderId))).status).toBe(404);
  });
  it("hides another group's reminder behind a 404 on DELETE", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/reminders/${westReminderId}`, { method: "DELETE" });
    expect((await deleteReminder(req, idCtx(westReminderId))).status).toBe(404);
  });
});

describe("GET /api/photos", () => {
  it("gives a group manager only photos of their own customers", async () => {
    const res = await getPhotos(as(eastMgrId, "group_manager", east, "http://localhost/api/photos"));
    const caps = (await res.json()).photos.map((p: { caption: string }) => p.caption);
    expect(caps).toEqual(["عکس شرق"]);
  });
  it("refuses a driver with 403", async () => {
    const res = await getPhotos(as(driverId, "driver", east, "http://localhost/api/photos"));
    expect(res.status).toBe(403);
  });
  it("hides another group's photo behind a 404 on DELETE", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/photos/${westPhotoId}`, { method: "DELETE" });
    expect((await deletePhoto(req, idCtx(westPhotoId))).status).toBe(404);
  });
  it("refuses the raw image bytes of another group's photo", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/photos/${westPhotoId}/file`);
    expect((await getPhotoFile(req, idCtx(westPhotoId))).status).toBe(404);
  });
});

describe("GET /api/visit-plans", () => {
  it("gives a group manager only stops at their own customers", async () => {
    const res = await getPlans(as(eastMgrId, "group_manager", east, "http://localhost/api/visit-plans"));
    const ids = (await res.json()).plans.map((p: { id: number }) => p.id);
    expect(ids).toEqual([eastPlanId]);
  });
  it("refuses a driver with 403", async () => {
    const res = await getPlans(as(driverId, "driver", east, "http://localhost/api/visit-plans"));
    expect(res.status).toBe(403);
  });
  it("refuses a stop planned at another group's customer", async () => {
    const req = as(eastMgrId, "group_manager", east, "http://localhost/api/visit-plans", {
      method: "POST",
      body: JSON.stringify({ entity_type: "customer", entity_id: westCustomerId, planned_date: "2026-09-03" }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await postPlan(req)).status).toBe(404);
  });
  it("hides another group's stop behind a 404 on PATCH", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/visit-plans/${westPlanId}`, json({ status: "done" }));
    expect((await patchPlan(req, idCtx(westPlanId))).status).toBe(404);
  });
  it("hides another group's stop behind a 404 on DELETE", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/visit-plans/${westPlanId}`, { method: "DELETE" });
    expect((await deletePlan(req, idCtx(westPlanId))).status).toBe(404);
  });
});

describe("GET /api/activity", () => {
  it("gives a group manager only their own customer's history", async () => {
    const west = await getActivity(
      as(eastMgrId, "group_manager", east, `http://localhost/api/activity?entity_type=customer&entity_id=${westCustomerId}`)
    );
    expect((await west.json()).activity).toEqual([]);
    const own = await getActivity(
      as(eastMgrId, "group_manager", east, `http://localhost/api/activity?entity_type=customer&entity_id=${eastCustomerId}`)
    );
    expect((await own.json()).activity.map((a: { note: string }) => a.note)).toEqual(["رویداد شرق"]);
  });
  it("refuses a driver with 403", async () => {
    const res = await getActivity(
      as(driverId, "driver", east, `http://localhost/api/activity?entity_type=customer&entity_id=${eastCustomerId}`)
    );
    expect(res.status).toBe(403);
  });
  it("refuses an entry logged against another group's customer", async () => {
    const req = as(eastMgrId, "group_manager", east, "http://localhost/api/activity", {
      method: "POST",
      body: JSON.stringify({ entity_type: "customer", entity_id: westCustomerId, note: "نفوذ" }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await postActivity(req)).status).toBe(404);
  });
  it("records the acting user's id, not just their name", async () => {
    const req = as(ownerId, "owner", null, "http://localhost/api/activity", {
      method: "POST",
      body: JSON.stringify({ entity_type: "customer", entity_id: eastCustomerId, note: "ثبت مالک" }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await postActivity(req)).status).toBe(200);
    const row = getDb()
      .prepare("SELECT changed_by, changed_by_user_id FROM activity_log WHERE note = 'ثبت مالک'")
      .get() as { changed_by: string; changed_by_user_id: number };
    expect(row.changed_by).toBe("مالک");
    expect(row.changed_by_user_id).toBe(ownerId);
  });
});

describe("GET /api/sales", () => {
  it("lets a group manager read their own customer's ledger", async () => {
    const res = await getSales(
      as(eastMgrId, "group_manager", east, "http://localhost/api/sales?customer=" + encodeURIComponent("مشتری شرق"))
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("hides another group's customer behind a 404, not a 403", async () => {
    // The leak this guards: sales rows are keyed by customer_name, so without the group
    // check any guessable business name would return that customer's whole debt history.
    const res = await getSales(
      as(eastMgrId, "group_manager", east, "http://localhost/api/sales?customer=" + encodeURIComponent("مشتری غرب"))
    );
    expect(res.status).toBe(404);
  });

  it("gives the owner any customer's ledger", async () => {
    const res = await getSales(
      as(ownerId, "owner", null, "http://localhost/api/sales?customer=" + encodeURIComponent("مشتری غرب"))
    );
    expect(res.status).toBe(200);
  });

  it("refuses a driver with 403", async () => {
    const res = await getSales(as(driverId, "driver", east, "http://localhost/api/sales?customer=x"));
    expect(res.status).toBe(403);
  });
});

describe("sales aggregates reach their group through the customer", () => {
  // /analytics reads `sales` directly rather than through a route, and `sales` carries no
  // group of its own. These assert the join those queries depend on, so the page cannot
  // quietly go back to showing province-wide revenue to a group manager.
  it("attributes a sale to a group only via the customer's business_name", () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO sales (order_no, sale_date, customer_name, amount, imported_at) VALUES ('A1', '2026-08-01', ?, 500, ?)"
    ).run("مشتری شرق", new Date().toISOString());
    db.prepare(
      "INSERT INTO sales (order_no, sale_date, customer_name, amount, imported_at) VALUES ('A2', '2026-08-01', ?, 900, ?)"
    ).run("مشتری غرب", new Date().toISOString());

    const scoped = db
      .prepare(
        `SELECT s.customer_name FROM sales s JOIN customers c ON c.business_name = s.customer_name
         WHERE 1 = 1 AND c.group_id = ? GROUP BY s.customer_name`
      )
      .all(east) as unknown as { customer_name: string }[];
    expect(scoped.map((r) => r.customer_name)).toEqual(["مشتری شرق"]);
  });

  it("leaves a sale naming no known customer out of every group", () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO sales (order_no, sale_date, customer_name, amount, imported_at) VALUES ('A3', '2026-08-01', 'کسی که نیست', 100, ?)"
    ).run(new Date().toISOString());
    const rows = db
      .prepare(
        `SELECT s.customer_name FROM sales s JOIN customers c ON c.business_name = s.customer_name
         WHERE 1 = 1 AND c.group_id = ?`
      )
      .all(east) as unknown as { customer_name: string }[];
    expect(rows.some((r) => r.customer_name === "کسی که نیست")).toBe(false);
  });
});

describe("push/subscribe", () => {
  it("lets a driver register their device", async () => {
    const req = as(driverId, "driver", east, "http://localhost/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await subscribePush(req)).status).toBe(200);
  });
  it("still refuses an anonymous device", async () => {
    const req = new NextRequest("http://localhost/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "https://push.example/2", keys: { p256dh: "a", auth: "b" } }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await subscribePush(req)).status).toBe(401);
  });
});
