import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* The owner-wide readers that server components call DIRECTLY (the commission page, the stock
 * page, the dashboard's stock and money sections), so tests/tenancy-routes.test.ts, which only
 * calls route handlers, cannot reach them. Each takes the organisation as a required argument;
 * these tests pin that org A gets only A, and that null (platform_owner) still gets every tenant. */

const testDbPath = path.join(os.tmpdir(), `rf-tenancy-owner-readers-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { stockPosition, advancedStockPosition } = await import("@/lib/purchases");
const { allStatements } = await import("@/lib/commissionLedger");
const { allDriverStatements } = await import("@/lib/driverCommissionLedger");
const { allManagerStatements } = await import("@/lib/managerCommissionLedger");
const { readImpersonatable } = await import("@/lib/repo/impersonation");
const { orgClause } = await import("@/lib/orgScope");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const PERIOD = { from: "2026-01-01", to: "2026-12-31" };
let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];
const people = { sellerA: 0, sellerB: 0, driverA: 0, driverB: 0 };

beforeAll(() => {
  const db = getDb();
  ({ a, b } = seedTwoOrgs(db));
  const mk = (tag: string, role: string, org: number, gid: number) => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
           VALUES (?, 'x:y', ?, ?, ?, 1, '2026-01-01T00:00:00.000Z', ?)`
        )
        .run(`${role}-${tag}`, `${role} ${tag}`, role, gid, org).lastInsertRowid
    );
    db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)").run(id, role);
    return id;
  };
  people.sellerA = mk("a", "phone_sales", 1, a.groupId);
  people.sellerB = mk("b", "phone_sales", 2, b.groupId);
  people.driverA = mk("a", "delivery_driver", 1, a.groupId);
  people.driverB = mk("b", "delivery_driver", 2, b.groupId);
});

describe("orgClause", () => {
  it("narrows to one tenant, and is empty only for null (the platform_owner)", () => {
    expect(orgClause("p.organization_id", 7)).toEqual({ sql: " AND p.organization_id = ?", params: [7] });
    expect(orgClause("p.organization_id", null)).toEqual({ sql: "", params: [] });
  });
});

describe("owner-wide readers are scoped to the caller's organisation", () => {
  it("stockPosition shows each organisation only its own products", () => {
    const ids = (org: number | null) => stockPosition(getDb(), org).map((r) => r.product_id);
    expect(ids(1)).toContain(a.productId);
    expect(ids(1)).not.toContain(b.productId);
    expect(ids(2)).toContain(b.productId);
    expect(ids(2)).not.toContain(a.productId);
    expect(ids(null)).toEqual(expect.arrayContaining([a.productId, b.productId]));
  });

  it("advancedStockPosition follows the same scope", () => {
    const ids = (org: number | null) => advancedStockPosition(getDb(), org).map((r) => r.product_id);
    expect(ids(1)).toEqual(expect.arrayContaining([a.productId]));
    expect(ids(1)).not.toContain(b.productId);
    expect(ids(null)).toEqual(expect.arrayContaining([a.productId, b.productId]));
  });

  it("allStatements (sellers) shows an owner only their own organisation's sellers", () => {
    const ids = (org: number | null) => allStatements(getDb(), PERIOD, { organizationId: org }).map((s) => s.salesperson_user_id);
    expect(ids(1)).toContain(people.sellerA);
    expect(ids(1)).not.toContain(people.sellerB);
    expect(ids(2)).toEqual([people.sellerB]);
    expect(ids(null)).toEqual(expect.arrayContaining([people.sellerA, people.sellerB]));
  });

  it("allStatements keeps a group manager inside the organisation as well as the group", () => {
    // Group ids are unique across tenants, so naming B's group while scoped to org 1 is empty.
    expect(allStatements(getDb(), PERIOD, { groupId: b.groupId, organizationId: 1 })).toEqual([]);
    expect(allStatements(getDb(), PERIOD, { groupId: b.groupId, organizationId: 2 }).map((s) => s.salesperson_user_id)).toEqual([people.sellerB]);
  });

  it("allDriverStatements shows an owner only their own organisation's drivers", () => {
    const ids = (org: number | null) => allDriverStatements(getDb(), PERIOD, { organizationId: org }).map((s) => s.driver_user_id);
    expect(ids(1)).toContain(people.driverA);
    expect(ids(1)).not.toContain(people.driverB);
    expect(ids(2)).toContain(people.driverB);
    expect(ids(2)).not.toContain(people.driverA);
  });

  it("allManagerStatements shows an owner only their own organisation's managers", () => {
    const ids = (org: number | null) => allManagerStatements(getDb(), PERIOD, org).map((s) => s.manager_user_id);
    expect(ids(1)).toEqual([a.managerId]);
    expect(ids(2)).toEqual([b.managerId]);
    expect(ids(null).sort()).toEqual([a.managerId, b.managerId].sort());
  });

  it("readImpersonatable lists an owner's own organisation only; null lists every tenant", () => {
    const orgs = (org: number | null) => new Set(readImpersonatable(getDb(), org).map((u) => u.organization_id));
    expect([...orgs(1)]).toEqual([1]);
    expect([...orgs(2)]).toEqual([2]);
    expect([...orgs(null)].sort()).toEqual([1, 2]);
  });
});
