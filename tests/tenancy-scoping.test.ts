import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-tenancy-scoping-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { scopeGroupIds, orgFilter, canReachOrg, groupFilter } = await import("@/lib/session");
import type { Session } from "@/lib/session";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

function session(role: string, organizationId: number, groupId: number | null, id = 1): Session {
  return {
    // Only the fields the scoping helpers actually read; the rest of UserRow is
    // irrelevant to this file and would just be noise.
    user: { id, role, group_id: groupId, organization_id: organizationId } as never,
    role: role as never,
    groupId,
    organizationId,
    roles: [role] as Session["roles"],
    hasRole: (x) => x === role,
  };
}

describe("tenant scoping", () => {
  beforeAll(() => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Two', 'two', '2026-01-01')`);
    db.exec(
      `INSERT INTO groups (id, name, slug, created_at, organization_id) VALUES (10, 'A1', 'a1', '2026-01-01', 1)`
    );
    db.exec(
      `INSERT INTO groups (id, name, slug, created_at, organization_id) VALUES (11, 'A2', 'a2', '2026-01-01', 1)`
    );
    db.exec(
      `INSERT INTO groups (id, name, slug, created_at, organization_id) VALUES (20, 'B1', 'b1', '2026-01-01', 2)`
    );
  });

  it("gives a platform_owner every group", () => {
    expect(scopeGroupIds(session("platform_owner", 1, null))).toBe("all");
  });

  it("gives an owner only their own organisation's groups", () => {
    const scope = scopeGroupIds(session("owner", 1, null));
    expect(scope).not.toBe("all");
    expect([...(scope as number[])].sort()).toEqual([10, 11]);
  });

  it("gives an owner of the second organisation only its groups", () => {
    expect(scopeGroupIds(session("owner", 2, null))).toEqual([20]);
  });

  it("gives an owner with no groups yet an empty scope, never everything", () => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id, name, slug, created_at) VALUES (3, 'Three', 'three', '2026-01-01')`);
    expect(scopeGroupIds(session("owner", 3, null))).toEqual([]);
  });

  it("still narrows a group_manager to their one group", () => {
    expect(scopeGroupIds(session("group_manager", 1, 10))).toEqual([10]);
  });

  it("emits a group filter scoped to the owner's organisation, not a list of group ids", () => {
    // Not IN(10, 11): that would exclude any customer, district or location in this
    // organisation that has not been assigned to a group yet, which is a real loss of
    // the "owner sees everything in my company" visibility they had before tenancy.
    const f = groupFilter(session("owner", 1, null));
    expect(f.sql).toBe(" AND organization_id = ?");
    expect(f.params).toEqual([1]);
  });

  it("scopes an owner by organisation even when their organisation has no groups yet", () => {
    // scopeGroupIds returns [] here, but groupFilter's owner branch does not consult it
    // at all -- an organisation, not its groups, is what bounds an owner's visibility.
    // This is deliberately not " AND 1 = 0": an owner of a group-less organisation still
    // has ungrouped rows of their own to see, which the old 1=0 fallback would have hidden.
    expect(groupFilter(session("owner", 3, null))).toEqual({
      sql: " AND organization_id = ?",
      params: [3],
    });
  });

  it("still emits an unreachable filter for a group_manager with no group assigned", () => {
    // The 1=0 fallback is still correct here: an owner's visibility is bounded by
    // organisation, but a group_manager's is bounded by their one group, and a
    // group_manager with none assigned yet really can reach nothing.
    expect(groupFilter(session("group_manager", 1, null)).sql).toBe(" AND 1 = 0");
  });

  it("still emits a single-id equality filter for a group_manager", () => {
    // The single-group case should not gain the IN(...) machinery meant for an owner
    // with several groups -- ` = ?` is simpler SQL and the plan the query planner already
    // knows how to use an index against.
    expect(groupFilter(session("group_manager", 1, 10))).toEqual({
      sql: " AND group_id = ?",
      params: [10],
    });
  });

  it("filters non-group tables by organisation", () => {
    expect(orgFilter(session("owner", 2, null))).toEqual({
      sql: " AND organization_id = ?",
      params: [2],
    });
    expect(orgFilter(session("platform_owner", 1, null))).toEqual({ sql: "", params: [] });
    expect(orgFilter(session("group_manager", 1, 10), "p.organization_id")).toEqual({
      sql: " AND p.organization_id = ?",
      params: [1],
    });
  });

  it("refuses a write into another organisation", () => {
    expect(canReachOrg(session("owner", 1, null), 1)).toBe(true);
    expect(canReachOrg(session("owner", 1, null), 2)).toBe(false);
    expect(canReachOrg(session("owner", 1, null), null)).toBe(false);
    expect(canReachOrg(session("platform_owner", 1, null), 2)).toBe(true);
  });
});

describe("shared reference tables", () => {
  it("the coverage report reads districts with the shared filter, not the tenant one", () => {
    // districts has no organization_id column. groupFilter(owner) adds `AND organization_id = ?`,
    // which made /report throw «no such column: organization_id» for every owner.
    const src = fs.readFileSync(path.join(__dirname, "..", "app/(shell)/report/page.tsx"), "utf8");
    expect(src).toMatch(/groupFilter\(session, "group_id", \{ shared: true \}\)/);
    expect(src).toMatch(/FROM districts WHERE 1 = 1\$\{fd\.sql\}/);
  });

  it("an owner's shared filter carries no organization guard", () => {
    expect(groupFilter(session("owner", 1, null), "group_id", { shared: true }).sql).toBe("");
  });
});
