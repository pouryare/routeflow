import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* lib/repo/commissionView.ts: whose commission a caller may see, shared by the commission page, the
 * commission API and the dashboard. The pickers on the page used to list every company's sellers,
 * drivers and group managers (three unscoped `FROM users` queries). */

const testDbPath = path.join(os.tmpdir(), `rf-commission-view-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { commissionStatementsFor, commissionPeopleFor, commissionRatesFor } = await import("@/lib/repo/commissionView");
type Session = import("@/lib/session").Session;

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const PERIOD = { from: "2026-01-01", to: "2026-12-31" };
let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];
const ids = { sellerA: 0, sellerB: 0, driverA: 0, driverB: 0, fieldRepB: 0 };

function session(role: "owner" | "group_manager" | "phone_sales", uid: number, gid: number | null, oid: number): Session {
  return {
    user: { id: uid, role, group_id: gid, organization_id: oid, active: 1 } as never,
    role, groupId: gid, organizationId: oid, roles: [role], hasRole: (x: string) => x === role,
  } as unknown as Session;
}

beforeAll(() => {
  ({ a, b } = seedTwoOrgs(getDb()));
  const mk = (tag: string, role: string, org: number, gid: number) => {
    const id = Number(
      getDb()
        .prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, 'x:y', ?, ?, ?, 1, '2026-01-01', ?)")
        .run(`cv-${role}-${tag}`, `${role} ${tag}`, role, gid, org).lastInsertRowid
    );
    getDb().prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)").run(id, role);
    return id;
  };
  ids.sellerA = mk("a", "phone_sales", 1, a.groupId);
  ids.sellerB = mk("b", "phone_sales", 2, b.groupId);
  ids.driverA = mk("a", "delivery_driver", 1, a.groupId);
  ids.driverB = mk("b", "delivery_driver", 2, b.groupId);
  ids.fieldRepB = mk("b", "field_rep", 2, b.groupId);
  const rate = getDb().prepare("INSERT INTO commission_rates (organization_id, salesperson_user_id, rate_per_kg_toman, valid_from, created_at) VALUES (?, NULL, ?, ?, '2026-01-01')");
  for (let i = 0; i < 15; i++) rate.run(1, 100 + i, `2025-${String((i % 12) + 1).padStart(2, "0")}-01`);
  rate.run(2, 999, "2026-01-01");
});

describe("commissionPeopleFor", () => {
  it("lists an owner only their own organisation's sellers, van staff and group managers", () => {
    const p = commissionPeopleFor(session("owner", a.ownerId, null, 1));
    expect(p.sellers.map((x) => x.id)).toEqual([ids.sellerA]);
    expect(p.drivers.map((x) => x.id)).toEqual([ids.driverA]);
    expect(p.managers.map((x) => x.id)).toEqual([a.managerId]);
    const q = commissionPeopleFor(session("owner", b.ownerId, null, 2));
    expect(q.sellers.map((x) => x.id)).toEqual([ids.sellerB]);
    expect(q.drivers.map((x) => x.id).sort()).toEqual([ids.driverB, ids.fieldRepB].sort()); // both van roles
    expect(q.managers.map((x) => x.id)).toEqual([b.managerId]);
  });

  it("offers nothing to anyone but an owner", () => {
    for (const s of [session("group_manager", a.managerId, a.groupId, 1), session("phone_sales", ids.sellerA, a.groupId, 1)]) {
      expect(commissionPeopleFor(s)).toEqual({ sellers: [], drivers: [], managers: [] });
    }
  });

  it("returns plain objects (they cross into a client component)", () => {
    const row = commissionPeopleFor(session("owner", a.ownerId, null, 1)).sellers[0];
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });
});

describe("commissionStatementsFor", () => {
  it("gives an owner their whole organisation's ledgers and nothing of another", () => {
    const s = commissionStatementsFor(session("owner", a.ownerId, null, 1), PERIOD);
    expect(s.statements.map((x) => x.salesperson_user_id)).toEqual([ids.sellerA]);
    expect(s.driverStatements.map((x) => x.driver_user_id)).toEqual([ids.driverA]);
    expect(s.managerStatements.map((x) => x.manager_user_id)).toEqual([a.managerId]);
  });

  it("gives a seller only their own statement", () => {
    const s = commissionStatementsFor(session("phone_sales", ids.sellerA, a.groupId, 1), PERIOD);
    expect(s.statements.map((x) => x.salesperson_user_id)).toEqual([ids.sellerA]);
    expect(s.driverStatements).toEqual([]);
    expect(s.managerStatements).toEqual([]);
  });

  it("gives a group manager their group's people and only their own override", () => {
    const s = commissionStatementsFor(session("group_manager", a.managerId, a.groupId, 1), PERIOD);
    expect(s.statements.map((x) => x.salesperson_user_id)).toEqual([ids.sellerA]);
    expect(s.managerStatements.map((x) => x.manager_user_id)).toEqual([a.managerId]);
  });
});

describe("commissionRatesFor", () => {
  it("is owner only, scoped to the organisation, and optionally limited", () => {
    const owner = session("owner", a.ownerId, null, 1);
    expect(commissionRatesFor(owner).rates).toHaveLength(15);
    expect(commissionRatesFor(owner, { limit: 12 }).rates).toHaveLength(12);
    expect(commissionRatesFor(owner).rates.every((r) => r.rate_per_kg_toman < 200)).toBe(true); // org B's 999 is absent
    expect(commissionRatesFor(session("group_manager", a.managerId, a.groupId, 1))).toEqual({ rates: [], driverRates: [], managerOverrides: [] });
  });
});
