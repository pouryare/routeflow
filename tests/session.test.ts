import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-session-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { getSession, requireRole, scopeGroupIds, groupFilter, canReachGroup } = await import("@/lib/session");
const { NextRequest } = await import("next/server");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let ownerId = 0;
let managerId = 0;
let driverId = 0;
let groupEast = 0;
let groupWest = 0;

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  // organization_id stamped on both: scopeGroupIds resolves an owner's groups by
  // querying WHERE organization_id = session.organizationId, so an unstamped group
  // would be invisible to every "owner" session in this file, and an unstamped user's
  // .organization_id would not match the oid: 1 baked into reqFor()'s tokens below.
  const g = db.prepare(
    "INSERT INTO groups (name, slug, color, active, created_at, organization_id) VALUES (?, ?, ?, 1, ?, 1)"
  );
  groupEast = Number((await g.run("گروه شرق", "east", "#0ff", now)).lastInsertRowid);
  groupWest = Number((await g.run("گروه غرب", "west", "#f0f", now)).lastInsertRowid);

  const u = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, ?, ?, ?, ?, 1, ?, 1)"
  );
  ownerId = Number((await u.run("pourya", "x:y", "پوریا", "owner", null, now)).lastInsertRowid);
  managerId = Number((await u.run("sara", "x:y", "سارا", "group_manager", groupEast, now)).lastInsertRowid);
  driverId = Number((await u.run("yousef", "x:y", "یوسف", "delivery_driver", groupEast, now)).lastInsertRowid);
});

function reqFor(userId: number, role: "owner" | "group_manager" | "delivery_driver", gid: number | null, tv = 0) {
  const token = createSessionToken({ uid: userId, role, gid, oid: 1, tv, name: "t" });
  return new NextRequest("http://localhost/api/anything", { headers: { cookie: `${COOKIE_NAME}=${token}` } });
}

describe("getSession", () => {
  it("loads the user behind a valid token", async () => {
    const s = await getSession(reqFor(managerId, "group_manager", groupEast));
    expect(s?.user.username).toBe("sara");
    expect(s?.role).toBe("group_manager");
    expect(s?.groupId).toBe(groupEast);
  });

  it("returns null when there is no cookie", async () => {
    expect(await getSession(new NextRequest("http://localhost/api/anything"))).toBeNull();
  });

  it("trusts the database over the token for role and group", async () => {
    // A token minted while Sara was an owner must not keep owner powers after demotion.
    const s = await getSession(reqFor(managerId, "owner", null));
    expect(s?.role).toBe("group_manager");
    expect(s?.groupId).toBe(groupEast);
  });

  it("rejects a deactivated user", async () => {
    const db = getDb();
    await db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(driverId);
    expect(await getSession(reqFor(driverId, "delivery_driver", groupEast))).toBeNull();
    await db.prepare("UPDATE users SET active = 1 WHERE id = ?").run(driverId);
  });

  it("rejects a token whose version is behind the user's", async () => {
    const db = getDb();
    await db.prepare("UPDATE users SET token_version = 5 WHERE id = ?").run(driverId);
    expect(await getSession(reqFor(driverId, "delivery_driver", groupEast, 0))).toBeNull();
    expect(await getSession(reqFor(driverId, "delivery_driver", groupEast, 5))).not.toBeNull();
    await db.prepare("UPDATE users SET token_version = 0 WHERE id = ?").run(driverId);
  });

  it("rejects a token for a user that no longer exists", async () => {
    expect(await getSession(reqFor(999999, "owner", null))).toBeNull();
  });
});

describe("requireRole", () => {
  it("admits a role on the list", async () => {
    const guard = await requireRole(reqFor(ownerId, "owner", null), ["owner"]);
    expect(guard.ok).toBe(true);
  });

  it("refuses a role not on the list with 403", async () => {
    const guard = await requireRole(reqFor(driverId, "delivery_driver", groupEast), ["owner", "group_manager"]);
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.response.status).toBe(403);
      expect((await guard.response.json()).error).toBeTruthy();
    }
  });

  it("refuses an anonymous request with 401", async () => {
    const guard = await requireRole(new NextRequest("http://localhost/api/anything"), ["delivery_driver"]);
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(401);
  });
});

describe("scoping helpers", () => {
  it("gives an owner every group in their own organisation", async () => {
    // Not "all" -- that is platform_owner's answer now. An owner's scope is their
    // organisation's groups, which happens to be every group in this fixture since
    // there is only one organisation in it.
    const s = (await getSession(reqFor(ownerId, "owner", null)))!;
    expect((await scopeGroupIds(s) as number[]).sort()).toEqual([groupEast, groupWest].sort());
    // groupFilter itself does not use that list for an owner -- it filters by
    // organisation instead, so ungrouped rows in this organisation stay visible too.
    expect((await groupFilter(s)).sql).toBe(" AND organization_id = ?");
    expect(await canReachGroup(s, groupWest)).toBe(true);
  });

  it("confines a manager to their own group", async () => {
    const s = (await getSession(reqFor(managerId, "group_manager", groupEast)))!;
    expect(await scopeGroupIds(s)).toEqual([groupEast]);
    expect(await groupFilter(s)).toEqual({ sql: " AND group_id = ?", params: [groupEast] });
    expect(await canReachGroup(s, groupEast)).toBe(true);
    expect(await canReachGroup(s, groupWest)).toBe(false);
  });

  it("lets the filter target a qualified column", async () => {
    const s = (await getSession(reqFor(managerId, "group_manager", groupEast)))!;
    expect(await groupFilter(s, "c.group_id")).toEqual({ sql: " AND c.group_id = ?", params: [groupEast] });
  });

  it("carries the qualifier onto the owner's organisation filter too", async () => {
    // The owner branch swaps group_id for organization_id. A caller that joins another
    // org-scoped table (e.g. delivery_runs JOIN users) must be able to disambiguate it,
    // so a qualified column has to qualify the organization_id it emits.
    const s = (await getSession(reqFor(ownerId, "owner", null)))!;
    expect((await groupFilter(s, "r.group_id")).sql).toBe(" AND r.organization_id = ?");
  });

  it("treats an ungrouped non-owner as reaching nothing", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const id = Number(
      (await db.prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, NULL, 1, ?)")
        .run("orphan", "x:y", "بی‌گروه", "group_manager", now)).lastInsertRowid
    );
    const s = (await getSession(reqFor(id, "group_manager", null)))!;
    expect(await scopeGroupIds(s)).toEqual([]);
    expect(await groupFilter(s)).toEqual({ sql: " AND 1 = 0", params: [] });
    expect(await canReachGroup(s, groupEast)).toBe(false);
  });
});
