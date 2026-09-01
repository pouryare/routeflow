import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-admingroups-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { GET: listGroups, POST: createGroup } = await import("@/app/api/admin/groups/route");
const { PATCH: patchGroup, DELETE: deleteGroup } = await import("@/app/api/admin/groups/[id]/route");
const { NextRequest } = await import("next/server");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

// This file owns its fixtures. vitest gives every test file its own module registry, so
// the ids defined in tests/api/scoping.test.ts do not exist here.
let east = 0, west = 0, ownerId = 0, eastMgrId = 0;

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
});

type ReqInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function as(userId: number, role: "owner" | "group_manager" | "driver", gid: number | null, url: string, init: ReqInit = {}) {
  const token = createSessionToken({ uid: userId, role, gid, tv: 0, name: "t" });
  return new NextRequest(url, { ...init, headers: { ...(init.headers ?? {}), cookie: `${COOKIE_NAME}=${token}` } });
}

function body(method: string, payload: unknown): ReqInit {
  return { method, body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } };
}

const idCtx = (n: number) => ({ params: Promise.resolve({ id: String(n) }) }) as never;

describe("GET /api/admin/groups", () => {
  it("lists groups with their district counts", async () => {
    const res = await listGroups(as(ownerId, "owner", null, "http://localhost/api/admin/groups"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.groups.map((g: { slug: string }) => g.slug)).toEqual(expect.arrayContaining(["east", "west"]));
    expect(data.groups.every((g: { district_count: unknown }) => typeof g.district_count === "number")).toBe(true);
  });

  it("refuses a group manager with 403", async () => {
    const res = await listGroups(as(eastMgrId, "group_manager", east, "http://localhost/api/admin/groups"));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/groups", () => {
  it("creates a group and returns its id", async () => {
    const req = as(ownerId, "owner", null, "http://localhost/api/admin/groups",
      body("POST", { name: "گروه شمال", color: "#2DE0E6" }));
    const res = await createGroup(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.id).toBe("number");
  });

  it("gives a Persian name a usable slug rather than an empty one", async () => {
    const req = as(ownerId, "owner", null, "http://localhost/api/admin/groups",
      body("POST", { name: "گروه جنوب" }));
    const { id } = await (await createGroup(req)).json();
    const row = getDb().prepare("SELECT slug FROM groups WHERE id = ?").get(id) as { slug: string };
    expect(row.slug.length).toBeGreaterThan(0);
  });

  it("refuses a duplicate name with 409, not a 500", async () => {
    const make = () => createGroup(as(ownerId, "owner", null, "http://localhost/api/admin/groups",
      body("POST", { name: "گروه تکراری" })));
    expect((await make()).status).toBe(200);
    expect((await make()).status).toBe(409);
  });

  it("rejects an empty name with 400", async () => {
    const res = await createGroup(as(ownerId, "owner", null, "http://localhost/api/admin/groups",
      body("POST", { name: "   " })));
    expect(res.status).toBe(400);
  });

  it("refuses a group manager with 403", async () => {
    const res = await createGroup(as(eastMgrId, "group_manager", east, "http://localhost/api/admin/groups",
      body("POST", { name: "گروه قاچاق" })));
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/groups/[id]", () => {
  it("renames a group", async () => {
    const req = as(ownerId, "owner", null, `http://localhost/api/admin/groups/${east}`,
      body("PATCH", { name: "شرق تهران" }));
    const res = await patchGroup(req, idCtx(east));
    expect(res.status).toBe(200);
    const row = getDb().prepare("SELECT name FROM groups WHERE id = ?").get(east) as { name: string };
    expect(row.name).toBe("شرق تهران");
  });

  it("404s an unknown group", async () => {
    const req = as(ownerId, "owner", null, "http://localhost/api/admin/groups/999999", body("PATCH", { name: "x" }));
    expect((await patchGroup(req, idCtx(999999))).status).toBe(404);
  });

  it("refuses a group manager with 403", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/admin/groups/${west}`,
      body("PATCH", { name: "تصاحب" }));
    expect((await patchGroup(req, idCtx(west))).status).toBe(403);
  });
});

describe("DELETE /api/admin/groups/[id]", () => {
  it("refuses to delete a group that still has users", async () => {
    // eastMgrId belongs to `east`, so deleting it would strand that account with a
    // dangling group_id and no way to reach anything.
    const req = as(ownerId, "owner", null, `http://localhost/api/admin/groups/${east}`, { method: "DELETE" });
    const res = await deleteGroup(req, idCtx(east));
    expect(res.status).toBe(409);
  });

  it("clears group_id on its districts when deleted", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const gid = Number(
      db.prepare("INSERT INTO groups (name, slug, active, created_at) VALUES (?, ?, 1, ?)")
        .run("گروه موقت", "temp", now).lastInsertRowid
    );
    const did = Number(
      db.prepare("INSERT INTO districts (name, level, boundary_geojson, coverage_status, group_id, updated_at) VALUES (?, 'mahalle', '{}', 'unknown', ?, ?)")
        .run("محله موقت", gid, now).lastInsertRowid
    );
    const req = as(ownerId, "owner", null, `http://localhost/api/admin/groups/${gid}`, { method: "DELETE" });
    expect((await deleteGroup(req, idCtx(gid))).status).toBe(200);
    const row = db.prepare("SELECT group_id FROM districts WHERE id = ?").get(did) as { group_id: number | null };
    expect(row.group_id).toBeNull();
  });

  it("refuses a group manager with 403", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/admin/groups/${west}`, { method: "DELETE" });
    expect((await deleteGroup(req, idCtx(west))).status).toBe(403);
  });
});
