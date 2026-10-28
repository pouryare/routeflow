import { describe, it, expect, beforeAll } from "vitest";

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { isFirstOrderToday } = await import("@/lib/repo/orderMilestones");

/* seedTwoOrgs gives each company one order, made by its manager on 2026-01-01. */
let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];

beforeAll(async () => {
  ({ a } = await seedTwoOrgs(getDb()));
});

const NOON = new Date("2026-01-01T09:00:00Z"); // 12:30 in Tehran, the same day as the seeded order

async function addOrder(no: string, createdAt: string) {
  await getDb()
    .prepare(
      `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, order_date,
                           created_by, created_at, updated_at, organization_id)
       VALUES (?, ?, ?, ?, '2026-01-01', ?, ?, ?, ?)`
    )
    .run(no, a.customerId, a.groupId, a.managerId, a.managerId, createdAt, createdAt, a.orgId);
}

describe("isFirstOrderToday", () => {
  it("is true when the one order this person made today is the one just placed", async () => {
    expect(await isFirstOrderToday(a.managerId, a.orgId, NOON)).toBe(true);
  });

  it("is false once they have made a second order the same Tehran day", async () => {
    await addOrder("1002", "2026-01-01T08:00:00.000Z");
    expect(await isFirstOrderToday(a.managerId, a.orgId, NOON)).toBe(false);
  });

  it("does not count an order made before Tehran midnight", async () => {
    // 20:00Z on 31 Dec is 23:30 in Tehran, still the previous day
    expect(await isFirstOrderToday(a.managerId, a.orgId, new Date("2026-01-01T21:00:00Z"))).toBe(false);
  });
});
