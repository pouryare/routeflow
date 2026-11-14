import { getDb, plain } from "@/lib/db";
import { MANAGE_ROLES, isOwner } from "@/lib/roles";
import { canWriteBusiness, isCrmManager, orderFilter, type Session } from "@/lib/session";
import { readCustomerSummary, type CustomerSummary } from "@/lib/customerSummary";
import { ORDER_STATUS_LABEL } from "@/lib/orderStateMachine";
import { outcomeLabel, taskKindLabel } from "@/lib/tasks/labels";
import { faToman } from "@/lib/format";
import { activityLine, compareTimeline, decodeTimelineCursor, encodeTimelineCursor, type TimelineItem, type TimelineKind } from "@/lib/crm/timeline";
import { addLeadContext, getBusiness, productsWithPrice, type BusinessRow } from "./businesses";
import { onboardingFor } from "@/lib/repo/onboarding";
import type { Onboarding } from "@/lib/onboarding";
import { customer360, type Customer360 } from "@/lib/repo/customer360";
import { riskFor } from "@/lib/repo/creditRisk";
import { promisesOf, type PromiseRow } from "@/lib/repo/promises";
import { activeHold, type HoldRow } from "@/lib/repo/customerHolds";
import { canChat } from "@/lib/chat";
import { valuesFor, type FieldWithValue } from "@/lib/repo/customFields";
import type { RiskResult } from "@/lib/creditRisk";

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
    /** T5: how this customer came to exist (lib/createdSource.ts). */
    created_source: string | null;
    /** D5: how this customer pays (lib/paymentTerms.ts). */
    payment_terms_kind: string; payment_terms_days: number;
    /** F48: the credit limit in toman, null = no limit. */
    credit_limit_toman: number | null;
    /** D7: economic code or national ID, needed for an official invoice. */
    tax_id: string | null;
  };
  tags: string[];
  products: { id: number; name: string; price_toman: number | null }[];
  contacts: ContactRow[]; summary: CustomerSummary | null;
  reps: { id: number; name: string }[]; canWrite: boolean; canManage: boolean;
  /** D5: the viewer may change how this customer pays (the terms API takes the managers). */
  canSetTerms: boolean;
  /** F48: an owner's credit-limit change applies at once; a manager's raise waits for sign-off. */
  isOwner: boolean;
  /** F46: advisory credit-risk score; managers only, else null. */
  risk: RiskResult | null;
  /** F50: promises to pay, newest first; empty for roles that do not follow them. */
  promises: PromiseRow[];
  canPromise: boolean;
  /** F71: the hold in force on this customer's new orders, if any. */
  hold: HoldRow | null;
  holdCanRelease: boolean;
  /** F69: the driver's standing note, for the people who may write it. */
  deliveryInstructions: string | null;
  deliveryCodeRequired: boolean;
  canInstruct: boolean;
  /** FB9: may write in the customer's chat thread. */
  canChat: boolean;
  /** F122: the company's extra fields with this customer's values. */
  customFields: FieldWithValue[];
  /** F40: the first-order checklist (location, price group, contact, credit). */
  onboarding: Onboarding | null;
  /** F47: open cheques (managers only, else null) and open complaints. */
  open: Customer360;
  /** S17: who sent this customer, and whom this customer sent. */
  referrer?: { id: number; name: string } | null;
  referred?: { id: number; name: string }[];
}

