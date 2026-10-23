import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* lib/repo/ordersView.ts: what the orders pages read, as functions of the session. Two
 * organisations whose orders share the same order number, so a scope that slipped would show it. */

const testDbPath = path.join(os.tmpdir(), `rf-orders-view-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { ordersListFor, journeyFor, orderPageFor, orderEntryFor } = await import("@/lib/repo/ordersView");
type Session = import("@/lib/session").Session;

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];
let otherGroupInA = 0;
let otherGroupOrder = 0;
let otherGroupCustomer = 0;

function session(role: "owner" | "group_manager" | "phone_sales", uid: number, gid: number | null, oid: number): Session {
  return {
    user: { id: uid, role, group_id: gid, organization_id: oid, active: 1 } as never,
    role, groupId: gid, organizationId: oid, roles: [role], hasRole: (x: string) => x === role,
  } as unknown as Session;
}
const ownerA = () => session("owner", a.ownerId, null, 1);
const managerA = () => session("group_manager", a.managerId, a.groupId, 1);

beforeAll(async () => {
  ({ a, b } = await seedTwoOrgs(getDb()));
  const db = getDb();
  otherGroupInA = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('other', 'other-a', '2026-01-01', 1)").run()).lastInsertRowid);
  otherGroupCustomer = Number(
    (await db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, group_id, organization_id) VALUES ('OG-1', 'other group', '2026-01-01', ?, 1)").run(otherGroupInA)).lastInsertRowid
  );
  otherGroupOrder = Number(
    (await db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, order_date, created_by, created_at, updated_at, organization_id)
         VALUES ('1002', ?, ?, ?, '2026-01-02', ?, '2026-01-02', '2026-01-02', 1)`
      )
      .run(otherGroupCustomer, otherGroupInA, a.managerId, a.managerId)).lastInsertRowid
  );
});

describe("ordersListFor", () => {
  it("shows an owner their whole organisation and nothing of another", async () => {
    const ids = (await ordersListFor(ownerA())).orders.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining([a.orderId, otherGroupOrder]));
    expect(ids).not.toContain(b.orderId);
  });

  it("shows a group manager only their group's orders", async () => {
    const ids = (await ordersListFor(managerA())).orders.map((o) => o.id);
    expect(ids).toContain(a.orderId);
    expect(ids).not.toContain(otherGroupOrder);
    expect(ids).not.toContain(b.orderId);
  });

  it("narrows to a customer only when the caller may see that customer", async () => {
    expect((await ordersListFor(ownerA(), { customerId: a.customerId })).focused?.id).toBe(a.customerId);
    expect((await ordersListFor(ownerA(), { customerId: a.customerId })).orders.map((o) => o.id)).toEqual([a.orderId]);
    // Another group's customer, and another organisation's customer: not focused, so the list is not narrowed to it.
    expect((await ordersListFor(managerA(), { customerId: otherGroupCustomer })).focused).toBeNull();
    expect((await ordersListFor(ownerA(), { customerId: b.customerId })).focused).toBeNull();
  });

  it("marks orders already on a van", async () => {
    expect((await ordersListFor(ownerA())).onARun.size).toBe(0);
    const run = Number(
      (await getDb().prepare("INSERT INTO delivery_runs (driver_user_id, run_date, created_by, created_at, updated_at, organization_id) VALUES (?, '2026-01-01', ?, '2026-01-01', '2026-01-01', 1)").run(a.ownerId, a.ownerId)).lastInsertRowid
    );
    await getDb().prepare("INSERT INTO delivery_stops (run_id, order_id, sort_order, created_at) VALUES (?, ?, 1, '2026-01-01')").run(run, a.orderId);
    expect([...(await ordersListFor(ownerA())).onARun]).toEqual([a.orderId]);
  });
});

describe("orderPageFor", () => {
  it("returns the order and its attempts for a visible order", async () => {
    const page = await orderPageFor(ownerA(), a.orderId);
    expect(page?.order.id).toBe(a.orderId);
    expect(Array.isArray(page?.attempts)).toBe(true);
  });

  it("is null for an order in another organisation, in another group, or that does not exist", async () => {
    expect(await orderPageFor(ownerA(), b.orderId)).toBeNull();
    expect(await orderPageFor(managerA(), otherGroupOrder)).toBeNull();
    expect(await orderPageFor(ownerA(), 999_999)).toBeNull();
  });
});

describe("journeyFor", () => {
  it("follows an order only from the list the caller can already see", async () => {
    const visible = (await ordersListFor(managerA())).orders;
    const j = await journeyFor(managerA(), visible, "one", otherGroupOrder); // asked for an order the list hides
    expect(j.focus?.id).toBe(a.orderId); // falls back to the first visible order
    expect(j.funnel).toBeNull();
  });

  it("builds the funnel only from orders in scope", async () => {
    const all = await journeyFor(managerA(), (await ordersListFor(managerA())).orders, "all", undefined);
    expect(all.journey).toBeNull();
    expect(all.funnel).not.toBeNull();
    const total = (f: NonNullable<typeof all.funnel>) => JSON.stringify(f).length;
    const wide = await journeyFor(ownerA(), (await ordersListFor(ownerA())).orders, "all", undefined);
    expect(total(wide.funnel!)).toBeGreaterThanOrEqual(total(all.funnel!));
  });
});

describe("orderEntryFor", () => {
  it("offers an owner their organisation's customers and sellers, and a seller no sellers", async () => {
    const sellerId = Number(
      (await getDb()
        .prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES ('oe-seller', 'x:y', 'seller', 'phone_sales', ?, 1, '2026-01-01', 1)")
        .run(a.groupId)).lastInsertRowid
    );
    await getDb().prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'phone_sales')").run(sellerId);
    const owner = await orderEntryFor(ownerA());
    expect(owner.customers.map((c) => c.id)).toEqual(expect.arrayContaining([a.customerId, otherGroupCustomer]));
    expect(owner.customers.map((c) => c.id)).not.toContain(b.customerId);
    expect(owner.sellers.map((s) => s.id)).toContain(sellerId);
    expect(owner.products.map((p) => p.id)).toContain(a.productId);
    expect(owner.products.map((p) => p.id)).not.toContain(b.productId);

    const asSeller = await orderEntryFor(session("phone_sales", sellerId, a.groupId, 1));
    expect(asSeller.sellers).toEqual([]);
    expect(asSeller.customers.map((c) => c.id)).toContain(a.customerId);
    expect(asSeller.customers.map((c) => c.id)).not.toContain(otherGroupCustomer);
  });
});
