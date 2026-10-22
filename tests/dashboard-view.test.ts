import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* lib/repo/dashboardView.ts: what the dashboard page and its streamed sections read, as functions
 * of the session. Two organisations, so a scope that slipped would show the other company. */

const testDbPath = path.join(os.tmpdir(), `rf-dashboard-view-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { dashboardFor, moneyFor, stockFor } = await import("@/lib/repo/dashboardView");
type Session = import("@/lib/session").Session;

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];

function session(role: "owner" | "group_manager" | "phone_sales", uid: number, gid: number | null, oid: number): Session {
  return {
    user: { id: uid, role, group_id: gid, organization_id: oid, active: 1 } as never,
    role,
    groupId: gid,
    organizationId: oid,
    roles: [role],
    hasRole: (x: string) => x === role,
  } as unknown as Session;
}

beforeAll(() => {
  ({ a, b } = seedTwoOrgs(getDb()));
  const mk = (tag: string, role: string, org: number, gid: number) => {
    const id = Number(
      getDb()
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
           VALUES (?, 'x:y', ?, ?, ?, 1, '2026-01-01T00:00:00.000Z', ?)`
        )
        .run(`dv-${role}-${tag}`, `${role} ${tag}`, role, gid, org).lastInsertRowid
    );
    getDb().prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)").run(id, role);
    return id;
  };
  mk("a", "phone_sales", 1, a.groupId);
  mk("b", "phone_sales", 2, b.groupId);
  mk("a", "delivery_driver", 1, a.groupId);
  mk("b", "delivery_driver", 2, b.groupId);
});

describe("moneyFor", () => {
  it("shows an owner only their own organisation's sellers, drivers and managers", () => {
    const m = moneyFor(session("owner", a.ownerId, null, 1));
    expect(m.commission.map((s) => s.display_name).sort()).toEqual(["phone_sales a"]);
    expect(m.driverCommission.map((s) => s.display_name).sort()).toEqual(["delivery_driver a"]);
    expect(m.managerCommission.map((s) => s.manager_user_id)).toEqual([a.managerId]);
    const other = moneyFor(session("owner", b.ownerId, null, 2));
    expect(other.managerCommission.map((s) => s.manager_user_id)).toEqual([b.managerId]);
  });

  it("gives a group manager their group's people and their own override only", () => {
    const m = moneyFor(session("group_manager", a.managerId, a.groupId, 1));
    expect(m.commission.map((s) => s.display_name)).toEqual(["phone_sales a"]);
    expect(m.managerCommission.map((s) => s.manager_user_id)).toEqual([a.managerId]);
  });

  it("gives a seller only their own statement and none of the driver or manager ledgers", () => {
    const sellerId = (getDb().prepare("SELECT id FROM users WHERE username = 'dv-phone_sales-a'").get() as { id: number }).id;
    const m = moneyFor(session("phone_sales", sellerId, a.groupId, 1));
    expect(m.commission.map((s) => s.salesperson_user_id)).toEqual([sellerId]);
    expect(m.driverCommission).toEqual([]);
    expect(m.managerCommission).toEqual([]);
  });
});

describe("stockFor", () => {
  it("lists only the caller's organisation's products", () => {
    const ids = (oid: number, uid: number) => stockFor(session("owner", uid, null, oid)).stock.map((r) => r.product_id);
    expect(ids(1, a.ownerId)).toContain(a.productId);
    expect(ids(1, a.ownerId)).not.toContain(b.productId);
    expect(ids(2, b.ownerId)).toContain(b.productId);
    expect(ids(2, b.ownerId)).not.toContain(a.productId);
  });
});

describe("dashboardFor", () => {
  it("returns the figures for the caller's own organisation", () => {
    const d = dashboardFor(session("owner", a.ownerId, null, 1));
    expect(d).toHaveProperty("revenue_toman");
    expect(d).toHaveProperty("debt");
    expect(typeof d.order_count).toBe("number");
  });
});
