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
