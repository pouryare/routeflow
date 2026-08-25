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
  const claims = parseSessionToken(req.cookies.get(COOKIE_NAME)?.value);
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

/** Whether this session may touch a row belonging to the given group. Use before any
 *  write that names a group_id, so a manager cannot post into someone else's territory. */
export function canReachGroup(session: Session, groupId: number | null): boolean {
  const scope = scopeGroupIds(session);
  if (scope === "all") return true;
  if (groupId === null) return false;
  return scope.includes(groupId);
}
