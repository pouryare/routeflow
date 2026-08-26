import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionToken } from "./auth";
import { getDb, type Role, type UserRow } from "./db";

export interface Session {
  user: UserRow;
  role: Role;
  /** null only for an owner, who is not scoped to any one group. */
  groupId: number | null;
}

export type Guard = { ok: true; session: Session } | { ok: false; response: NextResponse };

/** The authoritative "who is this" for API routes.
 *
 *  Deliberately re-reads the user row rather than trusting the role and group baked into
 *  the token. A token lives 30 days; without this lookup, demoting a manager or
 *  deactivating a driver would not take effect until it expired. token_version is the
 *  revocation lever -- bumping that column invalidates every token already issued to the
 *  user, which is what makes a password reset or a deactivation immediate.
 *
 *  SQLite is local and this is a primary-key lookup, so the cost is microseconds. That is
 *  also why this cannot live in proxy.ts: middleware has no safe route to the database.
 */
export function getSession(req: NextRequest): Session | null {
  return getSessionFromCookies(req.cookies.get(COOKIE_NAME)?.value);
}

/** The same resolution, entered from a raw cookie value rather than a NextRequest.
 *
 *  Server components have no NextRequest -- they reach the cookie through next/headers --
 *  so both entry points delegate here. One implementation means a page and its API route
 *  can never disagree about who the caller is. */
export function getSessionFromCookies(token: string | undefined | null): Session | null {
  const claims = parseSessionToken(token);
  if (!claims) return null;

  const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(claims.uid) as UserRow | undefined;
  if (!user) return null;
  if (!user.active) return null;
  if (user.token_version !== claims.tv) return null;

  return { user, role: user.role, groupId: user.group_id };
}

export function requireRole(req: NextRequest, roles: Role[]): Guard {
  const session = getSession(req);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 }),
    };
  }
  if (!roles.includes(session.role)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "دسترسی لازم را ندارید" }, { status: 403 }),
    };
  }
  return { ok: true, session };
}

/** "all" for an owner; otherwise the one group they belong to. An empty array means the
 *  caller can reach nothing -- a non-owner with no group assigned yet. That is a real
 *  state (an account created before its group was), and it must read as "nothing",
 *  never as "everything". */
export function scopeGroupIds(session: Session): number[] | "all" {
  if (session.role === "owner") return "all";
  return session.groupId === null ? [] : [session.groupId];
}

/** A SQL fragment to append to a WHERE clause, plus its parameters.
 *
 *  Returns " AND 1 = 0" rather than "" for a caller who can reach nothing, because an
 *  empty fragment would widen the query to everything -- the exact failure this helper
 *  exists to prevent. */
export function groupFilter(session: Session, column = "group_id"): { sql: string; params: number[] } {
  const scope = scopeGroupIds(session);
  if (scope === "all") return { sql: "", params: [] };
  if (scope.length === 0) return { sql: " AND 1 = 0", params: [] };
  return { sql: ` AND ${column} = ?`, params: [scope[0]] };
}

/** Like groupFilter, but also admits rows that belong to no group at all.
 *
 *  For tables where an ungrouped row means "shared by the whole company" rather than
 *  "not assigned yet". facilities is the case that forces it: the warehouse and the home
 *  origin are seeded with no group, and every group needs them to plan a route. A plain
 *  groupFilter would empty the depot list for every manager and leave the planner with
 *  nowhere to start from.
 *
 *  Read-only. Writes still go through canReachGroup, so a manager can see the shared
 *  warehouse but cannot rename or delete it. */
export function groupFilterWithShared(session: Session, column = "group_id"): { sql: string; params: number[] } {
  const scope = scopeGroupIds(session);
  if (scope === "all") return { sql: "", params: [] };
  if (scope.length === 0) return { sql: ` AND ${column} IS NULL`, params: [] };
  return { sql: ` AND (${column} IS NULL OR ${column} = ?)`, params: [scope[0]] };
}

/** Join + filter for the tables that carry no group of their own and reach one through
 *  their (entity_type, entity_id) pair -- photos, reminders, visit_plans, activity_log
 *  (spec §2.3 / Task 8, option 2).
 *
 *  Joining rather than denormalising means a district changing hands takes its reminders
 *  and photos with it, with no second copy of the truth to keep in step.
 *
 *  A facility with no group is company-wide (the seeded warehouse), so rows attached to
 *  one stay visible to every group -- otherwise a manager could not see the depot
 *  arrivals their own day is measured by. A *customer* or *district* with no group is a
 *  different thing entirely: not shared, just not territorised yet, and it stays hidden.
 */
