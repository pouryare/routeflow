import { getDb, plain } from "@/lib/db";
import { canWriteBusiness, isCrmManager, orderFilter, type Session } from "@/lib/session";
import { readCustomerSummary, type CustomerSummary } from "@/lib/customerSummary";
import { ORDER_STATUS_LABEL } from "@/lib/orderStateMachine";
import { outcomeLabel, taskKindLabel } from "@/lib/tasks/labels";
import { faToman } from "@/lib/format";
import { activityLine, compareTimeline, decodeTimelineCursor, encodeTimelineCursor, type TimelineItem, type TimelineKind } from "@/lib/crm/timeline";
import { addLeadContext, getBusiness, productsWithPrice, type BusinessRow } from "./businesses";

export interface ContactRow {
  id: number; name: string | null; role: string; phone_norm: string | null; whatsapp: string | null;
  is_primary: number; is_decider: number; best_time: string | null; note: string | null;
}
export interface Profile {
  business: BusinessRow & {
    secondary_phone: string | null; whatsapp: string | null; website: string | null; instagram: string | null;
    temperature_manual: number;
    size_band: string | null; supply_channel: string | null; visit_window: string | null; visit_note: string | null;
    uses_products_json: string | null;
  };
  tags: string[];
  products: { id: number; name: string; price_toman: number | null }[];
  contacts: ContactRow[]; summary: CustomerSummary | null;
  reps: { id: number; name: string }[]; canWrite: boolean; canManage: boolean;
}

export function profileFor(session: Session, id: number): Profile | null {
  const business = getBusiness(session, id);
  if (!business) return null;
  const db = getDb();
  const org = business.organization_id;
  const extra = db.prepare(`SELECT secondary_phone, whatsapp, website, instagram, size_band, supply_channel, visit_window, visit_note, uses_products_json, COALESCE(temperature_manual, 0) AS temperature_manual
    FROM customers WHERE id = ? AND organization_id = ?`).get(id, org) as {
      secondary_phone: string | null; whatsapp: string | null; website: string | null; instagram: string | null;
      size_band: string | null; supply_channel: string | null; visit_window: string | null; visit_note: string | null;
      uses_products_json: string | null; temperature_manual: number;
    };
  const tags = (plain(db.prepare("SELECT tag FROM customer_tags WHERE customer_id = ? AND organization_id = ? ORDER BY tag").all(id, org)) as { tag: string }[]).map(t => t.tag);
  const contacts = plain(db.prepare(`SELECT id, name, role, phone_norm, whatsapp, is_primary, is_decider, best_time, note
    FROM contacts WHERE customer_id = ? AND organization_id = ? AND active = 1 ORDER BY is_primary DESC, id`).all(id, org)) as unknown as ContactRow[];
  const manager = isCrmManager(session.role);
  return structuredClone({
    business: { ...business, ...extra },
    tags,
    products: productsWithPrice(business.organization_id),
    contacts, summary: readCustomerSummary(db, orderFilter(session), id),
    reps: manager ? addLeadContext(session).reps.map(r => ({ id: r.id, name: r.name })) : [],
    canWrite: canWriteBusiness(session, business), canManage: manager,
  });
}

interface ActRow { id: number; type: string; outcome_code: string | null; note: string | null; verification_to: string | null; stage_to: string | null; at: string; who: string | null }
interface TaskRow { id: number; kind: string; title: string; outcome_code: string | null; at: string; who: string | null }
interface OrderRow { id: number; order_no: string; status: string; order_type: string; at: string; total: number }
interface PayRow { id: number; amount_toman: number; at: string; voided_at: string | null; who: string | null }

