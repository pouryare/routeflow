/** The owner/manager write paths of the sales area, as functions that take the company: purchases,
 *  costs, products, stock reads, run deletion and the day-split commit. Each one names the company on
 *  every id it was handed, because an id alone reaches every tenant's rows. */

import { getDb } from "@/lib/db";
import { createProduct, readCatalogue, setCost } from "@/lib/catalogue";
import { deleteRun } from "@/lib/delivery";
import { readOrders } from "@/lib/orders";
import { PurchaseError, readPurchases, recordPurchase, stockPosition } from "@/lib/purchases";
import { readDeletableRun } from "@/lib/repo/deliveries";
import { commitDaySplit, laneTargetsAreReachable } from "@/lib/repo/dayPlan";
import { packagingBelongsTo, productInOrganization } from "@/lib/repo/productCosts";
import { productInOrg } from "@/lib/repo/catalogueAdmin";
import { expiringBatches } from "@/lib/repo/batches";
import { stockLevels } from "@/lib/repo/stock";

type PurchaseInput = Parameters<typeof recordPurchase>[1];

/** Records a purchase. Every product on it must be this company's: the purchase moves the product's
 *  average cost, so a foreign product id would change another company's cost of goods. */
export function recordPurchaseFor(input: PurchaseInput): number {
  for (const line of input.lines) {
    if (!productInOrg(line.product_id, input.organization_id)) throw new PurchaseError("کالا پیدا نشد");
  }
  return recordPurchase(getDb(), input);
}

export function costTargetsInOrg(productId: number, packagingId: number | null, organizationId: number): "ok" | "no-product" | "no-packaging" {
  const db = getDb();
  if (!productInOrganization(db, productId, organizationId)) return "no-product";
  if (packagingId !== null && !packagingBelongsTo(db, packagingId, productId)) return "no-packaging";
  return "ok";
}

export function addCost(input: Parameters<typeof setCost>[1]): number {
  return setCost(getDb(), input);
}

export function catalogueFor(organizationId: number, opts: Parameters<typeof readCatalogue>[2]) {
  return readCatalogue(getDb(), organizationId, opts);
}

export function addProduct(input: Parameters<typeof createProduct>[1]): number {
  return createProduct(getDb(), input);
}

export function stockView(organizationId: number, scopeOrgId: number | null, includePurchases: boolean) {
  const db = getDb();
  const levelByProduct = new Map(stockLevels(organizationId).map((l) => [l.product_id, l]));
  const stock = stockPosition(db, scopeOrgId).map((row) => {
    const lvl = levelByProduct.get(row.product_id);
    return {
      ...row,
      earliest_expiry: lvl?.earliest_expiry ?? null,
      reserved: lvl?.reserved ?? 0,
      available: lvl ? lvl.available : row.on_hand,
    };
  });
  return {
    stock,
    expiringCount: expiringBatches(organizationId).length,
    purchases: includePurchases ? readPurchases(db, organizationId, 25) : [],
  };
}

export function ordersForExport(scope: Parameters<typeof readOrders>[1]) {
  return readOrders(getDb(), scope, { limit: 5000 });
}

export function findDeletableRun(organizationId: number, runId: number) {
  return readDeletableRun(getDb(), organizationId, runId);
}

export function removeRun(runId: number) {
  return deleteRun(getDb(), runId);
}

export function commitPlan(wanted: Parameters<typeof laneTargetsAreReachable>[1], userId: number, organizationId: number) {
  const db = getDb();
  // A lane the caller cannot reach is dropped rather than refused: their screen never showed it.
  const lanes = laneTargetsAreReachable(db, wanted, organizationId);
  if (lanes.length === 0) return null;
  return commitDaySplit(db, lanes, { userId, organizationId });
}
