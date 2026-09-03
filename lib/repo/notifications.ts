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
