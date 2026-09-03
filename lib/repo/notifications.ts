import type { DatabaseSync } from "node:sqlite";
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

export function groupKeyFor(
  groupScope: "entity" | "type_day",
  ctx: FanoutContext,
  typeCode: string
): string {
  if (groupScope === "entity" && ctx.entity_type && ctx.entity_id != null) {
    return `${ctx.entity_type}:${ctx.entity_id}`;
  }
  // Spec ("Bundling"): type_day -> "{type_code}:{jalali_date}", and the entity-scope
  // fallback (no entity_id) shares that shape. Keyed on the notification type_code, not
  // the raw event kind.
  return `${typeCode}:${jalaliYmd(ctx.occurred_at)}`;
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
  } else if (typeCode === "order.confirmed" || typeCode === "order.rejected") {
    if (orderId) {
      const sp = orderSalesperson(organizationId, orderId);
      if (sp) out.add(sp);
    }
  } else if (typeCode === "delivery.succeeded" || typeCode === "delivery.failed") {
    // Spec catalogue: both delivery outcomes go to the order's salesperson + the
    // group_manager (ambient). The driver recipient for delivery.failed is Phase 2.
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

interface CatalogueRow {
  code: string;
  name_fa: string;
  directedness: string;
  priority: Priority;
  group_scope: "entity" | "type_day";
  active: number;
}

/** Tenant row wins over the NULL-org default, by code. */
function catalogueType(organizationId: number, code: string, db?: DatabaseSync): CatalogueRow | undefined {
  return (db ?? getDb())
    .prepare(
      `SELECT code, name_fa, directedness, priority, group_scope, active FROM notification_types
        WHERE code = ? AND (organization_id = ? OR organization_id IS NULL)
        ORDER BY (organization_id IS NULL) LIMIT 1`
    )
    .get(code, organizationId) as CatalogueRow | undefined;
}

export interface FanoutRule {
  code: string;
  action_json: string | null;
}

export function fanOutNotifications(
  organizationId: number,
  rule: FanoutRule,
  event: {
    id: number;
    kind: string;
    entity_type: string | null;
    entity_id: number | null;
    actor_user_id: number | null;
    metadata_json: string | null;
    occurred_at: string;
  },
  ruleRunId: number | null,
  db?: DatabaseSync
): number {
  const spec = rule.action_json ? (JSON.parse(rule.action_json) as { notification_type?: string }) : {};
  const typeCode = spec.notification_type;
  if (!typeCode) return 0;
  const type = catalogueType(organizationId, typeCode, db);
  if (!type || !type.active) return 0;

  const ctx: FanoutContext = {
    kind: event.kind,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    occurred_at: event.occurred_at,
    meta: event.metadata_json ? (JSON.parse(event.metadata_json) as Record<string, unknown>) : {},
  };

  const recipients = recipientsFor(organizationId, typeCode, ctx, event.actor_user_id);
  if (recipients.length === 0) return 0;

  const groupKey = groupKeyFor(type.group_scope, ctx, typeCode);
  const rendered = renderNotification(typeCode, ctx);
  const title = rendered.title_fa || type.name_fa;
  const now = new Date().toISOString();

  const insert = (db ?? getDb()).prepare(
    `INSERT INTO notifications
       (organization_id, user_id, type_code, title_fa, body_fa, entity_type, entity_id, group_key,
        priority, created_at, source_event_id, source_rule_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let n = 0;
  for (const uid of recipients) {
    insert.run(
      organizationId,
      uid,
      typeCode,
      title,
      rendered.body_fa,
      ctx.entity_type,
      ctx.entity_id,
      groupKey,
      type.priority,
      now,
      event.id,
      ruleRunId
    );
    n += 1;
  }
  return n;
}

export interface FeedGroup {
  group_key: string;
  latest_at: string;
  count: number;
  unread_count: number;
  title_fa: string;
  body_fa: string | null;
  entity_type: string | null;
  entity_id: number | null;
  priority: string;
  items: { id: number; title_fa: string; body_fa: string | null; created_at: string; read_at: string | null }[];
}

export function listNotificationGroups(
  organizationId: number,
  userId: number,
  opts: { limit?: number } = {}
): FeedGroup[] {
  const rows = getDb()
    .prepare(
      `SELECT id, type_code, title_fa, body_fa, entity_type, entity_id, group_key, priority, created_at, read_at
         FROM notifications
        WHERE organization_id = ? AND user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 500`
    )
    .all(organizationId, userId) as {
    id: number;
    type_code: string;
    title_fa: string;
    body_fa: string | null;
    entity_type: string | null;
    entity_id: number | null;
    group_key: string;
    priority: string;
    created_at: string;
    read_at: string | null;
  }[];

  const byKey = new Map<string, FeedGroup>();
  for (const r of rows) {
    let g = byKey.get(r.group_key);
    if (!g) {
      g = {
        group_key: r.group_key,
        latest_at: r.created_at,
        count: 0,
        unread_count: 0,
        title_fa: r.title_fa,
        body_fa: r.body_fa,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        priority: r.priority,
        items: [],
      };
      byKey.set(r.group_key, g);
    }
    g.count += 1;
    if (!r.read_at) g.unread_count += 1;
    g.items.push({ id: r.id, title_fa: r.title_fa, body_fa: r.body_fa, created_at: r.created_at, read_at: r.read_at });
  }
  const groups = [...byKey.values()].sort((a, b) =>
    a.latest_at > b.latest_at ? -1 : a.latest_at < b.latest_at ? 1 : 0
  );
  return opts.limit ? groups.slice(0, opts.limit) : groups;
}

export function unreadGroupCount(organizationId: number, userId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT group_key) c FROM notifications
        WHERE organization_id = ? AND user_id = ? AND read_at IS NULL`
    )
    .get(organizationId, userId) as { c: number };
  return row.c;
}

export function markGroupsRead(organizationId: number, userId: number, groupKeys: string[] | "all"): void {
  const now = new Date().toISOString();
  if (groupKeys === "all") {
    getDb()
      .prepare("UPDATE notifications SET read_at = ? WHERE organization_id = ? AND user_id = ? AND read_at IS NULL")
      .run(now, organizationId, userId);
    return;
  }
  if (groupKeys.length === 0) return;
  const ph = groupKeys.map(() => "?").join(",");
  getDb()
    .prepare(
      `UPDATE notifications SET read_at = ?
        WHERE organization_id = ? AND user_id = ? AND read_at IS NULL AND group_key IN (${ph})`
    )
    .run(now, organizationId, userId, ...groupKeys);
}
