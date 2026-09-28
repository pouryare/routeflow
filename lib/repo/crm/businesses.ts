import { getDb } from "@/lib/db";
import { canSeeBusiness, crmFilter, isCrmManager, type Session } from "@/lib/session";
import { resolveDue } from "@/lib/crm/due";
import type { FlowContext } from "@/lib/crm/flows/types";
import { normalisePersian } from "@/lib/persian";
import { CONTACT_ROLES, CONTACT_ROLE_LABEL, LEAD_SOURCE_LABEL, LEAD_SOURCES, isOneOf, type ContactRole } from "@/lib/crm/vocab";

export const CRM_VIEWS = ["today", "hot", "my_leads", "my_customers", "unassigned", "at_risk", "all"] as const;
export type CrmView = (typeof CRM_VIEWS)[number];

export interface BusinessRow {
  id: number; business_name: string; business_type: string | null; area_label: string | null; address: string | null;
  phone_norm: string | null; lat: number | null; lng: number | null; location_precision: string | null; maps_url: string | null;
  temperature: string | null; sales_stage: string | null; contact_status: string | null; verification: string | null;
  price_tier: string | null; working_hours_json: string | null; source_code: string | null;
  owner_user_id: number | null; owner_name: string | null; group_id: number | null; organization_id: number;
  attempt_count: number; last_activity_at: string | null; next_task_id: number | null;
  next_title: string | null; next_kind: string | null; next_due_at: string | null;
  contact_name: string | null; contact_role: string | null; last_order_at: string | null; closed_at: string | null;
}

const CUSTOMER_STAGES_SQL = "('first_order', 'customer', 'repeat_customer')";
const STAGE = "COALESCE(c.sales_stage, 'unknown')";
const LAST_ORDER = `(SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.id
  AND o.status IN ('DELIVERED', 'CLOSED') AND COALESCE(o.order_type, 'SALE') = 'SALE')`;
const PRIMARY = (col: string) => `(SELECT k.${col} FROM contacts k WHERE k.customer_id = c.id AND k.active = 1 ORDER BY k.is_primary DESC, k.id LIMIT 1)`;

const SELECT = `
  SELECT c.id, c.business_name, c.business_type, c.area_label, c.address, c.phone_norm, c.lat, c.lng,
         c.location_precision, c.maps_url, c.temperature, c.sales_stage, c.contact_status, c.verification,
         c.price_tier, c.working_hours_json, c.source_code, c.owner_user_id, u.display_name AS owner_name,
         c.group_id, c.organization_id, COALESCE(c.attempt_count, 0) AS attempt_count, c.last_activity_at,
         c.next_task_id, t.title AS next_title, t.kind AS next_kind, t.due_at AS next_due_at,
         ${PRIMARY("name")} AS contact_name, ${PRIMARY("role")} AS contact_role,
         ${LAST_ORDER} AS last_order_at, c.closed_at
    FROM customers c
    LEFT JOIN users u ON u.id = c.owner_user_id
    LEFT JOIN tasks t ON t.id = c.next_task_id AND t.status = 'open'`;

/** The next Tehran midnight. */
export const endOfTodayIso = (nowIso: string): string => resolveDue({ kind: "tomorrow", hour: 0 }, nowIso) as string;

function viewSql(view: CrmView, session: Session, nowIso: string): { sql: string; params: (string | number)[] } {
  const open = " AND c.closed_at IS NULL";
  switch (view) {
    case "today":
      return { sql: `${open} AND t.id IS NOT NULL AND t.due_at < ?`, params: [endOfTodayIso(nowIso)] };
    case "hot":
      return { sql: `${open} AND c.temperature = 'hot' AND ${STAGE} NOT IN ${CUSTOMER_STAGES_SQL}`, params: [] };
    case "my_leads":
      return { sql: `${open} AND c.owner_user_id = ? AND ${STAGE} NOT IN ${CUSTOMER_STAGES_SQL}`, params: [session.user.id] };
    case "my_customers":
      return { sql: ` AND c.owner_user_id = ? AND ${STAGE} IN ${CUSTOMER_STAGES_SQL}`, params: [session.user.id] };
    case "unassigned":
      return { sql: `${open} AND c.owner_user_id IS NULL`, params: [] };
    case "at_risk":
      return {
        sql: ` AND ${STAGE} IN ${CUSTOMER_STAGES_SQL} AND COALESCE(${LAST_ORDER}, '') < ?`,
        params: [new Date(Date.parse(nowIso) - 30 * 86_400_000).toISOString().slice(0, 10)],
      };
    default:
      return { sql: "", params: [] };
  }
}

