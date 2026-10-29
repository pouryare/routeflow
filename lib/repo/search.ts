import type { Db } from "@/lib/database/client";
import { readCustomers } from "@/lib/customers";
import { crmFilter, orderFilter, scopeGroupIds, type Session } from "@/lib/session";
import { escapeLike, matchesQuery, normalisePersian } from "@/lib/persian";
import { faDigits } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { buildMapLink } from "@/lib/deepLink";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orderStateMachine";
import { MIN_REMOTE_QUERY, type SearchHit } from "@/lib/searchModel";
import { ROLE_LABEL, isOwner } from "@/lib/roles";

/** The server half of the search overlay (components/meridian/SearchOverlay.tsx).
 *
 *  A search is a new read path, so it is a new place to leak rows. It invents no scoping
 *  of its own. Customers follow /api/customers (owner + group_manager, scopeGroupIds),
 *  orders follow /api/sales/orders (orderFilter). If search offered a salesperson a
 *  customer list, it would be a side door to a page they cannot open.
 *
 *  Matching is matchesQuery, not SQL LIKE: LIKE does not fold ي/ی, ك/ک or Persian digits,
 *  and people type all three. */

const CUSTOMER_ROLES: readonly string[] = ["platform_owner", "owner", "group_manager"];
const ORDER_ROLES: readonly string[] = ["platform_owner", "owner", "group_manager", "phone_sales"];
const DEFAULT_LIMIT = 6;
/** Newest orders considered before matching. Search is for "that order from last week",
 *  not for archaeology; the orders page has filters for that. */
const ORDER_WINDOW = 2000;

const tooShort = (q: string) => normalisePersian(q.trim()).length < MIN_REMOTE_QUERY;

export async function searchCustomers(db: Db, session: Session, q: string, limit = DEFAULT_LIMIT): Promise<SearchHit[]> {
  if (!CUSTOMER_ROLES.includes(session.role) || tooShort(q)) return [];
  return (await readCustomers(db, await scopeGroupIds(session)))
    .filter((c) =>
      matchesQuery([c.business_name, c.customer_code, c.contact_person ?? "", c.phone ?? ""].join(" "), q),
    )
    .slice(0, limit)
    .map((c) => ({
      kind: "customer",
      id: `customer:${c.id}`,
      label: c.business_name,
      sub: c.customer_code ? faDigits(c.customer_code) : undefined,
      href: `/map${buildMapLink({ customerId: c.id })}`,
    }));
}

export async function searchOrders(db: Db, session: Session, q: string, limit = DEFAULT_LIMIT): Promise<SearchHit[]> {
  if (!ORDER_ROLES.includes(session.role) || tooShort(q)) return [];
  const scope = orderFilter(session);
  const rows = await db
    .prepare(
      `SELECT o.id, o.order_no, o.status, c.business_name AS customer_name
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
        WHERE 1 = 1${scope.sql}
        ORDER BY o.id DESC
        LIMIT ?`,
    )
    .all(...scope.params, ORDER_WINDOW) as unknown as {
    id: number;
    order_no: string;
    status: OrderStatus;
    customer_name: string;
  }[];
  return rows
    .filter((r) => matchesQuery(`${r.order_no} ${r.customer_name}`, q))
    .slice(0, limit)
    .map((r) => ({
      kind: "order",
      id: `order:${r.id}`,
      label: `سفارش ${faDigits(r.order_no)}`,
      sub: `${r.customer_name} · ${ORDER_STATUS_LABEL[r.status] ?? "نامشخص"}`,
      href: `/sales/orders/${r.id}`,
    }));
}

/** Notes newest first considered before matching (F98). Matching folds Persian letters in JS, so
 *  the window keeps a keystroke cheap; the CRM timeline holds the rest. */
const NOTE_WINDOW = 3000;
/** A phrase, not a letter pair: two letters match half of every note. */
const MIN_NOTE_QUERY = 3;
const SNIPPET = 60;

/** F98: call and visit notes that contain the phrase, one hit per note, for customers the person
 *  can already open in the CRM (crmFilter: owner over the company, a manager over their group,
 *  a phone rep over their own and their group's unowned ones). Each hit names the customer, the
 *  day and a snippet around the match, and opens the customer's page. */
