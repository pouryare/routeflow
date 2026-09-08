import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { faNum } from "@/lib/format";
import { toJalali } from "@/lib/jalali";
import { configureWebPush, webpush } from "@/lib/push";
import { editTelegram, sendTelegram, telegramConfigured } from "@/lib/telegram";

export type Priority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

const RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };
export function priorityRank(p: string): number {
  return RANK[p] ?? 0;
}

/** Would this user get `typeCode` loud on `channel` right now? Pref row > stored default,
 *  AND master switch on, AND the channel actually connected, AND the channel configured. */
export function effectiveRouting(
  userId: number,
  typeCode: string,
  channel: "push" | "telegram",
  db?: DatabaseSync
): boolean {
  if (channel === "push" && !configureWebPush()) return false;
  if (channel === "telegram" && !telegramConfigured()) return false;
  const conn = db ?? getDb();

  const master = conn
    .prepare("SELECT enabled FROM notification_channels WHERE user_id = ? AND channel = ?")
    .get(userId, channel) as { enabled: number } | undefined;
  if (master && master.enabled === 0) return false;

  const pref = conn
    .prepare("SELECT enabled FROM notification_prefs WHERE user_id = ? AND type_code = ? AND channel = ?")
    .get(userId, typeCode, channel) as { enabled: number } | undefined;

  let want: boolean;
  if (pref) want = pref.enabled === 1;
  else {
    const orgId = orgOf(userId, conn);
    const t = catalogueRow(orgId, typeCode, conn);
    const d = channel === "push" ? t?.default_push : t?.default_telegram;
    want = (d ?? 0) === 1;
  }
  if (!want) return false;

  if (channel === "push") {
    const has = conn.prepare("SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1").get(userId);
    return !!has;
  }
  const chat = conn
    .prepare("SELECT telegram_chat_id FROM users WHERE id = ?")
    .get(userId) as { telegram_chat_id: string | null } | undefined;
  return !!chat?.telegram_chat_id;
}

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
  "task.escalated": (m) => ({ title_fa: "کار فوری به شما ارجاع شد", body_fa: metaStr(m, "title") }),
  "credit_approval.waiting": (m) => ({ title_fa: "تأیید اعتبار در انتظار شماست", body_fa: metaStr(m, "customer_name") }),
  "customer.overdue": (m) => ({ title_fa: "مشتری عقب‌افتاده", body_fa: metaStr(m, "customer_name") }),
  "cheque.due_soon": (m) => {
    const no = metaStr(m, "cheque_no");
    const due = metaStr(m, "due_date");
    return {
      title_fa: "سررسید چک نزدیک است",
      body_fa: [no ? `چک ${no}` : null, due].filter(Boolean).join(" — ") || null,
    };
  },
  "reminder.due": (m) => ({ title_fa: "یادآوری سررسید", body_fa: metaStr(m, "message") }),
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

/** The one salesperson credited with this customer's most recent attributed order. */
function customerSalesperson(orgId: number, customerId: number): number | null {
  const row = getDb()
    .prepare(
      `SELECT salesperson_user_id FROM orders
        WHERE customer_id = ? AND organization_id = ? AND salesperson_user_id IS NOT NULL
        ORDER BY order_date DESC LIMIT 1`
    )
    .get(customerId, orgId) as { salesperson_user_id: number | null } | undefined;
  return row?.salesperson_user_id ?? null;
}

/** Active group_manager user ids for the group that owns the given district. */
function districtGroupManagers(orgId: number, districtId: number): number[] {
  return (
    getDb()
      .prepare(
        `SELECT u.id FROM users u
           JOIN districts d ON d.group_id = u.group_id
          WHERE d.id = ? AND u.organization_id = ? AND u.role = 'group_manager' AND u.active = 1`
      )
      .all(districtId, orgId) as { id: number }[]
  ).map((r) => r.id);
}

