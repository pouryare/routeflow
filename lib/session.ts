import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionToken } from "./auth";
import { getDb, type Role, type UserRow } from "./db";

export interface Session {
  user: UserRow;
  role: Role;
  /** null for an owner or platform_owner, who are not scoped to any one group. */
  groupId: number | null;
  /** The tenant. Every business read is narrowed to this, except for a platform_owner. */
  organizationId: number;
  /** The owner acting as this user (Login-As), or undefined for an ordinary session. */
  actorId?: number;
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

  /* An impersonation is only as valid as the owner behind it. A deactivated, demoted or
     cross-tenant actor ends it on the very next request, not when the cookie expires. */
  let actorId: number | undefined;
  if (claims.act !== undefined) {
    const actor = getDb()
      .prepare("SELECT id, role, organization_id, active FROM users WHERE id = ?")
      .get(claims.act) as { id: number; role: string; organization_id: number; active: number } | undefined;
    if (!actor || !actor.active || actor.role !== "owner" || actor.organization_id !== user.organization_id) return null;
    actorId = actor.id;
  }

  return { user, role: user.role, groupId: user.group_id, organizationId: user.organization_id, actorId };
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

/** "all" for a platform_owner; otherwise the groups this session may read.
 *
 *  An owner used to return "all", which was right when there was one company in the
 *  database. It is now the whole tenancy boundary: an owner gets **their organisation's**
 *  groups, so the eighteen groupFilter and twelve orderFilter call sites become
 *  tenant-safe without any of them changing -- with two exceptions, orderFilter's own
 *  owner branch and the "shared ungrouped row" helpers below, which bypass group
 *  matching entirely and so needed their own fix; see the comments on each.
 *
 *  An empty array means the caller can reach nothing -- an organisation with no groups
 *  yet, or a non-owner with none assigned. That is a real state, and it must read as
 *  "nothing", never as "everything".
 */
export function scopeGroupIds(session: Session): number[] | "all" {
  if (session.role === "platform_owner") return "all";

  if (session.role === "owner") {
    const rows = getDb()
      .prepare("SELECT id FROM groups WHERE organization_id = ?")
      .all(session.organizationId) as { id: number }[];
    return rows.map((r) => r.id);
  }

  return session.groupId === null ? [] : [session.groupId];
}

/** A SQL fragment to append to a WHERE clause, plus its parameters.
 *
 *  Returns " AND 1 = 0" rather than "" for a caller who can reach nothing, because an
 *  empty fragment would widen the query to everything -- the exact failure this helper
 *  exists to prevent.
 *
 *  For everyone but the owner, no organization_id check is needed: scopeGroupIds only
 *  ever returns group ids that already belong to this session's own organisation, so
 *  matching against group_id already guarantees the tenant boundary transitively.
 *
 *  The owner is its own case, and matching by group_id at all is the wrong shape for
 *  them. Before tenancy, owner meant no filter -- every row in the database, including
 *  ones with no group_id at all (a customer not yet territorised, a saved_location not
 *  yet assigned). Matching group_id IN (their org's groups) would silently exclude every
 *  one of those ungrouped rows, which is a real loss of visibility an owner is supposed
 *  to have over their own company, not a narrowing anyone asked for. So the owner branch
 *  filters by organisation only, admitting grouped and ungrouped rows alike -- the same
 *  breadth "all" used to give them, now bounded to their own organisation. */
export function groupFilter(session: Session, column = "group_id"): { sql: string; params: number[] } {
  const scope = scopeGroupIds(session);
  if (scope === "all") return { sql: "", params: [] };

  if (session.role === "owner") {
    const prefix = column.includes(".") ? column.slice(0, column.indexOf(".") + 1) : "";
    return { sql: ` AND ${prefix}organization_id = ?`, params: [session.organizationId] };
  }

  if (scope.length === 0) return { sql: " AND 1 = 0", params: [] };
  if (scope.length === 1) return { sql: ` AND ${column} = ?`, params: [scope[0]] };
  return { sql: ` AND ${column} IN (${scope.map(() => "?").join(", ")})`, params: [...scope] };
}

/** Like groupFilter, but also admits rows that belong to no group at all.
 *
 *  For tables where an ungrouped row means "shared by the whole company" rather than
 *  "not assigned yet". facilities is the case that forces it: the warehouse and the home
 *  origin are seeded with no group, and every group needs them to plan a route. A plain
 *  groupFilter would empty the depot list for every manager and leave the planner with
 *  nowhere to start from.
 *
 *  Unlike groupFilter, this one DOES need its own organisation guard: "no group" here
 *  means "shared within my own company", not "shared with every company in the
 *  database". Without the guard, an ungrouped row in another organisation would look
 *  identical to this organisation's own shared warehouse and leak straight through.
 *
 *  Read-only. Writes still go through canReachGroup, so a manager can see the shared
 *  warehouse but cannot rename or delete it. */
export function groupFilterWithShared(session: Session, column = "group_id"): { sql: string; params: number[] } {
  if (session.role === "platform_owner") return { sql: "", params: [] };

  // Reuses whatever table alias `column` carries (e.g. "f.group_id") so the organisation
  // guard lands on the same table, rather than assuming an unaliased query.
  const prefix = column.includes(".") ? column.slice(0, column.indexOf(".") + 1) : "";
  const orgColumn = `${prefix}organization_id`;

  const scope = scopeGroupIds(session) as number[]; // platform_owner already returned above
  if (scope.length === 0) {
    return { sql: ` AND ${orgColumn} = ? AND ${column} IS NULL`, params: [session.organizationId] };
  }
  if (scope.length === 1) {
    return {
      sql: ` AND ${orgColumn} = ? AND (${column} IS NULL OR ${column} = ?)`,
      params: [session.organizationId, scope[0]],
    };
  }
  return {
    sql: ` AND ${orgColumn} = ? AND (${column} IS NULL OR ${column} IN (${scope.map(() => "?").join(", ")}))`,
    params: [session.organizationId, ...scope],
  };
}

/** Join + filter for the tables that carry no group of their own and reach one through
 *  their (entity_type, entity_id) pair -- photos, reminders, visit_plans, activity_log
 *  (spec §2.3 / Task 8, option 2).
 *
 *  Joining rather than denormalising means a district changing hands takes its reminders
 *  and photos with it, with no second copy of the truth to keep in step.
 *
 *  A facility with no group is company-wide (the seeded warehouse), so rows attached to
 *  one stay visible to every group in the same organisation -- otherwise a manager could
 *  not see the depot arrivals their own day is measured by. A *customer* or *district*
 *  with no group is a different thing entirely: not shared, just not territorised yet,
 *  and it stays hidden.
 *
 *  The organisation guard applies before any of that: customers, districts and
 *  facilities each carry their own organization_id now, and a row belonging to another
 *  organisation is never "shared" with this one no matter what its group_id says.
 */
export function entityGroupFilter(
  session: Session,
  alias: string
): { joins: string; sql: string; params: number[] } {
  const joins = `
     LEFT JOIN customers _ec ON ${alias}.entity_type = 'customer' AND _ec.id = ${alias}.entity_id
     LEFT JOIN districts _ed ON ${alias}.entity_type = 'district' AND _ed.id = ${alias}.entity_id
     LEFT JOIN facilities _ef ON ${alias}.entity_type = 'facility' AND _ef.id = ${alias}.entity_id`;

  if (session.role === "platform_owner") return { joins, sql: "", params: [] };

  const orgGuard = `COALESCE(_ec.organization_id, _ed.organization_id, _ef.organization_id) = ?`;

  if (session.role === "owner") {
    // Same reasoning as groupFilter's owner branch: before tenancy, owner saw every
    // entity regardless of group, including customers and districts nobody had
    // territorised yet. Organisation is the only boundary that applies to them here.
    return { joins, sql: ` AND ${orgGuard}`, params: [session.organizationId] };
  }

  const shared = `(${alias}.entity_type = 'facility' AND _ef.group_id IS NULL)`;
  const scope = scopeGroupIds(session) as number[]; // platform_owner and owner both returned above
  if (scope.length === 0) {
    return { joins, sql: ` AND ${orgGuard} AND ${shared}`, params: [session.organizationId] };
  }
  if (scope.length === 1) {
    return {
      joins,
      sql: ` AND ${orgGuard} AND (COALESCE(_ec.group_id, _ed.group_id, _ef.group_id) = ? OR ${shared})`,
      params: [session.organizationId, scope[0]],
    };
  }
  return {
    joins,
    sql: ` AND ${orgGuard} AND (COALESCE(_ec.group_id, _ed.group_id, _ef.group_id) IN (${scope
      .map(() => "?")
      .join(", ")}) OR ${shared})`,
    params: [session.organizationId, ...scope],
  };
}

/** Who may see which orders.
 *
 *  groupFilter cannot express this, and that is why it exists separately. Orders have
 *  four different scoping rules rather than one, because "smaller than the group" is a
 *  real requirement here:
 *
 *    platform_owner  every order, every organisation
 *    owner           every order in their own organisation
 *    group_manager   their group's -- they aggregate the cold-call orders
 *    salesperson     only the ones they recorded, which is narrower than their group
 *    driver          only the ones on today's run
 *
 *  The owner, salesperson and driver branches each name organization_id explicitly
 *  rather than delegating to groupFilter/scopeGroupIds, so each needs its own guard --
 *  none of them narrow by group_id, which is the one thing that makes group-based
 *  filtering transitively tenant-safe. Owner reads by organisation directly rather than
 *  "every group in scopeGroupIds", because an order can in principle carry a null
 *  group_id while still very much belonging to one organisation. Salesperson and driver
 *  get the organisation guard as defence in depth: their own identity already narrows
 *  the result to what they created or were assigned, but that narrowing depends on every
 *  write path stamping organization_id correctly, which is not yet guaranteed everywhere
 *  -- see docs/superpowers/plans/2026-09-01-phase-0a-tenancy-foundation.md Task 3's
 *  commit for the concrete case this guards against.
 */
export function orderFilter(session: Session, alias = "o"): { sql: string; params: number[] } {
  if (session.role === "platform_owner") return { sql: "", params: [] };

  if (session.role === "owner") {
    return { sql: ` AND ${alias}.organization_id = ?`, params: [session.organizationId] };
  }

  if (session.role === "salesperson") {
    return {
      sql: ` AND ${alias}.salesperson_user_id = ? AND ${alias}.organization_id = ?`,
      params: [session.user.id, session.organizationId],
    };
  }

  if (session.role === "driver") {
    // The orders on runs assigned to this driver, and nothing else. Scoped by run
    // rather than by date: a driver needs yesterday's run to reprint a receipt or fix
    // what they typed at the door, and a date clause would cut that off at midnight in
    // the middle of a shift. The set is a few dozen orders either way.
    return {
      sql: ` AND ${alias}.organization_id = ? AND ${alias}.id IN (
              SELECT ds.order_id FROM delivery_stops ds
                JOIN delivery_runs dr ON dr.id = ds.run_id
               WHERE dr.driver_user_id = ?)`,
      params: [session.organizationId, session.user.id],
    };
  }

  // group_manager. Same reasoning as groupFilter: never an empty fragment, because an
  // empty fragment widens the query to everything rather than narrowing it to nothing.
  // No separate organisation guard needed -- group_id already belongs to exactly one
  // organisation, the same transitive safety groupFilter relies on.
  if (session.groupId === null) return { sql: " AND 1 = 0", params: [] };
  return { sql: ` AND ${alias}.group_id = ?`, params: [session.groupId] };
}

/** Whether this session may write a row hanging off the given entity. Same rule as the
 *  filter above: the parent's organisation and group decide, and an ungrouped facility
 *  is shared -- but only within that same organisation. */
export function canReachEntity(
  session: Session,
  db: ReturnType<typeof getDb>,
  entityType: string,
  entityId: number
): boolean {
  if (session.role === "platform_owner") return true;

  const table = entityType === "customer" ? "customers" : entityType === "district" ? "districts" : entityType === "facility" ? "facilities" : null;
  if (!table) return false;

  const row = db.prepare(`SELECT group_id, organization_id FROM ${table} WHERE id = ?`).get(entityId) as
    | { group_id: number | null; organization_id: number }
    | undefined;
  if (!row) return false;
  if (row.organization_id !== session.organizationId) return false;
  if (entityType === "facility" && row.group_id === null) return true;
  return canReachGroup(session, row.group_id);
}

/** Whether this session may touch a row belonging to the given group. Use before any
 *  write that names a group_id, so a manager cannot post into someone else's territory.
 *
 *  No separate organisation check needed for a *named* group: scopeGroupIds already
 *  only returns group ids from this session's own organisation (or "all" for a
 *  platform_owner), so a groupId found in that scope can never belong to another tenant.
 *
 *  A null groupId -- an ungrouped, shared row like the company-wide warehouse -- is its
 *  own case. Before tenancy, an owner reached it as a side effect of scopeGroupIds
 *  returning "all"; that shortcut is gone now that "all" means platform_owner alone, so
 *  it is spelled out here instead: the owner administers the whole organisation and must
 *  still be able to manage its shared resources, while a group_manager explicitly
 *  should not -- see the comment on the facilities write routes, which can show a
 *  manager the shared depot but must not let them rename or move it. */
export function canReachGroup(session: Session, groupId: number | null): boolean {
  const scope = scopeGroupIds(session);
  if (scope === "all") return true;
  if (groupId === null) return session.role === "owner";
  return scope.includes(groupId);
}

/** Whether this session may look at another user's own data (the Pocket scoping a
 *  manager does over a report). Yourself always; otherwise only a management role —
 *  owner / platform_owner over anyone in their org, a group / rep manager over a user
 *  whose group is in their scope. A salesperson or driver reaches only themselves. */
export function canReachUser(session: Session, userId: number): boolean {
  if (userId === session.user.id) return true;
  if (session.role === "salesperson" || session.role === "driver") return false;
  const u = getDb()
    .prepare("SELECT group_id, organization_id FROM users WHERE id = ?")
    .get(userId) as { group_id: number | null; organization_id: number } | undefined;
  if (!u) return false;
  if (!canReachOrg(session, u.organization_id)) return false;
  if (session.role === "owner" || session.role === "platform_owner") return true;
  return canReachGroup(session, u.group_id);
}

/** A SQL fragment narrowing a table that carries its own organization_id but no group of
 *  its own -- products, prices, purchases, commission rates -- which an owner reads
 *  unscoped today precisely because there was only ever one company. Same contract as
 *  groupFilter: never an empty fragment except for a platform_owner, because an empty
 *  fragment widens rather than narrows. */
export function orgFilter(
  session: Session,
  column = "organization_id"
): { sql: string; params: number[] } {
  if (session.role === "platform_owner") return { sql: "", params: [] };
  return { sql: ` AND ${column} = ?`, params: [session.organizationId] };
}

/** Whether this session may touch a row belonging to the given organisation. Use before
 *  any write that names an organization_id. */
export function canReachOrg(session: Session, organizationId: number | null): boolean {
  if (session.role === "platform_owner") return true;
  if (organizationId === null) return false;
  return organizationId === session.organizationId;
}
