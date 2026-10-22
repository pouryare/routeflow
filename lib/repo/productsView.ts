import { getDb } from "@/lib/db";
import { orgScopeId, type Session } from "@/lib/session";
import { orgClause } from "@/lib/orgScope";
import { costBasisFor, type CatalogueProduct, type CostBasis } from "@/lib/catalogue";
import { companyRatePerKg } from "@/lib/repo/commissionRates";

/* What /sales/products reads beyond the catalogue, as functions of the SESSION. */

export interface PriceHistoryRow {
  id: number;
  product_id: number;
  packaging_id: number | null;
  price_toman: number;
  valid_from: string;
  product_name: string;
  packaging_name: string | null;
  by_name: string | null;
}

/** Every price change of the session's organisation, newest first. Prices are never edited, only
 *  superseded, so this is the whole history; the page shows the latest ten and charts the series.
 *
 *  product_prices carries no organization_id of its own (it reaches a tenant through products), so
 *  the scope is on the joined product. Before this was a function of the session the query had no
 *  organisation filter and listed every company's price changes, product names and who set them. */
export function priceHistoryFor(session: Session): PriceHistoryRow[] {
  const org = orgClause("p.organization_id", orgScopeId(session));
  return getDb()
    .prepare(
      `SELECT pp.id, pp.product_id, pp.packaging_id, pp.price_toman, pp.valid_from,
              p.name AS product_name, pk.name AS packaging_name, u.display_name AS by_name
         FROM product_prices pp
         JOIN products p ON p.id = pp.product_id
         LEFT JOIN packagings pk ON pk.id = pp.packaging_id
         LEFT JOIN users u ON u.id = pp.created_by
        WHERE 1 = 1${org.sql}
        ORDER BY pp.valid_from DESC, pp.id DESC`
    )
    .all(...org.params) as unknown as PriceHistoryRow[];
}

export interface OwnerCosting {
  /** The company-wide per-kg commission in force on the date, or null if none has started. */
  companyRatePerKg: number | null;
  /** Each product's cost basis for its first packaging on the date, or null when nothing is known. */
  basisByProduct: Map<number, CostBasis | null>;
}

/** The owner's costing drawer inputs, all resolved against ONE date through the same
 *  `costBasisFor` the order line snapshots, so there is one answer per product. A null basis is
 *  passed through as unknown rather than as a cost of zero. */
export function ownerCostingFor(session: Session, products: CatalogueProduct[], today: string): OwnerCosting {
  const db = getDb();
  return {
    companyRatePerKg: companyRatePerKg(db, session.organizationId, today),
    basisByProduct: new Map(products.map((p) => [p.id, costBasisFor(db, p.id, p.packagings[0]?.id ?? null, today)])),
  };
}
