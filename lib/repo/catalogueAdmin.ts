/** Product price and packaging writes. A product, and everything hanging off it (prices,
 *  packagings), belongs to one company; the product lookup is where that is enforced. */

import { getDb } from "@/lib/db";
import { createPackaging, setPrice } from "@/lib/catalogue";
import { orgClause } from "@/lib/orgScope";

export async function productInOrg(productId: number, organizationId: number | null): Promise<boolean> {
  const org = orgClause("organization_id", organizationId);
  return !!await getDb().prepare(`SELECT id FROM products WHERE id = ?${org.sql}`).get(productId, ...org.params);
}

export async function packagingOfProduct(packagingId: number, productId: number): Promise<boolean> {
  return !!await getDb().prepare("SELECT id FROM packagings WHERE id = ? AND product_id = ?").get(packagingId, productId);
}

export async function addPrice(input: Parameters<typeof setPrice>[1]): Promise<number> {
  return await setPrice(getDb(), input);
}

export async function addPackaging(input: Parameters<typeof createPackaging>[1]): Promise<number> {
  return await createPackaging(getDb(), input);
}
