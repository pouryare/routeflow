import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-adminusers-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

// This file owns its fixtures: vitest gives every test file its own module registry, so
// the ids in tests/api/scoping.test.ts do not exist here.
type ReqInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

// `west` exists so the fixture has more than one group, but no assertion names it.
let east = 0, ownerId = 0, eastMgrId = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name, slug, active, created_at) VALUES (?, ?, 1, ?)");
  east = Number(g.run("شرق", "east", now).lastInsertRowid);
  g.run("غرب", "west", now);

  const u = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
  );
  ownerId = Number(u.run("owner", "x:y", "مالک", "owner", null, now).lastInsertRowid);
  eastMgrId = Number(u.run("east-mgr", "x:y", "شرقی", "group_manager", east, now).lastInsertRowid);
});

function as(userId: number, role: "owner" | "group_manager" | "driver", gid: number | null, url: string, init: ReqInit = {}) {
  const token = createSessionToken({ uid: userId, role, gid, oid: 1, tv: 0, name: "t" });
  return new NextRequest(url, { ...init, headers: { ...(init.headers ?? {}), cookie: `${COOKIE_NAME}=${token}` } });
}

const { POST: createUser } = await import("@/app/api/admin/users/route");
const { PATCH: patchUser } = await import("@/app/api/admin/users/[id]/route");

const URL_NEW = "http://localhost/api/admin/users";
const json = (method: string, payload: unknown): ReqInit =>
  ({ method, body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } });

describe("POST /api/admin/users", () => {
  it("creates an account with a role and a group", async () => {
    const res = await createUser(as(ownerId, "owner", null, URL_NEW,
      json("POST", { username: "newdrv", password: "pw-123456", display_name: "راننده نو", role: "driver", group_id: east, staff_code: "DRV2" })));
    expect(res.status).toBe(200);
    const row = getDb().prepare("SELECT role, group_id, staff_code FROM users WHERE username = 'newdrv'")
      .get() as { role: string; group_id: number; staff_code: string };
    expect(row).toEqual({ role: "driver", group_id: east, staff_code: "DRV2" });
  });

  it("stores a scrypt hash, never the password itself", async () => {
    await createUser(as(ownerId, "owner", null, URL_NEW,
      json("POST", { username: "hashme", password: "pw-abcdef", display_name: "هش", role: "driver", group_id: east })));
    const row = getDb().prepare("SELECT password_hash FROM users WHERE username = 'hashme'").get() as { password_hash: string };
    expect(row.password_hash).not.toContain("pw-abcdef");
    expect(row.password_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);
  });

  it("rejects a role outside the three known values with 400", async () => {
    const res = await createUser(as(ownerId, "owner", null, URL_NEW,
      json("POST", { username: "root", password: "pw-123456", display_name: "ریشه", role: "superuser" })));
    expect(res.status).toBe(400);
  });

  it("requires a group for a group_manager and a driver", async () => {
    // An owner is unscoped by design. A non-owner with no group can reach nothing at all
    // (scopeGroupIds returns []), so creating one is a bug, not a valid state.
    for (const role of ["group_manager", "driver"]) {
      const res = await createUser(as(ownerId, "owner", null, URL_NEW,
        json("POST", { username: `no-group-${role}`, password: "pw-123456", display_name: "بی‌گروه", role })));
      expect(res.status).toBe(400);
    }
    const ownerRes = await createUser(as(ownerId, "owner", null, URL_NEW,
      json("POST", { username: "second-owner", password: "pw-123456", display_name: "مالک دوم", role: "owner" })));
    expect(ownerRes.status).toBe(200);
  });

  it("rejects a duplicate username with 409", async () => {
    const res = await createUser(as(ownerId, "owner", null, URL_NEW,
      json("POST", { username: "newdrv", password: "pw-123456", display_name: "تکراری", role: "driver", group_id: east })));
    expect(res.status).toBe(409);
  });

  it("refuses a non-owner with 403", async () => {
    const res = await createUser(as(eastMgrId, "group_manager", east, URL_NEW,
      json("POST", { username: "sneaky", password: "pw-123456", display_name: "نفوذی", role: "driver", group_id: east })));
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/users/[id]", () => {
  function versionOf(username: string): number {
    return (getDb().prepare("SELECT token_version FROM users WHERE username = ?").get(username) as { token_version: number }).token_version;
  }

  it("resets a password and bumps token_version", async () => {
    const id = (getDb().prepare("SELECT id FROM users WHERE username = 'newdrv'").get() as { id: number }).id;
    const before = versionOf("newdrv");
    const res = await patchUser(
      as(ownerId, "owner", null, `${URL_NEW}/${id}`, json("PATCH", { password: "pw-fresh-1" })),
      { params: Promise.resolve({ id: String(id) }) } as never
    );
    expect(res.status).toBe(200);
    // The bump is the point: without it, a session issued before the reset stays valid
    // for up to 30 days, so resetting a password would not actually lock anyone out.
    expect(versionOf("newdrv")).toBe(before + 1);
  });

  it("bumps token_version when deactivating", async () => {
    const id = (getDb().prepare("SELECT id FROM users WHERE username = 'hashme'").get() as { id: number }).id;
    const before = versionOf("hashme");
    await patchUser(
      as(ownerId, "owner", null, `${URL_NEW}/${id}`, json("PATCH", { active: false })),
      { params: Promise.resolve({ id: String(id) }) } as never
    );
    expect(versionOf("hashme")).toBe(before + 1);
  });

  it("refuses to demote the last remaining owner", async () => {
    const db = getDb();
    db.prepare("UPDATE users SET role = 'driver', group_id = ? WHERE username = 'second-owner'").run(east);
    const owners = db.prepare("SELECT id FROM users WHERE role = 'owner' AND active = 1").all() as unknown as { id: number }[];
    expect(owners).toHaveLength(1);
    const res = await patchUser(
      as(ownerId, "owner", null, `${URL_NEW}/${owners[0].id}`, json("PATCH", { role: "group_manager", group_id: east })),
      { params: Promise.resolve({ id: String(owners[0].id) }) } as never
    );
    // Otherwise the app ends up with nobody who can administer it, and the only way back
    // is scripts/create-user.mjs over SSH.
    expect(res.status).toBe(409);
  });
});
