import type { DatabaseSync } from "node:sqlite";

import { effectiveAt } from "@/lib/pricing";
import type { CostRow } from "@/lib/catalogue";

/** Storage for effective-dated cost overrides, and the reads the margin drawer and the
 *  order line both depend on.
 *
 *  In `lib/repo/` because that is the only place NEW raw SQL is allowed --
 *  `tests/repo-boundary.test.ts` fails the build for a `.prepare(` anywhere else, and the
 *  allowlist only ever shrinks. `lib/catalogue.ts` is grandfathered, so `setCost` and
 *  `costBasisFor` may live there; these readers are new files and so they cannot.
 *
 *  The resolver's LOGIC still lives in `lib/catalogue.ts` next to `resolvePrice`, which
 *  it deliberately mirrors -- packaging-specific beats product-wide. This module is the
 *  storage half: it fetches the rows and hands them over. Splitting it that way keeps the
 *  precedence rule in one readable place and the tenancy join in one auditable one.
 */

/** Every cost row for a product, newest first. Unscoped by design: the caller scopes. */
export function costRowsFor(db: DatabaseSync, productId: number): CostRow[] {
  return db
    .prepare(
      `SELECT id, product_id, packaging_id, method, cost_toman, valid_from
         FROM product_costs WHERE product_id = ?`
    )
    .all(productId) as unknown as CostRow[];
}

/** The cost override in force on a date, packaging-specific first.
 *
 *  Returns null when no row is in force -- which is NOT the same as a cost of zero. The
 *  caller falls back to `products.avg_cost_toman`, and if THAT is zero too the answer is
 *  that no cost is known at all. See `costBasisFor` in lib/catalogue.ts.
 */
export function effectiveCost(
  rows: CostRow[],
  packagingId: number | null,
  onDate: string
): CostRow | null {
  const specific =
    packagingId === null ? [] : rows.filter((r) => r.packaging_id === packagingId);
  return (
    effectiveAt(specific, onDate) ??
    effectiveAt(
      rows.filter((r) => r.packaging_id === null),
      onDate
    )
  );
}

/** `products.avg_cost_toman` for a product, or null when there is none to read. */
export function avgCostFor(db: DatabaseSync, productId: number): number | null {
  const row = db
    .prepare("SELECT avg_cost_toman FROM products WHERE id = ?")
    .get(productId) as { avg_cost_toman: number } | undefined;
  return row ? row.avg_cost_toman : null;
}

/** Confirms the product belongs to this organisation before a cost row is written.
 *
 *  `product_costs` carries no `organization_id` of its own -- it reaches a tenant through
 *  `products`, like `product_prices` and `packagings` do. So THIS query is the only thing
 *  standing between one tenant and another's costs, which is why it takes the organisation
 *  rather than trusting the caller's id. Without it, an owner of tenant 1 could set the
 *  cost of tenant 2's product simply by guessing its id.
 *
 *  Returns true when the product is the caller's to write for.
 */
export function productInOrganization(
  db: DatabaseSync,
  productId: number,
  organizationId: number
): boolean {
  return !!db
    .prepare("SELECT id FROM products WHERE id = ? AND organization_id = ?")
    .get(productId, organizationId);
}

/** True when this packaging belongs to this product. Guards a mismatched pair. */
export function packagingBelongsTo(
  db: DatabaseSync,
  packagingId: number,
  productId: number
): boolean {
  return !!db
    .prepare("SELECT id FROM packagings WHERE id = ? AND product_id = ?")
    .get(packagingId, productId);
}