/** Everyone in the tenant who can sign off a credit decision: owners + group managers. */
function orgApprovers(orgId: number): number[] {
  return (
    getDb()
      .prepare(
        "SELECT id FROM users WHERE organization_id = ? AND role IN ('owner','group_manager') AND active = 1"
      )
      .all(orgId) as { id: number }[]
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
  } else if (typeCode === "task.escalated") {
    // The escalation sweep names the new owner (a role-holder) in meta.
    const a = ctx.meta["assignee_user_id"];
    if (typeof a === "number") out.add(a);
  } else if (typeCode === "customer.overdue") {
    if (ctx.entity_type === "customer" && ctx.entity_id != null) {
      const sp = customerSalesperson(organizationId, ctx.entity_id);
      if (sp) out.add(sp);
    }
  } else if (typeCode === "credit_approval.waiting") {
    for (const u of orgApprovers(organizationId)) out.add(u);
  } else if (typeCode === "cheque.due_soon") {
    if (ctx.entity_type === "cheque" && ctx.entity_id != null) {
      const row = getDb()
        .prepare("SELECT received_by, customer_id FROM cheques WHERE id = ? AND organization_id = ?")
        .get(ctx.entity_id, organizationId) as { received_by: number | null; customer_id: number } | undefined;
      if (row?.received_by) out.add(row.received_by);
      else if (row) {
        const sp = customerSalesperson(organizationId, row.customer_id);
        if (sp) out.add(sp);
      }
    }
  } else if (typeCode === "reminder.due") {
    if (ctx.entity_type === "customer" && ctx.entity_id != null) {
      const sp = customerSalesperson(organizationId, ctx.entity_id);
      if (sp) out.add(sp);
    } else if (ctx.entity_type === "district" && ctx.entity_id != null) {
      for (const m of districtGroupManagers(organizationId, ctx.entity_id)) out.add(m);
    }
  }

  if (actorUserId != null) out.delete(actorUserId);
  return [...out];
}

interface CatalogueRow {
  code: string;
  name_fa: string;
  category: string;
  directedness: string;
  priority: Priority;
  group_scope: "entity" | "type_day";
  default_push: number;
  default_telegram: number;
  active: number;
}

/** The tenant a user belongs to (0 if somehow unset), for the catalogue lookup. */
function orgOf(userId: number, db?: DatabaseSync): number {
  return (
    ((db ?? getDb()).prepare("SELECT organization_id FROM users WHERE id = ?").get(userId) as
      | { organization_id: number | null }
      | undefined)?.organization_id ?? 0
  );
}

/** One catalogue type by code, tenant row winning over the NULL-org default. The single
 *  source of the tenant-override SELECT — `effectiveRouting`, `setPref` and
 *  `fanOutNotifications` all read the catalogue through here. */
