import { getDb, type Customer } from "@/lib/db";
import { readCustomers } from "@/lib/customers";
import { readCatalogue, type CatalogueProduct } from "@/lib/catalogue";
import { scopeGroupIds, type Session } from "@/lib/session";

/* The two reads nearly every sales page makes, as functions of the SESSION so a page never opens
 * the database or builds a scope by hand: the customers this caller may reach, and the product
 * catalogue of their organisation. */

/** The customers the session can see (an owner: their whole organisation; anyone else: their
 *  group). `withDebt` attaches each customer's computed balance. */
export function customersFor(session: Session, opts: { withDebt?: boolean } = {}): Customer[] {
  return readCustomers(getDb(), scopeGroupIds(session), opts.withDebt ? { organizationId: session.organizationId } : undefined);
}

/** The product catalogue of the session's organisation. */
export function catalogueFor(
  session: Session,
  opts: { includeInactive?: boolean; onDate?: string } = {}
): CatalogueProduct[] {
  return readCatalogue(getDb(), session.organizationId, opts);
}