export function listBusinesses(
  session: Session,
  opts: { view: CrmView; q?: string; offset?: number; limit?: number; nowIso?: string }
): { rows: BusinessRow[]; nextOffset: number | null } {
  const now = opts.nowIso ?? new Date().toISOString();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const f = crmFilter(session, "c");
  const v = viewSql(opts.view, session, now);
  const s = searchSql(opts.q);
  const order = opts.view === "today"
    ? "t.due_at ASC, c.id"
    : "CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC, c.last_activity_at DESC, c.id";
  const rows = getDb()
    .prepare(`${SELECT} WHERE c.merged_into_id IS NULL${f.sql}${v.sql}${s.sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...(f.params as never[]), ...(v.params as never[]), ...(s.params as never[]), limit + 1, offset) as unknown as BusinessRow[];
  return { rows: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
}

export function viewCounts(session: Session, nowIso: string = new Date().toISOString()): Record<CrmView, number> {
  const f = crmFilter(session, "c");
  const out = {} as Record<CrmView, number>;
  for (const view of CRM_VIEWS) {
    const v = viewSql(view, session, nowIso);
    out[view] = (getDb()
      .prepare(`SELECT COUNT(*) n FROM customers c LEFT JOIN tasks t ON t.id = c.next_task_id AND t.status = 'open'
                 WHERE c.merged_into_id IS NULL${f.sql}${v.sql}`)
      .get(...(f.params as never[]), ...(v.params as never[])) as { n: number }).n;
  }
  return out;
}

export function getBusiness(session: Session, id: number): BusinessRow | null {
  const row = getDb().prepare(`${SELECT} WHERE c.id = ? AND c.merged_into_id IS NULL`).get(id) as unknown as BusinessRow | undefined;
  return row && canSeeBusiness(session, row) ? row : null;
}

export function productsWithPrice(organizationId: number): FlowContext["products"] {
  return getDb()
    .prepare(`SELECT p.id, p.name,
                (SELECT pp.price_toman FROM product_prices pp WHERE pp.product_id = p.id ORDER BY pp.valid_from DESC, pp.id DESC LIMIT 1) AS price_toman
                FROM products p WHERE p.organization_id = ? AND p.active = 1 ORDER BY p.name`)
    .all(organizationId) as unknown as FlowContext["products"];
}

function searchSql(q: string | undefined): { sql: string; params: string[] } {
  const text = normalisePersian(q ?? "").trim();
  if (!text) return { sql: "", params: [] };
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 4) return { sql: " AND (c.phone_norm LIKE ? OR c.business_name LIKE ?)", params: [`%${digits}%`, `%${text}%`] };
  return { sql: " AND (c.business_name LIKE ? OR c.area_label LIKE ? OR c.address LIKE ?)", params: [`%${text}%`, `%${text}%`, `%${text}%`] };
}

const asRole = (r: string | null): ContactRole => (isOneOf(CONTACT_ROLES, r) ? r : "OTHER");

export function flowContextFor(session: Session, id: number, entry: "call" | "talked_now"): { business: BusinessRow; ctx: FlowContext } | null {
  const business = getBusiness(session, id);
  if (!business) return null;
  const contacts = (getDb()
    .prepare("SELECT id, name, role FROM contacts WHERE customer_id = ? AND organization_id = ? AND active = 1 ORDER BY is_primary DESC, id LIMIT 4")
    .all(id, business.organization_id) as { id: number; name: string | null; role: string }[]).map((c) => ({ id: c.id, name: c.name, role: asRole(c.role) }));
  const first = contacts[0];
  const contactLine = first ? [first.name, CONTACT_ROLE_LABEL[first.role]].filter(Boolean).join(" · ") : "هنوز کسی را نمی‌شناسیم";
  return {
    business,
    ctx: {
      entry,
      firstContact: (business.verification ?? "unverified") === "unverified",
      attemptNo: business.attempt_count + 1,
      maxMisses: 5,
      isManager: isCrmManager(session.role),
      vars: {
        name: business.business_name,
        source: isOneOf(LEAD_SOURCES, business.source_code) ? LEAD_SOURCE_LABEL[business.source_code] : "منبع",
        contact: contactLine,
        address: business.address ?? business.area_label ?? "",
      },
      knownContacts: contacts,
      products: productsWithPrice(business.organization_id),
      reps: [],
      recentCustomers: [],
    },
  };
}

export function addLeadContext(session: Session): FlowContext {
  const db = getDb();
  const manager = isCrmManager(session.role);
  let reps: FlowContext["reps"] = [];
  if (manager) {
    const byGroup = session.role === "owner" || session.role === "platform_owner" ? "" : " AND u.group_id = ?";
    const params: number[] = [session.organizationId, ...(byGroup ? [session.groupId ?? -1] : [])];
    reps = db
      .prepare(`SELECT u.id, u.display_name AS name,
                  (SELECT COUNT(*) FROM customers c WHERE c.owner_user_id = u.id AND c.closed_at IS NULL
                     AND COALESCE(c.sales_stage, 'unknown') NOT IN ${CUSTOMER_STAGES_SQL}) AS open
                  FROM users u WHERE u.organization_id = ? AND u.role IN ('phone_sales', 'salesperson') AND u.active = 1${byGroup}
                  ORDER BY u.display_name`)
      .all(...params) as unknown as FlowContext["reps"];
  }
  const f = crmFilter(session, "c");
  const recentCustomers = db
    .prepare(`SELECT c.id, c.business_name AS name FROM customers c
               WHERE c.merged_into_id IS NULL${f.sql} AND ${LAST_ORDER} IS NOT NULL
               ORDER BY ${LAST_ORDER} DESC LIMIT 6`)
    .all(...(f.params as never[])) as unknown as FlowContext["recentCustomers"];
  return {
    entry: "add_lead", firstContact: true, attemptNo: 1, maxMisses: 5, isManager: manager,
    vars: {}, knownContacts: [], products: [], reps, recentCustomers,
  };
}