/** Each source seeks using the same total order; equal timestamps never lose rows. */
export function timelineFor(session: Session, id: number,
  opts: { before?: string | null; kind?: TimelineKind | null; limit?: number } = {},
): { items: TimelineItem[]; nextBefore: string | null } | null {
  const business = getBusiness(session, id);
  if (!business) return null;
  if (opts.limit !== undefined && !Number.isSafeInteger(opts.limit)) throw new Error("اندازهٔ صفحه نامعتبر است");
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const cursor = opts.before ? decodeTimelineCursor(opts.before) : null;
  const db = getDb(), org = business.organization_id;
  const items: TimelineItem[] = [];
  const want = (kind: TimelineKind) => !opts.kind || opts.kind === kind;
  const seek = (at: string, rowId: string, kind: TimelineKind) => cursor ? {
    sql: ` AND (${at} < ? OR (${at} = ? AND (${rowId} < ? OR (${rowId} = ? AND ? < ?))))`,
    params: [cursor.at, cursor.at, cursor.id, cursor.id, kind, cursor.kind],
  } : { sql: "", params: [] };
  if (want("activity")) {
    const s = seek("a.occurred_at", "a.id", "activity");
    const rows = db.prepare(`SELECT a.id, a.type, a.outcome_code, a.note, a.verification_to, a.stage_to,
      a.occurred_at AS at, u.display_name AS who FROM activities a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.customer_id = ? AND a.organization_id = ?${s.sql}
      ORDER BY a.occurred_at DESC, a.id DESC LIMIT ?`).all(id, org, ...s.params, limit + 1) as unknown as ActRow[];
    for (const a of rows) items.push({ kind: "activity", id: a.id, at: a.at, who: a.who, href: null, ...activityLine(a) });
  }
  if (want("task")) {
    const s = seek("COALESCE(t.done_at, t.created_at)", "t.id", "task");
    const rows = db.prepare(`SELECT t.id, t.kind, t.title, t.outcome_code, COALESCE(t.done_at, t.created_at) AS at,
      u.display_name AS who FROM tasks t LEFT JOIN users u ON u.id = t.assignee_user_id
      WHERE t.organization_id = ? AND t.entity_type = 'customer' AND t.entity_id = ? AND t.status = 'done'
      AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.customer_id = ? AND a.organization_id = ? AND a.completed_task_id = t.id)
      ${s.sql} ORDER BY at DESC, t.id DESC LIMIT ?`).all(org, id, id, org, ...s.params, limit + 1) as unknown as TaskRow[];
    for (const t of rows) items.push({ kind: "task", id: t.id, at: t.at, who: t.who, href: null, tone: null,
      title: `${taskKindLabel(t.kind)} · ${t.title.split(" · ")[0]}`, sub: t.outcome_code ? outcomeLabel(t.outcome_code) : "انجام شد" });
  }
  if (want("order")) {
    const s = seek("o.order_date", "o.id", "order");
    const scope = orderFilter(session);
    const rows = db.prepare(`SELECT o.id, o.order_no, o.status, COALESCE(o.order_type, 'SALE') AS order_type, o.order_date AS at,
      (SELECT COALESCE(SUM(l.packs_ordered * l.unit_price_toman), 0) FROM order_lines l
        WHERE l.order_id = o.id AND COALESCE(l.is_reversal, 0) = 0) AS total
      FROM orders o WHERE o.customer_id = ? AND o.organization_id = ?${scope.sql}${s.sql}
      ORDER BY o.order_date DESC, o.id DESC LIMIT ?`).all(id, org, ...scope.params, ...s.params, limit + 1) as unknown as OrderRow[];
    for (const o of rows) items.push({ kind: "order", id: o.id, at: o.at, who: null, href: `/sales/orders/${o.id}`,
      title: `${o.order_type === "SAMPLE" ? "نمونه" : "سفارش"} ${o.order_no}`,
      sub: `${(ORDER_STATUS_LABEL as Record<string, string>)[o.status] ?? "سفارش"} · ${faToman(o.total)}`,
      tone: o.status === "CANCELLED" ? "muted" : null });
  }
  if (want("payment")) {
    const s = seek("p.received_at", "p.id", "payment");
    const rows = db.prepare(`SELECT p.id, p.amount_toman, p.received_at AS at, p.voided_at, u.display_name AS who
      FROM payments p LEFT JOIN users u ON u.id = p.received_by WHERE p.customer_id = ? AND p.organization_id = ?${s.sql}
      ORDER BY p.received_at DESC, p.id DESC LIMIT ?`).all(id, org, ...s.params, limit + 1) as unknown as PayRow[];
    for (const p of rows) items.push({ kind: "payment", id: p.id, at: p.at, who: p.who, href: null, title: "دریافت وجه",
      sub: `${faToman(p.amount_toman)}${p.voided_at ? " · باطل شد" : ""}`, tone: p.voided_at ? "muted" : "good" });
  }
  items.sort(compareTimeline);
  const page = items.slice(0, limit);
  return { items: page, nextBefore: items.length > limit ? encodeTimelineCursor(page[page.length - 1]) : null };
}
