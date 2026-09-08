import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-ordervis-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { orderFilter } = await import("@/lib/session");
import type { Session } from "@/lib/session";
import type { Role, UserRow } from "@/lib/db";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

function session(role: Role, uid: number, gid: number | null): Session {
  return {
    user: { id: uid, role, group_id: gid, organization_id: 1 } as UserRow,
    role,
    groupId: gid,
    organizationId: 1,
  };
}

describe("orderFilter", () => {
  it("narrows an owner to their own organisation, not to nothing", () => {
    // Owner used to mean "no filter at all" -- correct when there was one company.
    // It is now the tenant boundary: every order in their organisation, and nothing
    // from any other. Only platform_owner gets the true no-filter behaviour.
    const f = orderFilter(session("owner", 1, null));
    expect(f.sql).toBe(" AND o.organization_id = ?");
    expect(f.params).toEqual([1]);
  });

  it("does not narrow anything for a platform_owner", () => {
    const f = orderFilter(session("platform_owner", 1, null));
    expect(f.sql).toBe("");
    expect(f.params).toEqual([]);
  });

  it("narrows a group manager to their own group", () => {
    const f = orderFilter(session("group_manager", 2, 7));
    expect(f.sql).toContain("group_id = ?");
    expect(f.params).toEqual([7]);
  });

  it("narrows a salesperson to the orders they recorded, not their group", () => {
    // Narrower than the group on purpose: a فروشنده sees their own commission and
    // their own customers' orders, not a colleague's. organization_id rides along as
    // defence in depth -- see the comment on orderFilter for what it guards against.
    const f = orderFilter(session("salesperson", 5, 7));
    expect(f.sql).toContain("salesperson_user_id = ?");
    expect(f.sql).toContain("organization_id = ?");
    expect(f.sql).not.toContain("group_id");
    expect(f.params).toEqual([5, 1]);
  });

  it("narrows a driver to the orders on their own runs", () => {
    // Scoped through delivery_stops rather than by group or by date. Behaviour against
    // real rows -- that another driver's stops stay hidden -- is covered in
    // delivery.test.ts against an actual database. organization_id comes first in the
    // params, matching the order the SQL fragment names it in.
    const f = orderFilter(session("driver", 9, 7));
    expect(f.sql).toContain("delivery_stops");
    expect(f.sql).toContain("driver_user_id = ?");
    expect(f.sql).toContain("organization_id = ?");
    expect(f.params).toEqual([1, 9]);
  });

  it("does not let a driver see by group", () => {
    // The group is the wrong boundary here: a driver on the east run has no business
    // reading every east order, only the ones on a van they are driving.
    expect(orderFilter(session("driver", 9, 7)).sql).not.toContain("o.group_id");
  });

  it("shows a manager with no group nothing, rather than everything", () => {
    // An account created before its group was. The empty case must read as "nothing";
    // an empty SQL fragment would widen the query to every order in the company.
    const f = orderFilter(session("group_manager", 3, null));
    expect(f.sql).toBe(" AND 1 = 0");
    expect(f.params).toEqual([]);
  });

  it("uses the alias it is given, so it can be dropped into a join", () => {
    const f = orderFilter(session("group_manager", 2, 7), "ord");
    expect(f.sql).toContain("ord.group_id");
  });

  it("defaults to the o alias", () => {
    expect(orderFilter(session("group_manager", 2, 7)).sql).toContain("o.group_id");
  });

  it("never returns an empty fragment for anyone but a platform_owner", () => {
    // The property that matters: for anyone scoped, appending this to a WHERE clause
    // must always remove rows. An empty string silently means "no filter". owner is
    // included now -- their fragment narrows by organisation rather than being empty.
    for (const role of ["owner", "group_manager", "salesperson", "driver"] as Role[]) {
      for (const gid of [null, 7]) {
        expect(orderFilter(session(role, 4, gid)).sql).not.toBe("");
      }
    }
  });
});