export async function searchNotes(db: Db, session: Session, q: string, limit = DEFAULT_LIMIT): Promise<SearchHit[]> {
  if (normalisePersian(q.trim()).length < MIN_NOTE_QUERY) return [];
  const scope = crmFilter(session, "c");
  const rows = await db
    .prepare(
      `SELECT a.id, a.customer_id, a.note, a.occurred_at, c.business_name
         FROM activities a
         JOIN customers c ON c.id = a.customer_id
        WHERE a.note IS NOT NULL AND a.note <> '' AND c.merged_into_id IS NULL${scope.sql}
        ORDER BY a.occurred_at DESC, a.id DESC
        LIMIT ?`,
    )
    .all(...scope.params, NOTE_WINDOW) as unknown as {
    id: number; customer_id: number; note: string; occurred_at: string; business_name: string;
  }[];
  return rows
    .filter((r) => matchesQuery(r.note, q))
    .slice(0, limit)
    .map((r) => ({
      kind: "note",
      id: `note:${r.id}`,
      label: r.business_name,
      sub: `${faJalaliDate(r.occurred_at.slice(0, 10))} · ${noteSnippet(r.note, q)}`,
      href: `/crm/${r.customer_id}`,
    }));
}

/** About SNIPPET characters of the note around the first match, with … where it was cut. The
 *  position is found on the folded text, which drops half-spaces, so it can sit a few characters
 *  early; the window is wide enough that the match stays inside it. */
function noteSnippet(note: string, q: string, width = SNIPPET): string {
  const flat = note.replace(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;
  const at = Math.max(0, normalisePersian(flat).indexOf(normalisePersian(q.trim())));
  const start = Math.max(0, Math.min(at - Math.floor(width / 3), flat.length - width));
  const end = Math.min(flat.length, start + width);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** Login-As candidates for the overlay's «ورود به‌جای کاربر» section: owners only, their
 *  own organisation only, and never someone the Login-As route would refuse (another
 *  owner, a platform owner, a deactivated account, themselves). lib/impersonation.ts is
 *  the rule; this only avoids offering what it would turn down. */
export async function searchUsers(db: Db, session: Session, q: string, limit = DEFAULT_LIMIT): Promise<SearchHit[]> {
  if (!(isOwner(session.role)) || tooShort(q)) return [];
  const rows = await db
    .prepare(
      `SELECT id, display_name, username, role FROM users
        WHERE organization_id = ? AND active = 1 AND id <> ?
          AND role NOT IN ('owner', 'platform_owner')
        ORDER BY display_name`,
    )
    .all(session.organizationId, session.user.id) as unknown as { id: number; display_name: string; username: string; role: string }[];
  return rows
    .filter((u) => matchesQuery(`${u.display_name} ${u.username}`, q))
    .slice(0, limit)
    .map((u) => ({
      kind: "user",
      id: `user:${u.id}`,
      label: u.display_name,
      sub: (ROLE_LABEL as Record<string, string>)[u.role] ?? "کاربر",
      href: "/sales",
    }));
}

/** Districts, for the overlay. The code lookup is a PREFIX match, and that is the whole
 *  design.
 *
 *  Substring matching makes one keystroke useless: "1" would return منطقه 1 plus all 26 of
 *  1401-1426 -- 27 rows for a single character. Prefix narrows "14" to منطقه 14 and lets a
 *  longer query walk down into the محله beneath it. So the SQL narrows on the indexed code
 *  column and matchesQuery does what it does everywhere else in this file: folding ي/ی, ك/ک
 *  and digit sets, which LIKE does not. Ordered by LENGTH(code) so a two-digit منطقه
 *  outranks the four-digit محله under it -- asking for "14" wants the district, not its 26
 *  neighbourhoods.
 *
 *  No role gate, unlike searchCustomers. Districts is shared reference data and carries no
 *  tenant row, so there is nothing to scope and nothing to leak -- and a driver who has
 *  been sent to ۱۴۰۵ has to be able to look it up. */
export async function searchDistricts(db: Db, session: Session, q: string, limit = DEFAULT_LIMIT): Promise<SearchHit[]> {
  void session; // deliberately unscoped -- see above
  if (tooShort(q)) return [];
  const rows = await db
    .prepare(
      `SELECT id, name, code FROM districts
        WHERE code IS NOT NULL AND code LIKE ? ESCAPE '\\'
        ORDER BY LENGTH(code), code`,
    )
    .all(`${escapeLike(normalisePersian(q.trim()))}%`) as unknown as {
    id: number; name: string; code: string;
  }[];
  return rows
    .filter((r) => matchesQuery(`${r.name} ${r.code}`, q))
    .slice(0, limit)
    .map((r) => ({
      kind: "district",
      id: `district:${r.id}`,
      label: r.name,
      // faDigits because the stored code is ASCII ("1405") and every other number in this
      // overlay is shown in Persian. Stored ASCII keeps the prefix match and the
      // west-to-east sort stable; the display is a rendering concern only.
      sub: faDigits(r.code),
      href: `/map?district=${r.id}`,
    }));
}

/** LIKE treats % and _ as wildcards, so a query of "5%" would return every code ending in
 *  5 -- a search box producing nonsense rather than an error. */