function catalogueRow(organizationId: number, code: string, db?: DatabaseSync): CatalogueRow | undefined {
  return (db ?? getDb())
    .prepare(
      `SELECT code, name_fa, category, directedness, priority, group_scope, default_push, default_telegram, active
         FROM notification_types
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
  const type = catalogueRow(organizationId, typeCode, db);
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

/* -------------------------------------------------------------------------- *
 *  Phase 2: per-user prefs matrix, channel master-switch / quiet-hours,      *
 *  and the telegram deep-link nonce. The settings API (Task 8) and the      *
 *  settings UI (Task 10) call these directly.                               *
 * -------------------------------------------------------------------------- */

/** A bad user input (unknown type code, bad channel, malformed HH:MM). Task 8's routes
 *  map `instanceof NotifInputError` to a 400. Kept local so this file does not import
 *  `RuleError` from lib/repo/rules (that would be an import cycle). */
export class NotifInputError extends Error {}

export interface ChannelState {
  enabled: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  critical_breaks_quiet: boolean;
  /** The user has a usable target on this channel (a push subscription / a telegram chat). */
  connected: boolean;
  /** The server has the keys/token to send on this channel at all. */
  configured: boolean;
}

export interface MatrixRow {
  code: string;
  name_fa: string;
  category: string;
  default_push: number;
  default_telegram: number;
  /** Effective on/off, ignoring connection: the pref row if one exists, else the stored default. */
  push: boolean;
  telegram: boolean;
}

/** HH:MM, 24h, zero-padded. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

type ChannelPatch = {
  enabled?: boolean;
  quiet_start?: string | null;
  quiet_end?: string | null;
  critical_breaks_quiet?: boolean;
};

/** Spec defaults for the keys a first `putChannelState` write does not supply. */
const CHANNEL_STATE_DEFAULTS: Record<string, string | number> = {
  enabled: 1,
  quiet_start: "21:00",
  quiet_end: "08:00",
  critical_breaks_quiet: 1,
};

function channelPatchValue(
  key: "enabled" | "quiet_start" | "quiet_end" | "critical_breaks_quiet",
  v: boolean | string | null | undefined
): string | number | null {
  if (key === "enabled" || key === "critical_breaks_quiet") return v ? 1 : 0;
  return v == null ? null : String(v);
}

/** Master switch + quiet-hours window for one channel, plus whether it is connected and
 *  server-configured. Returns the spec defaults when the user has no `notification_channels`
 *  row — it never lazily inserts one (only `putChannelState` writes). */
export function getChannelState(userId: number, channel: "push" | "telegram"): ChannelState {
  const db = getDb();
  const configured = channel === "push" ? configureWebPush() : telegramConfigured();
  const connected =
    channel === "push"
      ? !!db.prepare("SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1").get(userId)
      : !!(
          db.prepare("SELECT telegram_chat_id FROM users WHERE id = ?").get(userId) as
            | { telegram_chat_id: string | null }
            | undefined
        )?.telegram_chat_id;

  const row = db
    .prepare(
      "SELECT enabled, quiet_start, quiet_end, critical_breaks_quiet FROM notification_channels WHERE user_id = ? AND channel = ?"
    )
    .get(userId, channel) as
    | { enabled: number; quiet_start: string | null; quiet_end: string | null; critical_breaks_quiet: number }
    | undefined;

  return {
    enabled: row ? row.enabled === 1 : true,
    quiet_start: row ? row.quiet_start : null,
    quiet_end: row ? row.quiet_end : null,
    critical_breaks_quiet: row ? row.critical_breaks_quiet === 1 : true,
    connected,
    configured,
  };
}

/** Upsert one channel's master switch / quiet-hours. First write fills unset keys with the
 *  spec defaults (21:00 / 08:00, enabled, critical_breaks_quiet); a later write patches only
 *  the keys present in `patch`. `updated_at` is always bumped. Throws `NotifInputError` on a
 *  non-null `quiet_start` / `quiet_end` that is not HH:MM (null clears the bound). */
export function putChannelState(userId: number, channel: "push" | "telegram", patch: ChannelPatch): void {
  for (const k of ["quiet_start", "quiet_end"] as const) {
    if (k in patch) {
      const v = patch[k];
      if (v != null && !HHMM.test(v)) throw new NotifInputError("زمان نامعتبر است");
    }
  }

  const now = new Date().toISOString();
  const cols = ["user_id", "channel", "updated_at"];
  const ph = ["?", "?", "?"];
  const vals: (string | number | null)[] = [userId, channel, now];
  const set = ["updated_at = excluded.updated_at"];
  for (const key of ["enabled", "quiet_start", "quiet_end", "critical_breaks_quiet"] as const) {
    const provided = key in patch;
    cols.push(key);
    ph.push("?");
    vals.push(provided ? channelPatchValue(key, patch[key]) : CHANNEL_STATE_DEFAULTS[key]);
    if (provided) set.push(`${key} = excluded.${key}`);
  }

  getDb()
    .prepare(
      `INSERT INTO notification_channels (${cols.join(", ")}) VALUES (${ph.join(", ")})
       ON CONFLICT(user_id, channel) DO UPDATE SET ${set.join(", ")}`
    )
    .run(...vals);
}

/** Set one (type, channel) pref for a user. If `enabled` matches the type's stored default,
 *  the pref row is deleted (the catalogue default is the source of truth); otherwise it is
 *  upserted. Throws `NotifInputError` on an unknown `typeCode` or a `channel` outside
 *  {push, telegram}. */
export function setPref(userId: number, typeCode: string, channel: "push" | "telegram", enabled: boolean): void {
  if (channel !== "push" && channel !== "telegram") throw new NotifInputError("کانال نامعتبر است");
  const db = getDb();
  const type = catalogueRow(orgOf(userId, db), typeCode, db);
  if (!type) throw new NotifInputError("نوع اعلان ناشناخته است");

  const def = channel === "push" ? type.default_push : type.default_telegram;
  if (Number(enabled) === def) {
    db.prepare("DELETE FROM notification_prefs WHERE user_id = ? AND type_code = ? AND channel = ?").run(
      userId,
      typeCode,
      channel
    );
    return;
  }
  db.prepare(
    `INSERT INTO notification_prefs (user_id, type_code, channel, enabled, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, type_code, channel) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
  ).run(userId, typeCode, channel, Number(enabled), new Date().toISOString());
}

