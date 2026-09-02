import { makeRepo } from "./base";

export class CreditApprovalError extends Error {}

export interface CreditApprovalRow {
  id: number;
  organization_id: number;
  order_id: number;
  requested_by: number;
  requested_at: string;
  customer_balance_toman: number;
  credit_limit_toman: number | null;
  overage_toman: number;
  status: "pending" | "approved" | "rejected" | "expired";
  decided_by: number | null;
  decided_at: string | null;
  reason: string | null;
}

export const creditApprovalsRepo = makeRepo<CreditApprovalRow>("credit_approvals", { tenant: true });

/** Park an order that breaches a direct customer's credit limit. Refuses a representative
 *  customer -- reps settle in cash or bank cheque and are outside credit control. */
export function requestApproval(
  organizationId: number,
  input: {
    order_id: number;
    requested_by: number;
    customer_id: number;
    customer_balance_toman: number;
    credit_limit_toman: number | null;
  }
): number {
  const db = creditApprovalsRepo.db();
  const isRep = db
    .prepare("SELECT 1 FROM representative_profiles WHERE customer_id = ? AND organization_id = ?")
    .get(input.customer_id, organizationId);
  if (isRep) {
    throw new CreditApprovalError("نماینده مشمول کنترل اعتبار نیست — تسویه با چک یا نقد است");
  }
  const overage = Math.max(0, input.customer_balance_toman - (input.credit_limit_toman ?? 0));
  return Number(
    db
      .prepare(
        `INSERT INTO credit_approvals
           (organization_id, order_id, requested_by, requested_at,
            customer_balance_toman, credit_limit_toman, overage_toman, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        organizationId,
        input.order_id,
        input.requested_by,
        new Date().toISOString(),
        input.customer_balance_toman,
        input.credit_limit_toman,
        overage
      ).lastInsertRowid
  );
}

export function decide(
  organizationId: number,
  id: number,
  verdict: "approved" | "rejected",
  decidedBy: number,
  reason?: string
): void {
  const row = creditApprovalsRepo.get(organizationId, id);
  if (!row) throw new CreditApprovalError("درخواست پیدا نشد");
  if (row.status !== "pending") {
    throw new CreditApprovalError("این درخواست قبلاً تعیین‌تکلیف شده است");
  }
  creditApprovalsRepo.patch(organizationId, id, {
    status: verdict,
    decided_by: decidedBy,
    decided_at: new Date().toISOString(),
    reason: reason ?? null,
  });
}

export function listApprovals(
  organizationId: number,
  status?: CreditApprovalRow["status"]
): CreditApprovalRow[] {
  return status
    ? creditApprovalsRepo.list(organizationId, { status } as Partial<CreditApprovalRow>)
    : creditApprovalsRepo.list(organizationId);
}
