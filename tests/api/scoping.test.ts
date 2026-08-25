import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-scope-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.APP_PASSWORD = "test-password";

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
  const g = db.prepare("INSERT INTO groups (name, slug, active, created_at) VALUES (?, ?, 1, ?)");
  east = Number(g.run("شرق", "east", now).lastInsertRowid);
  west = Number(g.run("غرب", "west", now).lastInsertRowid);

  const u = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
  );
  ownerId = Number(u.run("owner", "x:y", "مالک", "owner", null, now).lastInsertRowid);
  eastMgrId = Number(u.run("east-mgr", "x:y", "شرقی", "group_manager", east, now).lastInsertRowid);
  driverId = Number(u.run("drv", "x:y", "راننده", "driver", east, now).lastInsertRowid);

  const c = db.prepare(
    "INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)"
  );
  c.run("E1", "مشتری شرق", east, now);
  c.run("W1", "مشتری غرب", west, now);

  westDistrictId = Number(
    db.prepare(
      "INSERT INTO districts (name, level, boundary_geojson, coverage_status, group_id, updated_at) VALUES (?, 'mahalle', '{}', 'unknown', ?, ?)"
    ).run("محله غرب", west, now).lastInsertRowid
  );
});

type ReqInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function as(userId: number, role: "owner" | "group_manager" | "driver", gid: number | null, url = "http://localhost/api/customers", init: ReqInit = {}) {
  const token = createSessionToken({ uid: userId, role, gid, tv: 0, name: "t" });
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
