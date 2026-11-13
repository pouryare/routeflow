import { riskFor } from "./creditRisk";
import type { RiskResult } from "@/lib/creditRisk";
import { getDb } from "@/lib/db";
import { isOwner, type Role } from "@/lib/roles";
import { makeRepo } from "./base";
import { advanceOrder, registerOrderEffectHandlers } from "./orders";

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
export async function requestApproval(
  organizationId: number,
  input: {
    order_id: number;
    requested_by: number;
    customer_id: number;
    customer_balance_toman: number;
    credit_limit_toman: number | null;
  }
): Promise<number> {
  const db = creditApprovalsRepo.db();
  const isRep = await db
    .prepare("SELECT 1 FROM representative_profiles WHERE customer_id = ? AND organization_id = ?")
    .get(input.customer_id, organizationId);
  if (isRep) {
    throw new CreditApprovalError("نماینده مشمول کنترل اعتبار نیست — تسویه با چک یا نقد است");
  }
  const overage = Math.max(0, input.customer_balance_toman - (input.credit_limit_toman ?? 0));
  return Number(
    (await db
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
      )).lastInsertRowid
  );
}

/** UIB-A3: credit approval lives under /api/sales (proxy.ts closes /api/admin to group managers),
 *  and a group manager reaches only their own group's requests; an owner reaches all of them. */
export const creditScopeOf = (s: { role: Role; groupId: number | null }): number | null | undefined =>
  isOwner(s.role) ? undefined : s.groupId;

export async function decide(
  organizationId: number,
  id: number,
  verdict: "approved" | "rejected",
  decidedBy: number,
  reason?: string,
  /** A group manager's own group: they decide only their group's orders (UIB-A3). Left out for an owner. */
  scopeGroupId?: number | null
): Promise<void> {
  const row = await creditApprovalsRepo.get(organizationId, id);
  if (!row) throw new CreditApprovalError("درخواست پیدا نشد");
  if (scopeGroupId !== undefined && (await orderGroupOf(organizationId, row.order_id)) !== scopeGroupId) {
    throw new CreditApprovalError("درخواست پیدا نشد");
  }
  if (row.status !== "pending") {
    throw new CreditApprovalError("این درخواست قبلاً تعیین‌تکلیف شده است");
  }
  await creditApprovalsRepo.patch(organizationId, id, {
    status: verdict,
    decided_by: decidedBy,
    decided_at: new Date().toISOString(),
    reason: reason ?? null,
  });
  // The decision drives the order machine: approve -> CONFIRMED (the transition's own
  // effects clear credit_hold and reserve stock); reject -> ON_HOLD, still held until it
  // is cancelled or a payment brings the balance back under the limit and a manager
  // releases it.
  await advanceOrder(
    organizationId,
    row.order_id,
    verdict === "approved" ? "approveCredit" : "rejectCredit",
    { id: decidedBy, role: "group_manager" }
  );
}

/** The `createCreditApprovalTask` effect: submitOrder has already filed the
 *  credit_approvals row; this drops the manager's follow-up reminder. Same shape as the
 *  Phase 1 cheque-bounce reminder. */
registerOrderEffectHandlers({
  async createCreditApprovalTask(conn, _orgId, orderId) {
    const order = await conn
      .prepare("SELECT customer_id FROM orders WHERE id = ?")
      .get(orderId) as { customer_id: number } | undefined;
    if (!order) return;
    const now = new Date().toISOString();
    await conn
      .prepare(
        `INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at)
         VALUES ('customer', ?, ?, ?, 0, ?)`
      )
      .run(
        order.customer_id,
        now.slice(0, 10),
        "سفارش از سقف اعتبار مشتری عبور کرد — نیازمند تأیید مدیر",
        now
      );
  },
});

async function orderGroupOf(organizationId: number, orderId: number): Promise<number | null> {
  const r = await getDb()
    .prepare("SELECT group_id FROM orders WHERE id = ? AND organization_id = ?")
    .get(orderId, organizationId) as { group_id: number | null } | undefined;
  return r ? (r.group_id === null ? null : Number(r.group_id)) : null;
}

export async function listApprovals(
  organizationId: number,
  status?: CreditApprovalRow["status"],
  scopeGroupId?: number | null
): Promise<CreditApprovalRow[]> {
  const rows = status
    ? await creditApprovalsRepo.list(organizationId, { status } as Partial<CreditApprovalRow>)
    : await creditApprovalsRepo.list(organizationId);
  if (scopeGroupId === undefined) return rows;
  const out: CreditApprovalRow[] = [];
  for (const r of rows) if ((await orderGroupOf(organizationId, r.order_id)) === scopeGroupId) out.push(r);
  return out;
}

export interface PendingApprovalCard {
  id: number;
  order_no: string;
  customer_name: string;
  customer_balance_toman: number;
  credit_limit_toman: number | null;
  overage_toman: number;
  requested_at: string;
  /** F46: advisory score of the customer, with its top reasons. */
  risk: RiskResult | null;
}

/** The pending requests with the words a decision card needs (customer, order number), oldest
 *  first. Tenant-scoped through the approval row; the joins only add names. */
/** `scopeGroupId`: a group manager sees only their own group's requests (UIB-A3). */
export async function pendingForDeck(organizationId: number, scopeGroupId?: number | null): Promise<PendingApprovalCard[]> {
  const scoped = scopeGroupId !== undefined;
  const rows = (await getDb()
    .prepare(
      `SELECT ca.id, o.customer_id, o.order_no, c.business_name AS customer_name, ca.customer_balance_toman,
              ca.credit_limit_toman, ca.overage_toman, ca.requested_at
         FROM credit_approvals ca
         JOIN orders o ON o.id = ca.order_id
         JOIN customers c ON c.id = o.customer_id
        WHERE ca.organization_id = ? AND ca.status = 'pending'${scoped ? " AND o.group_id IS NOT DISTINCT FROM ?" : ""}
        ORDER BY ca.requested_at`
    )
    .all(...((scoped ? [organizationId, scopeGroupId] : [organizationId]) as never[]))) as unknown as (Omit<PendingApprovalCard, "risk"> & { customer_id: number })[];
  const risks = await riskFor(organizationId, [...new Set(rows.map((r) => Number(r.customer_id)))]);
  // Plain objects: a database row has a null prototype and cannot cross into a client component.
  return rows.map(({ customer_id, ...r }) => ({ ...r, risk: risks.get(Number(customer_id)) ?? null }));
}
