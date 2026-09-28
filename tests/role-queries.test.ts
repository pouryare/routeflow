import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-roleq-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { setRoles, hasRole } = await import("@/lib/repo/userRoles");
const { assignableDrivers, assertAssignableDriver } = await import("@/lib/repo/leadRuns");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/* A person whose PRIMARY is delivery_driver but who also holds field_rep — the case a
 * `WHERE role = '...'` query cannot see, and the one this task exists for.
 *
 * Fixtures learned the hard way in A-Task 3: `organizations.slug` is UNIQUE so it must vary
 * per org, and `groups` has NO organization_id column (name/slug/color/active/created_at). */
function mkDualHat(username: string, primary: string, roles: string[], groupId: number | null, org = 8): number {
  const db = getDb();
  db.exec(`INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (${org},'O-${org}','o-${org}','2026-01-01')`);
  db.exec(
    `INSERT OR IGNORE INTO groups (id,name,slug,color,active,created_at) VALUES (7,'گروه','g7','#000000',1,'2026-01-01')`
  );
  db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, active, token_version, created_at)
     VALUES (?, 'x', ?, ?, ?, ?, 1, 0, '2026-01-01')`
  ).run(username, username, primary, groupId, org);
  const id = (db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
  setRoles(id, roles as never);
  return id;
}

/* `platform_owner` rather than `owner`, and the reason is a real schema fact worth knowing:
 * `groups` has NO `organization_id` column, so `scopeGroupIds` for an OWNER runs
 * `SELECT id FROM groups WHERE organization_id = ?` against a column that does not exist and
 * the scope comes back EMPTY — which then refuses every driver in canReachGroup. That is
 * pre-existing behaviour, not something this task changed, but it makes `owner` unusable as a
 * test session here. `platform_owner` short-circuits to "all" and tests the ROLE question,
 * which is what this file is for. */
const ownerSession = (org = 8) =>
  ({ organizationId: org, groupId: 7, role: "platform_owner", roles: ["platform_owner"], user: { id: 1 }, hasRole: () => true }) as never;

describe("a query that asks who can do X", () => {
  it("finds a field rep whose primary is delivery_driver, in the lead-run dropdown", () => {
    const id = mkDualHat("dual1", "delivery_driver", ["field_rep", "delivery_driver"], 7);
    expect(assignableDrivers(getDb(), ownerSession()).map((r) => r.id)).toContain(id);
  });

  it("does not offer a lead run to someone holding neither van role", () => {
    const seller = mkDualHat("seller", "phone_sales", ["phone_sales"], 7);
    expect(assignableDrivers(getDb(), ownerSession()).map((r) => r.id)).not.toContain(seller);
  });

  it("answers hasRole for a role held non-primarily", () => {
    const id = mkDualHat("dual2", "delivery_driver", ["field_rep", "delivery_driver"], 7);
    expect(hasRole(id, "field_rep")).toBe(true);
    expect(hasRole(id, "phone_sales")).toBe(false);
  });

  it("the GUARD agrees with the dropdown — a visible person is an assignable one", () => {
    // The pair that matters: if the dropdown lists someone and the guard refuses them, the
    // route is offered and then thrown back with a Persian error. Both must read the set.
    const id = mkDualHat("dual3", "delivery_driver", ["field_rep", "delivery_driver"], 7);
    expect(() => assertAssignableDriver(getDb(), ownerSession(), id)).not.toThrow();
  });

  it("the guard refuses someone holding neither van role", () => {
    const seller = mkDualHat("seller2", "phone_sales", ["phone_sales"], 7);
    expect(() => assertAssignableDriver(getDb(), ownerSession(), seller)).toThrow();
  });

  it("a driver whose PRIMARY is something else is still assignable a field route", () => {
    // The inverse case: primary field_rep, holds delivery_driver. A lead route is field
    // work, but the set is the answer, not the column.
    const id = mkDualHat("dual4", "phone_sales", ["field_rep", "delivery_driver", "phone_sales"], 7);
    expect(assignableDrivers(getDb(), ownerSession()).map((r) => r.id)).toContain(id);
  });

  it("EITHER van role qualifies — a delivery-only driver is assignable a lead route", () => {
    // Regression guard. The task plan narrowed this to field_rep only, which made every
    // route assignment 422 for a delivery-only driver and broke tests/api/lead-runs.test.ts.
    // Spec D6 is explicit: the two in-the-van roles are one working day. Both the dropdown
    // and the guard must agree, or the route is offered and then thrown back.
    const id = mkDualHat("deliveryonly", "delivery_driver", ["delivery_driver"], 7);
    expect(assignableDrivers(getDb(), ownerSession()).map((r) => r.id)).toContain(id);
    expect(() => assertAssignableDriver(getDb(), ownerSession(), id)).not.toThrow();
  });

  it("a field-rep-only person is equally assignable", () => {
    const id = mkDualHat("fieldonly", "field_rep", ["field_rep"], 7);
    expect(assignableDrivers(getDb(), ownerSession()).map((r) => r.id)).toContain(id);
    expect(() => assertAssignableDriver(getDb(), ownerSession(), id)).not.toThrow();
  });
});