export function entityGroupFilter(
  session: Session,
  alias: string
): { joins: string; sql: string; params: number[] } {
  const joins = `
     LEFT JOIN customers _ec ON ${alias}.entity_type = 'customer' AND _ec.id = ${alias}.entity_id
     LEFT JOIN districts _ed ON ${alias}.entity_type = 'district' AND _ed.id = ${alias}.entity_id
     LEFT JOIN facilities _ef ON ${alias}.entity_type = 'facility' AND _ef.id = ${alias}.entity_id`;
  const shared = `(${alias}.entity_type = 'facility' AND _ef.group_id IS NULL)`;

  const scope = scopeGroupIds(session);
  if (scope === "all") return { joins, sql: "", params: [] };
  if (scope.length === 0) return { joins, sql: ` AND ${shared}`, params: [] };
  return {
    joins,
    sql: ` AND (COALESCE(_ec.group_id, _ed.group_id, _ef.group_id) = ? OR ${shared})`,
    params: [scope[0]],
  };
}

/** Who may see which orders.
 *
 *  groupFilter cannot express this, and that is why it exists separately. Orders have
 *  three different scoping rules rather than one, because "smaller than the group" is a
 *  real requirement here for the first time:
 *
 *    owner          every order
 *    group_manager  their group's -- they aggregate the cold-call orders
 *    salesperson    only the ones they recorded, which is narrower than their group
 *    driver         only the ones on today's run
 *
 *  The salesperson rule is deliberately not also group-scoped. Their own orders are
 *  their own wherever the customer sits, and adding a group clause could hide an order
 *  from the person who took it if the customer's territory were later reassigned.
 *
 *  The driver rule is closed rather than open until delivery runs exist. An unfinished
 *  rule that defaults to visible is how a driver ends up reading the whole ledger.
 */
export function orderFilter(session: Session, alias = "o"): { sql: string; params: number[] } {
  if (session.role === "owner") return { sql: "", params: [] };

  if (session.role === "salesperson") {
    return { sql: ` AND ${alias}.salesperson_user_id = ?`, params: [session.user.id] };
  }

  if (session.role === "driver") {
    // The orders on runs assigned to this driver, and nothing else. Scoped by run
    // rather than by date: a driver needs yesterday's run to reprint a receipt or fix
    // what they typed at the door, and a date clause would cut that off at midnight in
    // the middle of a shift. The set is a few dozen orders either way.
    return {
      sql: ` AND ${alias}.id IN (
              SELECT ds.order_id FROM delivery_stops ds
                JOIN delivery_runs dr ON dr.id = ds.run_id
               WHERE dr.driver_user_id = ?)`,
      params: [session.user.id],
    };
  }

  // group_manager. Same reasoning as groupFilter: never an empty fragment, because an
  // empty fragment widens the query to everything rather than narrowing it to nothing.
  if (session.groupId === null) return { sql: " AND 1 = 0", params: [] };
  return { sql: ` AND ${alias}.group_id = ?`, params: [session.groupId] };
}

/** Whether this session may write a row hanging off the given entity. Same rule as the
 *  filter above: the parent's group decides, and an ungrouped facility is shared. */
export function canReachEntity(
  session: Session,
  db: ReturnType<typeof getDb>,
  entityType: string,
  entityId: number
): boolean {
  if (session.role === "owner") return true;

  const table = entityType === "customer" ? "customers" : entityType === "district" ? "districts" : entityType === "facility" ? "facilities" : null;
  if (!table) return false;

  const row = db.prepare(`SELECT group_id FROM ${table} WHERE id = ?`).get(entityId) as
    | { group_id: number | null }
    | undefined;
  if (!row) return false;
  if (entityType === "facility" && row.group_id === null) return true;
  return canReachGroup(session, row.group_id);
}

/** Whether this session may touch a row belonging to the given group. Use before any
 *  write that names a group_id, so a manager cannot post into someone else's territory. */
export function canReachGroup(session: Session, groupId: number | null): boolean {
  const scope = scopeGroupIds(session);
  if (scope === "all") return true;
  if (groupId === null) return false;
  return scope.includes(groupId);
}