export async function profileFor(session: Session, id: number): Promise<Profile | null> {
  const business = await getBusiness(session, id);
  if (!business) return null;
  const db = getDb();
  const org = business.organization_id;
  const extra = await db.prepare(`SELECT secondary_phone, whatsapp, website, instagram, size_band, supply_channel, visit_window, visit_note, uses_products_json, COALESCE(temperature_manual, 0) AS temperature_manual, created_source, payment_terms_kind, payment_terms_days, credit_limit_toman, tax_id, delivery_instructions, delivery_code_required
    FROM customers WHERE id = ? AND organization_id = ?`).get(id, org) as {
      secondary_phone: string | null; whatsapp: string | null; website: string | null; instagram: string | null;
      size_band: string | null; supply_channel: string | null; visit_window: string | null; visit_note: string | null;
      uses_products_json: string | null; temperature_manual: number; created_source: string | null;
      payment_terms_kind: string; payment_terms_days: number; credit_limit_toman: number | null; tax_id: string | null; delivery_instructions: string | null; delivery_code_required: boolean;
    };
  const tags = (plain(await db.prepare("SELECT tag FROM customer_tags WHERE customer_id = ? AND organization_id = ? ORDER BY tag").all(id, org)) as { tag: string }[]).map(t => t.tag);
  const contacts = plain(await db.prepare(`SELECT id, name, role, phone_norm, whatsapp, is_primary, is_decider, best_time, note
    FROM contacts WHERE customer_id = ? AND organization_id = ? AND active = 1 ORDER BY is_primary DESC, id`).all(id, org)) as unknown as ContactRow[];
  const manager = isCrmManager(session.role);
  const referrer = (await db.prepare(`SELECT r.id, r.business_name AS name FROM customers c JOIN customers r ON r.id = c.referred_by_customer_id AND r.organization_id = c.organization_id
    WHERE c.id = ? AND c.organization_id = ?`).get(id, org)) as { id: number; name: string } | undefined;
  const referred = plain(await db.prepare(`SELECT id, business_name AS name FROM customers WHERE referred_by_customer_id = ? AND organization_id = ? AND merged_into_id IS NULL ORDER BY id DESC LIMIT 20`)
    .all(id, org)) as { id: number; name: string }[];
  const hold = [...MANAGE_ROLES, "phone_sales", "field_rep"].includes(session.role) ? await activeHold(org, id) : null;
  return structuredClone({
    business: { ...business, ...extra },
    tags,
    products: await productsWithPrice(business.organization_id),
    contacts, summary: await readCustomerSummary(db, orderFilter(session), id),
    reps: manager ? (await addLeadContext(session)).reps.map(r => ({ id: r.id, name: r.name })) : [],
    canWrite: canWriteBusiness(session, business), canManage: manager, canSetTerms: (MANAGE_ROLES as readonly string[]).includes(session.role), isOwner: isOwner(session.role),
    risk: (MANAGE_ROLES as readonly string[]).includes(session.role) ? ((await riskFor(org, [id])).get(id) ?? null) : null,
    promises: [...MANAGE_ROLES, "phone_sales", "field_rep"].includes(session.role) ? await promisesOf(org, id) : [],
    canPromise: [...MANAGE_ROLES, "phone_sales", "field_rep"].includes(session.role),
    hold,
    deliveryInstructions: extra.delivery_instructions,
    deliveryCodeRequired: extra.delivery_code_required,
    canInstruct: [...MANAGE_ROLES, "phone_sales", "field_rep"].includes(session.role),
    holdCanRelease: hold !== null && ((MANAGE_ROLES as readonly string[]).includes(session.role) || hold.placed_by === session.user.id),
    canChat: canChat(session.role),
    customFields: await valuesFor(org, id),
    onboarding: await onboardingFor(org, id),
    open: await customer360(session, org, id),
    referrer: referrer ?? null,
    referred,
  });
}

interface ActRow { id: number; type: string; outcome_code: string | null; note: string | null; verification_to: string | null; stage_to: string | null; at: string; who: string | null }
interface TaskRow { id: number; kind: string; title: string; outcome_code: string | null; at: string; who: string | null }
interface OrderRow { id: number; order_no: string; status: string; order_type: string; at: string; total: number }
interface PayRow { id: number; amount_toman: number; at: string; voided_at: string | null; who: string | null }

/** Each source seeks using the same total order; equal timestamps never lose rows. */
export async function timelineFor(session: Session, id: number,
  opts: { before?: string | null; kind?: TimelineKind | null; limit?: number } = {},
): Promise<{ items: TimelineItem[]; nextBefore: string | null } | null> {
  const business = await getBusiness(session, id);
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
    const rows = await db.prepare(`SELECT a.id, a.type, a.outcome_code, a.note, a.verification_to, a.stage_to,
      a.occurred_at AS at, u.display_name AS who FROM activities a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.customer_id = ? AND a.organization_id = ?${s.sql}
      ORDER BY a.occurred_at DESC, a.id DESC LIMIT ?`).all(id, org, ...s.params, limit + 1) as unknown as ActRow[];
    for (const a of rows) items.push({ kind: "activity", id: a.id, at: a.at, who: a.who, href: null, ...activityLine(a) });
  }
  if (want("task")) {
    const s = seek("COALESCE(t.done_at, t.created_at)", "t.id", "task");
    const rows = await db.prepare(`SELECT t.id, t.kind, t.title, t.outcome_code, COALESCE(t.done_at, t.created_at) AS at,
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
    const rows = await db.prepare(`SELECT o.id, o.order_no, o.status, COALESCE(o.order_type, 'SALE') AS order_type, o.order_date AS at,
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
    const rows = await db.prepare(`SELECT p.id, p.amount_toman, p.received_at AS at, p.voided_at, u.display_name AS who
      FROM payments p LEFT JOIN users u ON u.id = p.received_by WHERE p.customer_id = ? AND p.organization_id = ?${s.sql}
      ORDER BY p.received_at DESC, p.id DESC LIMIT ?`).all(id, org, ...s.params, limit + 1) as unknown as PayRow[];
    for (const p of rows) items.push({ kind: "payment", id: p.id, at: p.at, who: p.who, href: null, title: "دریافت وجه",
      sub: `${faToman(p.amount_toman)}${p.voided_at ? " · باطل شد" : ""}`, tone: p.voided_at ? "muted" : "good" });
  }
  items.sort(compareTimeline);
  const page = items.slice(0, limit);
  return { items: page, nextBefore: items.length > limit ? encodeTimelineCursor(page[page.length - 1]) : null };
}
