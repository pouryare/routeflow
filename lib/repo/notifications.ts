import { getDb } from "@/lib/db";
import { toJalali } from "@/lib/jalali";

export type Priority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

export interface FanoutContext {
  kind: string;
  entity_type: string | null;
  entity_id: number | null;
  occurred_at: string;
  meta: Record<string, unknown>;
}

/** Jalali civil date YYYY-MM-DD (Tehran), matching lib/repo/rules.ts jalaliYmd. */
function jalaliYmd(iso: string): string {
  const j = toJalali(iso);
  if (!j) return iso.slice(0, 10);
  return `${j.jy}-${String(j.jm).padStart(2, "0")}-${String(j.jd).padStart(2, "0")}`;
}

export function groupKeyFor(groupScope: "entity" | "type_day", ctx: FanoutContext): string {
  if (groupScope === "entity" && ctx.entity_type && ctx.entity_id != null) {
    return `${ctx.entity_type}:${ctx.entity_id}`;
  }
  return `${ctx.kind}:${jalaliYmd(ctx.occurred_at)}`;
}

function metaStr(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
}

/** Per-type Persian copy. title is a constant phrase; body threads a label out of the
 *  event metadata when the emitter provided one. Keep bodies short — the feed truncates
 *  and Phase 2 concatenates several into one push line. */
const TEMPLATES: Record<string, (m: Record<string, unknown>) => { title_fa: string; body_fa: string | null }> = {
  "task.assigned": (m) => ({ title_fa: "کار جدید برای شما", body_fa: metaStr(m, "title") }),
  "order.confirmed": (m) => ({ title_fa: "سفارش تأیید شد", body_fa: labelOrder(m) }),
  "order.rejected": (m) => ({ title_fa: "سفارش رد/لغو شد", body_fa: labelOrder(m) }),
  "order.created": (m) => ({ title_fa: "سفارش جدید ثبت شد", body_fa: labelOrder(m) }),
  "delivery.succeeded": (m) => ({ title_fa: "تحویل موفق", body_fa: labelOrder(m) }),
  "delivery.failed": (m) => ({ title_fa: "تحویل ناموفق", body_fa: labelOrder(m) }),
  "payment.recorded": (m) => {
    const amt = metaStr(m, "amount_toman");
    const who = metaStr(m, "customer_name");
    return { title_fa: "پرداخت ثبت شد", body_fa: [who, amt ? `${amt} تومان` : null].filter(Boolean).join(" — ") || null };
  },
};

function labelOrder(m: Record<string, unknown>): string | null {
  const no = metaStr(m, "order_no");
  const cust = metaStr(m, "customer_name");
  const parts = [no ? `سفارش ${no}` : null, cust].filter(Boolean);
  return parts.length ? parts.join(" — ") : null;
}

export function renderNotification(
  typeCode: string,
  ctx: FanoutContext
): { title_fa: string; body_fa: string | null } {
  const t = TEMPLATES[typeCode];
  if (t) return t(ctx.meta);
  return { title_fa: typeCode, body_fa: null };
}

/** The one user credited with a given order, scoped to the tenant. */
function orderSalesperson(orgId: number, orderId: number): number | null {
  const row = getDb()
    .prepare("SELECT salesperson_user_id FROM orders WHERE id = ? AND organization_id = ?")
    .get(orderId, orgId) as { salesperson_user_id: number | null } | undefined;
  return row?.salesperson_user_id ?? null;
}

/** Active group_manager user ids sitting in the same group as the given order. */
function orderGroupManagers(orgId: number, orderId: number): number[] {
  return (
    getDb()
      .prepare(
        `SELECT u.id FROM users u
           JOIN orders o ON o.group_id = u.group_id
          WHERE o.id = ? AND u.organization_id = ? AND u.role = 'group_manager' AND u.active = 1`
      )
      .all(orderId, orgId) as { id: number }[]
  ).map((r) => r.id);
}

/** Distinct user ids that should hear about one event, with the actor removed. */
export function recipientsFor(
  organizationId: number,
  typeCode: string,
  ctx: FanoutContext,
  actorUserId: number | null
): number[] {
  const out = new Set<number>();
  const orderId = ctx.entity_type === "order" && ctx.entity_id != null ? ctx.entity_id : null;

  if (typeCode === "task.assigned") {
    const a = ctx.meta["assignee_user_id"];
    if (typeof a === "number") out.add(a);
  } else if (
    typeCode === "order.confirmed" ||
    typeCode === "order.rejected" ||
    typeCode === "delivery.succeeded"
  ) {
    if (orderId) {
      const sp = orderSalesperson(organizationId, orderId);
      if (sp) out.add(sp);
    }
  } else if (typeCode === "delivery.failed") {
    if (orderId) {
      const sp = orderSalesperson(organizationId, orderId);
      if (sp) out.add(sp);
      for (const m of orderGroupManagers(organizationId, orderId)) out.add(m);
    }
  } else if (typeCode === "order.created") {
    if (orderId) for (const m of orderGroupManagers(organizationId, orderId)) out.add(m);
  } else if (typeCode === "payment.recorded") {
    // The payment.recorded event carries entity_type "payment"; one payment can be
    // allocated across several orders, so Task 6 threads the distinct non-null
    // allocation order ids through meta.order_ids. Notify each of their salespeople.
    const ids = Array.isArray(ctx.meta["order_ids"]) ? (ctx.meta["order_ids"] as unknown[]) : [];
    for (const oid of ids) {
      if (typeof oid === "number") {
        const sp = orderSalesperson(organizationId, oid);
        if (sp) out.add(sp);
      }
    }
  }

  if (actorUserId != null) out.delete(actorUserId);
  return [...out];
}
