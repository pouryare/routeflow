/** Product price and packaging writes. A product, and everything hanging off it (prices,
 *  packagings), belongs to one company; the product lookup is where that is enforced. */

import { getDb } from "@/lib/db";
import { createPackaging, setPrice } from "@/lib/catalogue";
import { orgClause } from "@/lib/orgScope";

export function productInOrg(productId: number, organizationId: number | null): boolean {
  const org = orgClause("organization_id", organizationId);
  return !!getDb().prepare(`SELECT id FROM products WHERE id = ?${org.sql}`).get(productId, ...org.params);
}

export function packagingOfProduct(packagingId: number, productId: number): boolean {
  return !!getDb().prepare("SELECT id FROM packagings WHERE id = ? AND product_id = ?").get(packagingId, productId);
}

export function addPrice(input: Parameters<typeof setPrice>[1]): number {
  return setPrice(getDb(), input);
}

export function addPackaging(input: Parameters<typeof createPackaging>[1]): number {
  return createPackaging(getDb(), input);
}
