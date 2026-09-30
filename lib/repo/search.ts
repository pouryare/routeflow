import type { DatabaseSync } from "node:sqlite";
import { readCustomers } from "@/lib/customers";
import { orderFilter, scopeGroupIds, type Session } from "@/lib/session";
import { matchesQuery, normalisePersian } from "@/lib/persian";
import { faDigits } from "@/lib/format";
import { buildMapLink } from "@/lib/deepLink";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orderStateMachine";
import { MIN_REMOTE_QUERY, type SearchHit } from "@/lib/searchModel";
import { ROLE_LABEL } from "@/lib/roles";

/** The server half of the search overlay (components/meridian/SearchOverlay.tsx).
 *
 *  A search is a new read path, so it is a new place to leak rows. It invents no scoping
 *  of its own. Customers follow /api/customers (owner + group_manager, scopeGroupIds),
 *  orders follow /api/sales/orders (orderFilter). If search offered a salesperson a
 *  customer list, it would be a side door to a page they cannot open.
 *
 *  Matching is matchesQuery, not SQL LIKE: LIKE does not fold ي/ی, ك/ک or Persian digits,
 *  and people type all three. */

const CUSTOMER_ROLES: readonly string[] = ["owner", "group_manager"];
const ORDER_ROLES: readonly string[] = ["owner", "group_manager", "phone_sales"];
const DEFAULT_LIMIT = 6;
/** Newest orders considered before matching. Search is for "that order from last week",
 *  not for archaeology; the orders page has filters for that. */
const ORDER_WINDOW = 2000;

const tooShort = (q: string) => normalisePersian(q.trim()).length < MIN_REMOTE_QUERY;

export function searchCustomers(db: DatabaseSync, session: Session, q: string, limit = DEFAULT_LIMIT): SearchHit[] {
  if (!CUSTOMER_ROLES.includes(session.role) || tooShort(q)) return [];
  return readCustomers(db, scopeGroupIds(session))
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

export function searchOrders(db: DatabaseSync, session: Session, q: string, limit = DEFAULT_LIMIT): SearchHit[] {
  if (!ORDER_ROLES.includes(session.role) || tooShort(q)) return [];
  const scope = orderFilter(session);
  const rows = db
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

/** Login-As candidates for the overlay's «ورود به‌جای کاربر» section: owners only, their
 *  own organisation only, and never someone the Login-As route would refuse (another
 *  owner, a platform owner, a deactivated account, themselves). lib/impersonation.ts is
 *  the rule; this only avoids offering what it would turn down. */
export function searchUsers(db: DatabaseSync, session: Session, q: string, limit = DEFAULT_LIMIT): SearchHit[] {
  if (session.role !== "owner" || tooShort(q)) return [];
  const rows = db
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
export function searchDistricts(db: DatabaseSync, session: Session, q: string, limit = DEFAULT_LIMIT): SearchHit[] {
  void session; // deliberately unscoped -- see above
  if (tooShort(q)) return [];
  const rows = db
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
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
