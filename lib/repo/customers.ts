import { makeRepo } from "./base";
import { canTransition } from "@/lib/customerLifecycle";
import type { CustomerLifecycle, CustomerType } from "@/lib/types";

export class LifecycleError extends Error {}

interface CustomerRow {
  id: number;
  lifecycle: CustomerLifecycle;
  customer_type: CustomerType | null;
  payment_terms_days: number;
  hard_credit_block: number;
  credit_limit_toman: number | null;
  qualified_at: string | null;
  parent_customer_id: number | null;
}

export const customersRepo = makeRepo<CustomerRow>("customers", { tenant: true });

/** Move a customer to a new lifecycle stage, or throw if the move is not on the
 *  transition table. Stamps `qualified_at` the first time it reaches `qualified`. */
export function setLifecycle(organizationId: number, id: number, to: CustomerLifecycle): void {
  const row = customersRepo.get(organizationId, id);
  if (!row) throw new LifecycleError("مشتری پیدا نشد");
  if (!canTransition(row.lifecycle, to)) {
    throw new LifecycleError(`گذار از «${row.lifecycle}» به «${to}» مجاز نیست`);
  }
  const patch: Partial<CustomerRow> = { lifecycle: to };
  if (to === "qualified" && !row.qualified_at) patch.qualified_at = new Date().toISOString();
  customersRepo.patch(organizationId, id, patch);
}

export function setCustomerType(organizationId: number, id: number, type: CustomerType): void {
  if (!customersRepo.get(organizationId, id)) throw new LifecycleError("مشتری پیدا نشد");
  customersRepo.patch(organizationId, id, { customer_type: type });
}

export function setCreditTerms(
  organizationId: number,
  id: number,
  terms: { payment_terms_days?: number; credit_limit_toman?: number | null; hard_credit_block?: boolean }
): void {
  if (!customersRepo.get(organizationId, id)) throw new LifecycleError("مشتری پیدا نشد");
  const patch: Partial<CustomerRow> = {};
  if (terms.payment_terms_days !== undefined) patch.payment_terms_days = terms.payment_terms_days;
  if (terms.credit_limit_toman !== undefined) patch.credit_limit_toman = terms.credit_limit_toman;
  if (terms.hard_credit_block !== undefined) patch.hard_credit_block = terms.hard_credit_block ? 1 : 0;
  customersRepo.patch(organizationId, id, patch);
}