/** The settings screen's whole payload: every active catalogue type (tenant row winning
 *  over the NULL-org default, `system.test` excluded) with its effective push/telegram
 *  on/off, plus the two channel states. */
export function getPrefsMatrix(
  userId: number,
  orgId: number
): { channels: Record<"push" | "telegram", ChannelState>; types: MatrixRow[] } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT code, name_fa, category, default_push, default_telegram
         FROM notification_types
        WHERE (organization_id = ? OR organization_id IS NULL) AND active = 1 AND code <> 'system.test'
        ORDER BY code, (organization_id IS NULL)`
    )
    .all(orgId) as {
    code: string;
    name_fa: string;
    category: string;
    default_push: number;
    default_telegram: number;
  }[];

  const prefs = db
    .prepare("SELECT type_code, channel, enabled FROM notification_prefs WHERE user_id = ?")
    .all(userId) as { type_code: string; channel: string; enabled: number }[];
  const prefBy = new Map<string, number>();
  for (const p of prefs) prefBy.set(`${p.type_code} ${p.channel}`, p.enabled);

  const seen = new Set<string>();
  const types: MatrixRow[] = [];
  for (const r of rows) {
    if (seen.has(r.code)) continue; // ORDER BY put the tenant row (non-null org) first
    seen.add(r.code);
    const p = prefBy.get(`${r.code} push`);
    const t = prefBy.get(`${r.code} telegram`);
    types.push({
      code: r.code,
      name_fa: r.name_fa,
      category: r.category,
      default_push: r.default_push,
      default_telegram: r.default_telegram,
      push: p !== undefined ? p === 1 : r.default_push === 1,
      telegram: t !== undefined ? t === 1 : r.default_telegram === 1,
    });
  }

  return {
    channels: { push: getChannelState(userId, "push"), telegram: getChannelState(userId, "telegram") },
    types,
  };
}

/** Mint (and store on `users.telegram_link_nonce`) a fresh deep-link nonce; a second call
 *  replaces the first. The bot's /start handler (Task 5) matches it to bind the chat. */
export function mintTelegramNonce(userId: number): string {
  const nonce = randomBytes(16).toString("base64url");
  getDb().prepare("UPDATE users SET telegram_link_nonce = ? WHERE id = ?").run(nonce, userId);
  return nonce;
}

/** Unbind telegram: null both the chat id and any pending link nonce. */
export function clearTelegram(userId: number): void {
  getDb().prepare("UPDATE users SET telegram_chat_id = NULL, telegram_link_nonce = NULL WHERE id = ?").run(userId);
}

/* -------------------------------------------------------------------------- *
 *  Phase 2: the loud-channel flush. `flushNotifications` is the only writer   *
 *  of notifications.push_flushed_at / tg_flushed_at and of                    *
 *  notification_deliveries. Called once per org from the rules sweep.         *
 * -------------------------------------------------------------------------- */

/** The business is in Tehran (UTC+03:30, no DST since 2022) and the deploy host runs UTC.
 *  Quiet hours are a wall-clock promise to a person, so they resolve through that zone --
 *  the same reasoning lib/jalali.ts spells out for civil dates. */
const TEHRAN = "Asia/Tehran";

const DEBOUNCE_MS = 120_000; // let a burst of related events settle into one message
const EDIT_WINDOW_MS = 600_000; // within 10 min, update the last digest in place instead of re-notifying
const DIGEST_GROUP_CAP = 4; // show this many group lines, then «و N مورد دیگر»
/** One tag for every digest: a second web-push with the same tag *replaces* the visible
 *  notification instead of stacking a new one — push's version of an edit. */
const PUSH_TAG = "kargah-digest";

const LOUD_CHANNELS = ["push", "telegram"] as const;
type LoudChannel = (typeof LOUD_CHANNELS)[number];
/** The per-channel flush stamp on `notifications`. Interpolated into SQL, never bound —
 *  hence a closed Record rather than a string parameter. */
const FLUSHED_COL: Record<LoudChannel, "push_flushed_at" | "tg_flushed_at"> = {
  push: "push_flushed_at",
  telegram: "tg_flushed_at",
};

/** Type aliases, not interfaces: only an alias gets the implicit index signature that
 *  makes `stmt.all(...) as FlushRow[]` a legal cast from node:sqlite's row type. */
type FlushRow = {
  id: number;
  type_code: string;
  priority: string;
  group_key: string;
  title_fa: string;
  body_fa: string | null;
};

type DeliveryRow = {
  id: number;
  flushed_at: string;
  notification_ids_json: string;
  provider_ref: string | null;
  target: string | null;
};

/** Is `nowHHMM` inside the half-open window [start, end)? An unset bound means no quiet
 *  hours at all. `start > end` is the normal night window and wraps midnight. Plain string
 *  comparison is correct because both sides are zero-padded 24h "HH:MM". */
export function inQuietWindow(nowHHMM: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  if (start <= end) return start <= nowHHMM && nowHHMM < end;
  return nowHHMM >= start || nowHHMM < end;
}

/** One Persian line per `group_key` — «۳ سفارش جدید ثبت شد» for a repeated group, the
 *  notification's own title (plus its body) for a single — joined by « · », capped at
 *  DIGEST_GROUP_CAP with a «و N مورد دیگر» tail. This is the whole message body for both
 *  channels; the deep link is always /notifications. */
function composeDigest(rows: Pick<FlushRow, "group_key" | "title_fa" | "body_fa">[]): string {
  const groups = new Map<string, { title: string; body: string | null; count: number }>();
  for (const r of rows) {
    const g = groups.get(r.group_key);
    if (g) g.count += 1;
    else groups.set(r.group_key, { title: r.title_fa, body: r.body_fa, count: 1 });
  }

  const lines = [...groups.values()].map((g) =>
    g.count > 1 ? `${faNum(g.count)} ${g.title}` : g.body ? `${g.title} — ${g.body}` : g.title
  );
  const head = lines.slice(0, DIGEST_GROUP_CAP).join(" · ");
  const rest = lines.length - DIGEST_GROUP_CAP;
  return rest > 0 ? `${head} · و ${faNum(rest)} مورد دیگر` : head;
}

/** The ids a delivery row already covered, tolerant of a hand-edited/corrupt JSON blob
 *  (the union just starts empty rather than throwing away the whole flush). */
function deliveredIds(json: string): number[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

/** Push the digest to every current subscription of `userId`; returns how many landed.
 *  A `404`/`410` means the browser threw the subscription away — delete it here, which is
 *  the only garbage collection push subscriptions get. */
async function sendPushDigest(conn: DatabaseSync, userId: number, text: string): Promise<number> {
  if (!configureWebPush()) return 0;
  const subs = conn
    .prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as { id: number; endpoint: string; p256dh: string; auth: string }[];

  const payload = JSON.stringify({ title: "کارگاه", body: text, url: "/notifications", tag: PUSH_TAG });
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      ok += 1;
    } catch (e) {
      const code = (e as { statusCode?: number } | null)?.statusCode;
      if (code === 404 || code === 410) {
        conn.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(s.id);
      } else {
        console.warn(`[notif-flush] push send failed for subscription ${s.id}`, e);
      }
    }
  }
  return ok;
}

/** One user × one channel. Returns the counters this channel contributed; a hold, an
 *  "off" channel or a failed send all return without stamping, so the rows come back
 *  next tick. Throws only on a genuine programming/DB error — the caller logs it. */
async function flushChannel(
  conn: DatabaseSync,
  organizationId: number,
  userId: number,
  channel: LoudChannel,
  asOfIso: string,
  nowHHMM: string
): Promise<{ sent: number; edited: number; held: number }> {
  const none = { sent: 0, edited: 0, held: 0 };
  const col = FLUSHED_COL[channel];

  const candidates = conn
    .prepare(
      `SELECT id, type_code, priority, group_key, title_fa, body_fa
         FROM notifications
        WHERE organization_id = ? AND user_id = ? AND ${col} IS NULL
        ORDER BY created_at, id`
    )
    .all(organizationId, userId) as FlushRow[];
  const rows = candidates.filter((r) => effectiveRouting(userId, r.type_code, channel, conn));
  if (rows.length === 0) return none;

  // Quiet hours belong to the channel, not the type: hold the whole batch unless the user
  // asked for CRITICAL to break through and this batch actually carries one.
  const cs = getChannelState(userId, channel);
  const breaks = cs.critical_breaks_quiet && rows.some((r) => r.priority === "CRITICAL");
  if (inQuietWindow(nowHHMM, cs.quiet_start, cs.quiet_end) && !breaks) {
    return { sent: 0, edited: 0, held: rows.length };
  }

  const text = composeDigest(rows);
  const ids = rows.map((r) => r.id);

  const prev = conn
    .prepare(
      `SELECT id, flushed_at, notification_ids_json, provider_ref, target
         FROM notification_deliveries
        WHERE user_id = ? AND channel = ?
        ORDER BY flushed_at DESC, id DESC LIMIT 1`
    )
    .get(userId, channel) as DeliveryRow | undefined;
  const reusable = !!prev && Date.parse(prev.flushed_at) >= Date.parse(asOfIso) - EDIT_WINDOW_MS;

  const updateDelivery = (row: DeliveryRow) => {
    const union = [...new Set([...deliveredIds(row.notification_ids_json), ...ids])];
    conn
      .prepare("UPDATE notification_deliveries SET notification_ids_json = ?, flushed_at = ? WHERE id = ?")
      .run(JSON.stringify(union), asOfIso, row.id);
  };
  const insertDelivery = (providerRef: string, target: string) => {
    conn
      .prepare(
        `INSERT INTO notification_deliveries (user_id, channel, flushed_at, notification_ids_json, provider_ref, target)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(userId, channel, asOfIso, JSON.stringify(ids), providerRef, target);
  };

  let sent = 0;
  let edited = 0;

  if (channel === "push") {
    // Push has no true edit: the same `tag` re-sent replaces the visible notification, so
    // the send is identical either way and only the ledger bookkeeping differs. Doing it
    // once (rather than "try edit, fall back to send") is what keeps a failure from
    // double-notifying.
    const landed = await sendPushDigest(conn, userId, text);
    if (landed === 0) return none; // nothing reached a device -> retry next tick
    if (reusable && prev) {
      updateDelivery(prev);
      edited = 1;
    } else {
      insertDelivery(PUSH_TAG, "push");
      sent = 1;
    }
  } else {
    const chatId = (
      conn.prepare("SELECT telegram_chat_id FROM users WHERE id = ?").get(userId) as
        | { telegram_chat_id: string | null }
        | undefined
    )?.telegram_chat_id;
    if (!chatId) return none; // effectiveRouting already required one; belt and braces

    if (reusable && prev?.provider_ref && (await editTelegram(chatId, Number(prev.provider_ref), text))) {
      updateDelivery(prev);
      edited = 1;
    } else {
      // No recent message, or the edit was refused (message deleted / too old) -> a new one.
      const r = await sendTelegram(chatId, text);
      if (!r) {
        console.warn(`[notif-flush] telegram send returned null for user ${userId}`);
        return none;
      }
      insertDelivery(String(r.message_id), chatId);
      sent = 1;
    }
  }

  conn
    .prepare(`UPDATE notifications SET ${col} = ? WHERE id IN (${ids.map(() => "?").join(",")})`)
    .run(asOfIso, ...ids);
  return { sent, edited, held: 0 };
}

