import { getDb } from "@/lib/db";
import { setupProgress } from "@/lib/setupChecklist";

const has = async (sql: string, orgId: number): Promise<boolean> => !!(await getDb().prepare(sql).get(orgId));

/** FB19: which setup steps this company has already done, read from its own data. */
export async function setupFor(orgId: number) {
  return setupProgress({
    products: await has("SELECT 1 FROM product_prices pp JOIN products p ON p.id = pp.product_id WHERE p.organization_id = ? LIMIT 1", orgId),
    customers: await has("SELECT 1 FROM customers WHERE organization_id = ? LIMIT 1", orgId),
    // The owner is one user; a team is a second one.
    team: Number(((await getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND active = 1").get(orgId)) as { n: number }).n) > 1,
    vehicle: await has("SELECT 1 FROM vehicles WHERE organization_id = ? LIMIT 1", orgId),
    order: await has("SELECT 1 FROM orders WHERE organization_id = ? LIMIT 1", orgId),
  });
}
