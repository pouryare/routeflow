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

beforeAll(async () => {
  ({ a, b } = await seedTwoOrgs(getDb()));
  const mk = async (tag: string, role: string, org: number, gid: number) => {
    const id = Number(
      (await getDb()
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
           VALUES (?, 'x:y', ?, ?, ?, 1, '2026-01-01T00:00:00.000Z', ?)`
        )
        .run(`dv-${role}-${tag}`, `${role} ${tag}`, role, gid, org)).lastInsertRowid
    );
    await getDb().prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?) ON CONFLICT DO NOTHING").run(id, role);
    return id;
  };
  await mk("a", "phone_sales", 1, a.groupId);
  await mk("b", "phone_sales", 2, b.groupId);
  await mk("a", "delivery_driver", 1, a.groupId);
  await mk("b", "delivery_driver", 2, b.groupId);
});

describe("moneyFor", () => {
  it("shows an owner only their own organisation's sellers, drivers and managers", async () => {
    const m = await moneyFor(session("owner", a.ownerId, null, 1));
    expect(m.commission.map((s) => s.display_name).sort()).toEqual(["phone_sales a"]);
    expect(m.driverCommission.map((s) => s.display_name).sort()).toEqual(["delivery_driver a"]);
    expect(m.managerCommission.map((s) => s.manager_user_id)).toEqual([a.managerId]);
    const other = await moneyFor(session("owner", b.ownerId, null, 2));
    expect(other.managerCommission.map((s) => s.manager_user_id)).toEqual([b.managerId]);
  });

  it("gives a group manager their group's people and their own override only", async () => {
    const m = await moneyFor(session("group_manager", a.managerId, a.groupId, 1));
    expect(m.commission.map((s) => s.display_name)).toEqual(["phone_sales a"]);
    expect(m.managerCommission.map((s) => s.manager_user_id)).toEqual([a.managerId]);
  });

  it("gives a seller only their own statement and none of the driver or manager ledgers", async () => {
    const sellerId = (await getDb().prepare("SELECT id FROM users WHERE username = 'dv-phone_sales-a'").get() as { id: number }).id;
    const m = await moneyFor(session("phone_sales", sellerId, a.groupId, 1));
    expect(m.commission.map((s) => s.salesperson_user_id)).toEqual([sellerId]);
    expect(m.driverCommission).toEqual([]);
    expect(m.managerCommission).toEqual([]);
  });
});

describe("stockFor", () => {
  it("lists only the caller's organisation's products", async () => {
    const ids = async (oid: number, uid: number) => (await stockFor(session("owner", uid, null, oid))).stock.map((r) => r.product_id);
    expect(await ids(1, a.ownerId)).toContain(a.productId);
    expect(await ids(1, a.ownerId)).not.toContain(b.productId);
    expect(await ids(2, b.ownerId)).toContain(b.productId);
    expect(await ids(2, b.ownerId)).not.toContain(a.productId);
  });
});

describe("dashboardFor", () => {
  it("returns the figures for the caller's own organisation", async () => {
    const d = await dashboardFor(session("owner", a.ownerId, null, 1));
    expect(d).toHaveProperty("revenue_toman");
    expect(d).toHaveProperty("debt");
    expect(typeof d.order_count).toBe("number");
  });
});

describe("teamTodayFor", () => {
  const today = "2026-06-15";
  const orderOn = async (orgId: number, groupId: number, customerId: number, salesperson: number, orderNo: string) =>
    Number(
      (await getDb()
        .prepare(
          `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, order_date, created_by, created_at, updated_at, organization_id)
           VALUES (?, ?, ?, ?, ?, ?, '2026-06-15T08:00:00.000Z', '2026-06-15T08:00:00.000Z', ?)`
        )
        .run(orderNo, customerId, groupId, salesperson, today, salesperson, orgId)).lastInsertRowid
    );
  const line = async (orderId: number, productId: number, packs: number) => {
    const pk = Number(
      (await getDb()
        .prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, 2, '2026-01-01')")
        .run(productId, `tt-${orderId}-${packs}`)).lastInsertRowid
    );
    await getDb()
      .prepare(
        `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit, created_at)
         VALUES (?, ?, ?, ?, ?, 1000, 600, 2, 0.5, '2026-01-01')`
      )
      .run(orderId, productId, pk, packs, packs);
  };

  it("sums orders, kilograms and revenue per person, scoped to the caller's organisation", async () => {
    const { teamTodayFor } = await import("@/lib/repo/dashboardView");
    const o1 = await orderOn(1, a.groupId, a.customerId, a.managerId, "T-1");
    const o2 = await orderOn(1, a.groupId, a.customerId, a.managerId, "T-2");
    const o3 = await orderOn(2, b.groupId, b.customerId, b.managerId, "T-3");
    await line(o1, a.productId, 3); // 3 packs x 2 per pack x 0.5 kg = 3 kg, revenue 3 x 2 x 1000 = 6000
    await line(o2, a.productId, 1);
    await line(o3, b.productId, 9);

    const mine = await teamTodayFor(session("owner", a.ownerId, null, 1), today);
    const base = (await import("@/lib/orderMath")).orderTotalToman;
    expect(mine.orderCount).toBe(2);
    expect(mine.peopleCount).toBe(1);
    expect(mine.team).toHaveLength(1);
    expect(mine.team[0]).toMatchObject({ n: 2 });
    expect(mine.team[0].kg).toBeCloseTo(4, 6); // (3 + 1) packs x 2 x 0.5
    expect(mine.team[0].revenue).toBe(
      base([{ packs_ordered: 3, packs_delivered: 3, unit_price_toman: 1000, unit_cost_toman: 600, qty_per_pack: 2, kg_per_base_unit: 0.5 }]) +
        base([{ packs_ordered: 1, packs_delivered: 1, unit_price_toman: 1000, unit_cost_toman: 600, qty_per_pack: 2, kg_per_base_unit: 0.5 }])
    );

    const theirs = await teamTodayFor(session("owner", b.ownerId, null, 2), today);
    expect(theirs.orderCount).toBe(1);
    expect(theirs.team.map((t) => t.n)).toEqual([1]);
  });

  it("is empty when nothing was ordered that day", async () => {
    const { teamTodayFor } = await import("@/lib/repo/dashboardView");
    expect(await teamTodayFor(session("owner", a.ownerId, null, 1), "2026-01-02")).toEqual({ team: [], orderCount: 0, peopleCount: 0 });
  });
});