/** Deliver every not-yet-flushed notification of one org to its loud channels, bundled.
 *
 *  Per user: debounce a still-running burst, then for each of push/telegram gather the
 *  rows that channel is opted into, hold them if the user is inside quiet hours, compose
 *  one digest, and either edit the last message (within EDIT_WINDOW_MS) or send a new one.
 *  Only a successful send/edit stamps `<channel>_flushed_at`, so anything held or failed
 *  is picked up by the next tick. The two channels are independent — one can flush a row
 *  while the other still owes it. No failure here aborts the pass. */
export async function flushNotifications(
  organizationId: number,
  asOfIso: string = new Date().toISOString(),
  db?: DatabaseSync
): Promise<{ sent: number; edited: number; held: number }> {
  const conn = db ?? getDb();
  const asOfMs = Date.parse(asOfIso);
  // Tehran, not the server clock. The deploy host runs UTC, so a bare toLocaleTimeString
  // would shift every user's quiet window 3.5 hours earlier -- silence through the Tehran
  // late morning and pings around Tehran midnight. Same convention as lib/jalali.ts.
  const nowHHMM = new Date(asOfIso).toLocaleTimeString("en-GB", { hour12: false, timeZone: TEHRAN }).slice(0, 5);
  const total = { sent: 0, edited: 0, held: 0 };

  const users = conn
    .prepare(
      `SELECT DISTINCT user_id FROM notifications
        WHERE organization_id = ? AND (push_flushed_at IS NULL OR tg_flushed_at IS NULL)`
    )
    .all(organizationId) as { user_id: number }[];

  for (const { user_id: userId } of users) {
    const newest = conn
      .prepare(
        `SELECT MAX(created_at) m FROM notifications
          WHERE organization_id = ? AND user_id = ? AND (push_flushed_at IS NULL OR tg_flushed_at IS NULL)`
      )
      .get(organizationId, userId) as { m: string | null };
    // Still arriving: give the burst DEBOUNCE_MS to finish so it becomes one message.
    if (!newest.m || Date.parse(newest.m) > asOfMs - DEBOUNCE_MS) continue;

    for (const channel of LOUD_CHANNELS) {
      try {
        const r = await flushChannel(conn, organizationId, userId, channel, asOfIso, nowHHMM);
        total.sent += r.sent;
        total.edited += r.edited;
        total.held += r.held;
      } catch (e) {
        console.warn(`[notif-flush] ${channel} failed for user ${userId}`, e);
        continue;
      }
    }
  }

  return total;
}
