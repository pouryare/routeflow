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

beforeAll(async () => {
  const db = getDb();
  ({ a, b } = await seedTwoOrgs(db));
  const mk = async (tag: string, role: string, org: number, gid: number) => {
    const id = Number(
      (await db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
           VALUES (?, 'x:y', ?, ?, ?, 1, '2026-01-01T00:00:00.000Z', ?)`
        )
        .run(`${role}-${tag}`, `${role} ${tag}`, role, gid, org)).lastInsertRowid
    );
    await db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?) ON CONFLICT DO NOTHING").run(id, role);
    return id;
  };
  people.sellerA = await mk("a", "phone_sales", 1, a.groupId);
  people.sellerB = await mk("b", "phone_sales", 2, b.groupId);
  people.driverA = await mk("a", "delivery_driver", 1, a.groupId);
  people.driverB = await mk("b", "delivery_driver", 2, b.groupId);
});

describe("orgClause", () => {
  it("narrows to one tenant, and is empty only for null (the platform_owner)", () => {
    expect(orgClause("p.organization_id", 7)).toEqual({ sql: " AND p.organization_id = ?", params: [7] });
    expect(orgClause("p.organization_id", null)).toEqual({ sql: "", params: [] });
  });
});

describe("owner-wide readers are scoped to the caller's organisation", () => {
  it("stockPosition shows each organisation only its own products", async () => {
    const ids = async (org: number | null) => (await stockPosition(getDb(), org)).map((r) => r.product_id);
    expect(await ids(1)).toContain(a.productId);
    expect(await ids(1)).not.toContain(b.productId);
    expect(await ids(2)).toContain(b.productId);
    expect(await ids(2)).not.toContain(a.productId);
    expect(await ids(null)).toEqual(expect.arrayContaining([a.productId, b.productId]));
  });

  it("advancedStockPosition follows the same scope", async () => {
    const ids = async (org: number | null) => (await advancedStockPosition(getDb(), org)).map((r) => r.product_id);
    expect(await ids(1)).toEqual(expect.arrayContaining([a.productId]));
    expect(await ids(1)).not.toContain(b.productId);
    expect(await ids(null)).toEqual(expect.arrayContaining([a.productId, b.productId]));
  });

  it("allStatements (sellers) shows an owner only their own organisation's sellers", async () => {
    const ids = async (org: number | null) => (await allStatements(getDb(), PERIOD, { organizationId: org })).map((s) => s.salesperson_user_id);
    expect(await ids(1)).toContain(people.sellerA);
    expect(await ids(1)).not.toContain(people.sellerB);
    expect(await ids(2)).toEqual([people.sellerB]);
    expect(await ids(null)).toEqual(expect.arrayContaining([people.sellerA, people.sellerB]));
  });

  it("allStatements keeps a group manager inside the organisation as well as the group", async () => {
    // Group ids are unique across tenants, so naming B's group while scoped to org 1 is empty.
    expect(await allStatements(getDb(), PERIOD, { groupId: b.groupId, organizationId: 1 })).toEqual([]);
    expect((await allStatements(getDb(), PERIOD, { groupId: b.groupId, organizationId: 2 })).map((s) => s.salesperson_user_id)).toEqual([people.sellerB]);
  });

  it("allDriverStatements shows an owner only their own organisation's drivers", async () => {
    const ids = async (org: number | null) => (await allDriverStatements(getDb(), PERIOD, { organizationId: org })).map((s) => s.driver_user_id);
    expect(await ids(1)).toContain(people.driverA);
    expect(await ids(1)).not.toContain(people.driverB);
    expect(await ids(2)).toContain(people.driverB);
    expect(await ids(2)).not.toContain(people.driverA);
  });

  it("allManagerStatements shows an owner only their own organisation's managers", async () => {
    const ids = async (org: number | null) => (await allManagerStatements(getDb(), PERIOD, org)).map((s) => s.manager_user_id);
    expect(await ids(1)).toEqual([a.managerId]);
    expect(await ids(2)).toEqual([b.managerId]);
    expect((await ids(null)).sort()).toEqual([a.managerId, b.managerId].sort());
  });

  it("readImpersonatable lists an owner's own organisation only; null lists every tenant", async () => {
    const orgs = async (org: number | null) => new Set((await readImpersonatable(getDb(), org)).map((u) => u.organization_id));
    expect([...await orgs(1)]).toEqual([1]);
    expect([...await orgs(2)]).toEqual([2]);
    expect([...await orgs(null)].sort()).toEqual([1, 2]);
  });
});
