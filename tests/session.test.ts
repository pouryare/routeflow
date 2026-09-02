import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-session-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
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

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  // organization_id stamped on both: scopeGroupIds resolves an owner's groups by
  // querying WHERE organization_id = session.organizationId, so an unstamped group
  // would be invisible to every "owner" session in this file, and an unstamped user's
  // .organization_id would not match the oid: 1 baked into reqFor()'s tokens below.
  const g = db.prepare(
    "INSERT INTO groups (name, slug, color, active, created_at, organization_id) VALUES (?, ?, ?, 1, ?, 1)"
  );
  groupEast = Number(g.run("گروه شرق", "east", "#0ff", now).lastInsertRowid);
  groupWest = Number(g.run("گروه غرب", "west", "#f0f", now).lastInsertRowid);

  const u = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, ?, ?, ?, ?, 1, ?, 1)"
  );
  ownerId = Number(u.run("pourya", "x:y", "پوریا", "owner", null, now).lastInsertRowid);
  managerId = Number(u.run("sara", "x:y", "سارا", "group_manager", groupEast, now).lastInsertRowid);
  driverId = Number(u.run("yousef", "x:y", "یوسف", "driver", groupEast, now).lastInsertRowid);
});

function reqFor(userId: number, role: "owner" | "group_manager" | "driver", gid: number | null, tv = 0) {
  const token = createSessionToken({ uid: userId, role, gid, oid: 1, tv, name: "t" });
  return new NextRequest("http://localhost/api/anything", { headers: { cookie: `${COOKIE_NAME}=${token}` } });
}

describe("getSession", () => {
  it("loads the user behind a valid token", () => {
    const s = getSession(reqFor(managerId, "group_manager", groupEast));
    expect(s?.user.username).toBe("sara");
    expect(s?.role).toBe("group_manager");
    expect(s?.groupId).toBe(groupEast);
  });

  it("returns null when there is no cookie", () => {
    expect(getSession(new NextRequest("http://localhost/api/anything"))).toBeNull();
  });

  it("trusts the database over the token for role and group", () => {
    // A token minted while Sara was an owner must not keep owner powers after demotion.
    const s = getSession(reqFor(managerId, "owner", null));
    expect(s?.role).toBe("group_manager");
    expect(s?.groupId).toBe(groupEast);
  });

  it("rejects a deactivated user", () => {
    const db = getDb();
    db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(driverId);
    expect(getSession(reqFor(driverId, "driver", groupEast))).toBeNull();
    db.prepare("UPDATE users SET active = 1 WHERE id = ?").run(driverId);
  });

  it("rejects a token whose version is behind the user's", () => {
    const db = getDb();
    db.prepare("UPDATE users SET token_version = 5 WHERE id = ?").run(driverId);
    expect(getSession(reqFor(driverId, "driver", groupEast, 0))).toBeNull();
    expect(getSession(reqFor(driverId, "driver", groupEast, 5))).not.toBeNull();
    db.prepare("UPDATE users SET token_version = 0 WHERE id = ?").run(driverId);
  });

  it("rejects a token for a user that no longer exists", () => {
    expect(getSession(reqFor(999999, "owner", null))).toBeNull();
  });
});

describe("requireRole", () => {
  it("admits a role on the list", () => {
    const guard = requireRole(reqFor(ownerId, "owner", null), ["owner"]);
    expect(guard.ok).toBe(true);
  });

  it("refuses a role not on the list with 403", async () => {
    const guard = requireRole(reqFor(driverId, "driver", groupEast), ["owner", "group_manager"]);
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.response.status).toBe(403);
      expect((await guard.response.json()).error).toBeTruthy();
    }
  });

  it("refuses an anonymous request with 401", () => {
    const guard = requireRole(new NextRequest("http://localhost/api/anything"), ["driver"]);
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(401);
  });
});

describe("scoping helpers", () => {
  it("gives an owner every group in their own organisation", () => {
    // Not "all" -- that is platform_owner's answer now. An owner's scope is their
    // organisation's groups, which happens to be every group in this fixture since
    // there is only one organisation in it.
    const s = getSession(reqFor(ownerId, "owner", null))!;
    expect((scopeGroupIds(s) as number[]).sort()).toEqual([groupEast, groupWest].sort());
    // groupFilter itself does not use that list for an owner -- it filters by
    // organisation instead, so ungrouped rows in this organisation stay visible too.
    expect(groupFilter(s).sql).toBe(" AND organization_id = ?");
    expect(canReachGroup(s, groupWest)).toBe(true);
  });

  it("confines a manager to their own group", () => {
    const s = getSession(reqFor(managerId, "group_manager", groupEast))!;
    expect(scopeGroupIds(s)).toEqual([groupEast]);
    expect(groupFilter(s)).toEqual({ sql: " AND group_id = ?", params: [groupEast] });
    expect(canReachGroup(s, groupEast)).toBe(true);
    expect(canReachGroup(s, groupWest)).toBe(false);
  });

  it("lets the filter target a qualified column", () => {
    const s = getSession(reqFor(managerId, "group_manager", groupEast))!;
    expect(groupFilter(s, "c.group_id")).toEqual({ sql: " AND c.group_id = ?", params: [groupEast] });
  });

  it("carries the qualifier onto the owner's organisation filter too", () => {
    // The owner branch swaps group_id for organization_id. A caller that joins another
    // org-scoped table (e.g. delivery_runs JOIN users) must be able to disambiguate it,
    // so a qualified column has to qualify the organization_id it emits.
    const s = getSession(reqFor(ownerId, "owner", null))!;
    expect(groupFilter(s, "r.group_id").sql).toBe(" AND r.organization_id = ?");
  });

  it("treats an ungrouped non-owner as reaching nothing", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const id = Number(
      db.prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, NULL, 1, ?)")
        .run("orphan", "x:y", "بی‌گروه", "group_manager", now).lastInsertRowid
    );
    const s = getSession(reqFor(id, "group_manager", null))!;
    expect(scopeGroupIds(s)).toEqual([]);
    expect(groupFilter(s)).toEqual({ sql: " AND 1 = 0", params: [] });
    expect(canReachGroup(s, groupEast)).toBe(false);
  });
});
