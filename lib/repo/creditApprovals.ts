import { riskFor } from "./creditRisk";
import { needsOwnerStep } from "@/lib/approvalChain";
import { thresholdsFor } from "./thresholds";
import type { RiskResult } from "@/lib/creditRisk";
import { getDb } from "@/lib/db";
import { isOwner, type Role } from "@/lib/roles";
import { tehranTodayIso } from "@/lib/jalali";
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
  /** "credit": over the customer's limit; "value": over the company's order-value limit (F76). */
  kind: "credit" | "value" | "hold";
  status: "pending" | "approved" | "rejected" | "expired";
  /** F129: the group manager who passed it on to the owner, when the amount needs two steps. */
  manager_ok_by: number | null;
  manager_ok_at: string | null;
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
    /** Left out: a credit request. "value" is an order held for its size; it applies to representatives too. */
    kind?: "credit" | "value" | "hold";
  }
): Promise<number> {
  const db = creditApprovalsRepo.db();
  const kind = input.kind ?? "credit";
  const isRep = await db
    .prepare("SELECT 1 FROM representative_profiles WHERE customer_id = ? AND organization_id = ?")
    .get(input.customer_id, organizationId);
  if (isRep && kind === "credit") {
    throw new CreditApprovalError("نماینده مشمول کنترل اعتبار نیست — تسویه با چک یا نقد است");
  }
  // For a held-for-size order the "balance" is the order's total and the "limit" is the value limit, so the overage reads the same way.
  const overage = Math.max(0, input.customer_balance_toman - (input.credit_limit_toman ?? 0));
  return Number(
    (await db
      .prepare(
        `INSERT INTO credit_approvals
           (organization_id, order_id, requested_by, requested_at,
            customer_balance_toman, credit_limit_toman, overage_toman, status, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(
        organizationId,
        input.order_id,
        input.requested_by,
        new Date().toISOString(),
        input.customer_balance_toman,
        input.credit_limit_toman,
        overage,
        kind
      )).lastInsertRowid
  );
}

/** UIB-A3: credit approval lives under /api/sales (proxy.ts closes /api/admin to group managers),
 *  and a group manager reaches only their own group's requests; an owner reaches all of them. */
export const creditScopeOf = (s: { role: Role; groupId: number | null }): number | null | undefined =>
  isOwner(s.role) ? undefined : s.groupId;

/** Whose approvals a request is in: undefined = all (owner), one group, or several groups. */
export type ApprovalScope = number | null | undefined | readonly (number | null)[];

const allows = (scope: ApprovalScope, groupId: number | null): boolean =>
  scope === undefined ? true : Array.isArray(scope) ? (scope as readonly (number | null)[]).includes(groupId) : scope === groupId;

/** F82: the scope for a signed-in person. A group manager also decides for the group of a colleague who is on
 *  leave and named them to cover (users.leave_delegate_id), for as long as that leave lasts. */
export async function approvalScopeFor(s: { role: Role; groupId: number | null; organizationId: number; user: { id: number } }): Promise<ApprovalScope> {
  if (isOwner(s.role)) return undefined;
  const rows = (await getDb()
    .prepare("SELECT DISTINCT group_id FROM users WHERE organization_id = ? AND leave_delegate_id = ? AND leave_until >= ? AND active = 1")
    .all(s.organizationId, s.user.id, tehranTodayIso())) as unknown as { group_id: number | null }[];
  const covered = rows.map((r) => (r.group_id === null ? null : Number(r.group_id)));
  if (covered.length === 0) return s.groupId;
  return [...new Set<number | null>([s.groupId, ...covered])];
}

export async function decide(
  organizationId: number,
  id: number,
  verdict: "approved" | "rejected",
  decidedBy: number,
  reason?: string,
  /** A group manager's own group: they decide only their group's orders (UIB-A3). Left out for an owner. */
  scopeGroupId?: ApprovalScope,
  /** F129: false for a group manager. Left out = the owner, who always decides in one step. */
  deciderIsOwner = true
): Promise<"decided" | "forwarded"> {
  const row = await creditApprovalsRepo.get(organizationId, id);
  if (!row) throw new CreditApprovalError("درخواست پیدا نشد");
  if (!allows(scopeGroupId, await orderGroupOf(organizationId, row.order_id))) {
    throw new CreditApprovalError("درخواست پیدا نشد");
  }
  if (row.status !== "pending") {
    throw new CreditApprovalError("این درخواست قبلاً تعیین‌تکلیف شده است");
  }
  /* F129: a bigger one needs the owner after the manager. The manager's «تأیید» only records their step and leaves it pending. */
  if (verdict === "approved" && !deciderIsOwner && needsOwnerStep(row, (await thresholdsFor(organizationId)).approval_owner_limit_toman)) {
    if (row.manager_ok_by !== null) throw new CreditApprovalError("این درخواست منتظر تأیید مالک است");
    await creditApprovalsRepo.patch(organizationId, id, { manager_ok_by: decidedBy, manager_ok_at: new Date().toISOString() });
    return "forwarded";
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
  return "decided";
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
    const held = (await conn
      .prepare("SELECT kind FROM credit_approvals WHERE order_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
      .get(orderId)) as { kind: string } | undefined;
    await conn
      .prepare(
        `INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at)
         VALUES ('customer', ?, ?, ?, 0, ?)`
      )
      .run(
        order.customer_id,
        now.slice(0, 10),
        held?.kind === "value" ? "سفارش از سقف مبلغ بدون تأیید بزرگ‌تر است — نیازمند تأیید مدیر" : held?.kind === "hold" ? "این مشتری نگه داشته شده است — سفارش نیازمند تأیید مدیر" : "سفارش از سقف اعتبار مشتری عبور کرد — نیازمند تأیید مدیر",
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
  scopeGroupId?: ApprovalScope
): Promise<CreditApprovalRow[]> {
  const rows = status
    ? await creditApprovalsRepo.list(organizationId, { status } as Partial<CreditApprovalRow>)
    : await creditApprovalsRepo.list(organizationId);
  if (scopeGroupId === undefined) return rows;
  const out: CreditApprovalRow[] = [];
  for (const r of rows) if (allows(scopeGroupId, await orderGroupOf(organizationId, r.order_id))) out.push(r);
  return out;
}

export interface PendingApprovalCard {
  id: number;
  order_no: string;
  customer_name: string;
  kind: "credit" | "value" | "hold";
  customer_balance_toman: number;
  credit_limit_toman: number | null;
  overage_toman: number;
  requested_at: string;
  /** F46: advisory score of the customer, with its top reasons. */
  risk: RiskResult | null;
  /** F129: this one needs the owner after the manager; `manager_ok` says the manager's step is done. */
  two_step: boolean;
  manager_ok: boolean;
}

/** The pending requests with the words a decision card needs (customer, order number), oldest
 *  first. Tenant-scoped through the approval row; the joins only add names. */
/** `scopeGroupId`: a group manager sees only their own group's requests (UIB-A3). */
export async function pendingForDeck(organizationId: number, scopeGroupId?: ApprovalScope): Promise<PendingApprovalCard[]> {
  const scoped = scopeGroupId !== undefined;
  const groups = Array.isArray(scopeGroupId) ? (scopeGroupId as readonly (number | null)[]) : scoped ? [scopeGroupId as number | null] : [];
  const ids = groups.filter((g): g is number => g !== null);
  const withNone = groups.includes(null);
  const rows = (await getDb()
    .prepare(
      `SELECT ca.id, o.customer_id, o.order_no, c.business_name AS customer_name, ca.customer_balance_toman,
              ca.credit_limit_toman, ca.overage_toman, ca.requested_at, ca.kind, ca.manager_ok_by
         FROM credit_approvals ca
         JOIN orders o ON o.id = ca.order_id
         JOIN customers c ON c.id = o.customer_id
        WHERE ca.organization_id = ? AND ca.status = 'pending'${scoped ? " AND ca.manager_ok_by IS NULL" : ""}${scoped ? ` AND (o.group_id = ANY(?::bigint[])${withNone ? " OR o.group_id IS NULL" : ""})` : ""}
        ORDER BY ca.requested_at`
    )
    .all(...((scoped ? [organizationId, ids] : [organizationId]) as never[]))) as unknown as (Omit<PendingApprovalCard, "risk" | "two_step" | "manager_ok"> & { customer_id: number; manager_ok_by: number | null })[];
  const ownerLimit = (await thresholdsFor(organizationId)).approval_owner_limit_toman;
  const risks = await riskFor(organizationId, [...new Set(rows.map((r) => Number(r.customer_id)))]);
  // Plain objects: a database row has a null prototype and cannot cross into a client component.
  return rows.map(({ customer_id, manager_ok_by, ...r }) => ({ ...r, risk: risks.get(Number(customer_id)) ?? null, two_step: needsOwnerStep(r, ownerLimit), manager_ok: manager_ok_by !== null }));
}
