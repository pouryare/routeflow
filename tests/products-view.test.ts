import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* lib/repo/productsView.ts: the price history and the owner's costing inputs for /sales/products.
 * The history query used to carry no organisation filter and listed every company's price changes
 * (product_prices reaches its tenant only through products), so this uses two organisations. */

const testDbPath = path.join(os.tmpdir(), `rf-products-view-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { priceHistoryFor, ownerCostingFor } = await import("@/lib/repo/productsView");
const { catalogueFor } = await import("@/lib/repo/sessionReads");
type Session = import("@/lib/session").Session;

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];

const owner = (uid: number, oid: number): Session =>
  ({
    user: { id: uid, role: "owner", group_id: null, organization_id: oid, active: 1 } as never,
    role: "owner", groupId: null, organizationId: oid, roles: ["owner"], hasRole: (x: string) => x === "owner",
  }) as unknown as Session;

beforeAll(async () => {
  ({ a, b } = await seedTwoOrgs(getDb()));
  const price = getDb().prepare("INSERT INTO product_prices (product_id, packaging_id, price_toman, valid_from, created_by, created_at) VALUES (?, NULL, ?, ?, ?, '2026-01-01')");
  await price.run(a.productId, 1000, "2026-01-01", a.ownerId);
  await price.run(a.productId, 1200, "2026-03-01", a.ownerId);
  await price.run(b.productId, 9000, "2026-02-01", b.ownerId);
});

describe("priceHistoryFor", () => {
  it("lists only the caller's organisation's price changes, newest first", async () => {
    const mine = await priceHistoryFor(owner(a.ownerId, 1));
    expect(mine.map((r) => r.price_toman)).toEqual([1200, 1000]);
    expect(mine.every((r) => r.product_id === a.productId)).toBe(true);
    expect(mine[0].by_name).toBe("مالک a");
    const theirs = await priceHistoryFor(owner(b.ownerId, 2));
    expect(theirs.map((r) => r.price_toman)).toEqual([9000]);
  });
});

describe("ownerCostingFor", () => {
  it("resolves the company rate and each product's cost basis against one date, for the caller's catalogue only", async () => {
    await getDb().prepare("UPDATE products SET avg_cost_toman = 400 WHERE id = ?").run(a.productId);
    await getDb()
      .prepare("INSERT INTO commission_rates (organization_id, salesperson_user_id, rate_per_kg_toman, valid_from, created_at) VALUES (1, NULL, 250, '2026-01-01', '2026-01-01')")
      .run();
    const session = owner(a.ownerId, 1);
    const products = await catalogueFor(session);
    const costing = await ownerCostingFor(session, products, "2026-06-01");
    expect(costing.companyRatePerKg).toBe(250);
    expect([...costing.basisByProduct.keys()]).toEqual(products.map((p) => p.id));
    expect(costing.basisByProduct.get(a.productId)?.cost_toman).toBe(400);
    expect(costing.basisByProduct.has(b.productId)).toBe(false);
    // The other company has no rate of its own, whatever this one set.
    expect((await ownerCostingFor(owner(b.ownerId, 2), await catalogueFor(owner(b.ownerId, 2)), "2026-06-01")).companyRatePerKg).toBeNull();
  });
});
