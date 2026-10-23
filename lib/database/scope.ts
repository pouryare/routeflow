/* Which company a statement runs for, as PostgreSQL's row-level security sees it (Wave P,
 * phase 3; db/migrations/1761500000000_row-level-security.sql).
 *
 * Every table with organization_id has a policy that lets a row through only when it belongs to
 * the company the statement runs for. The pg adapter tells the database by setting `rf.scope`
 * before each statement (or once per transaction):
 *
 *   "org:<id>"  a request signed in to that company: its rows, and the shared rows (NULL org);
 *   "all"       a platform owner looking across every company;
 *   "system"    work no person asked for, which is every company's: sweeps, scripts, the
 *               sign-in lookup itself, and test fixtures;
 *   ""          a request with no session: no company's rows at all.
 *
 * Inside a request the scope comes from the signed-in session (lib/session.ts registers the
 * resolver), so no route has to remember it, and a request that reaches a tenant table without
 * a session gets nothing rather than everything. Outside a request there is no session to ask;
 * that code is a job, and runs as "system". withDbScope() overrides either.
 *
 * SQLite has no row-level security and ignores all of this. */
import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";

export type DbScope = `org:${number}` | "all" | "system" | "";

const explicit = new AsyncLocalStorage<DbScope>();

/** Maps a request's session cookie (undefined when it has none) to the scope it reads under. */
type Resolver = (sessionCookie: string | undefined) => Promise<DbScope>;
let resolver: Resolver | null = null;
let cookieName = "";

/** Runs `fn` with every statement in it scoped to `scope`, whatever the request says. */
export function withDbScope<T>(scope: DbScope, fn: () => Promise<T>): Promise<T> {
  return explicit.run(scope, fn);
}

/** lib/session.ts registers how a request's session cookie becomes a scope. */
export function setRequestScopeResolver(name: string, fn: Resolver): void {
  cookieName = name;
  resolver = fn;
}

/** The scope for the statement about to run. */
export async function currentDbScope(): Promise<DbScope> {
  const set = explicit.getStore();
  if (set !== undefined) return set;
  let jar: Awaited<ReturnType<typeof cookies>>;
  try {
    jar = await cookies();
  } catch {
    return "system"; // not inside a request: a job
  }
  /* Inside a request with nothing registered to read the session is a request nobody can vouch
     for, so it gets no company rather than every company. */
  return resolver ? await resolver(jar.get(cookieName)?.value) : "";
}

/** The scope a signed-in session reads under. */
export function scopeForCompany(organizationId: number | null): DbScope {
  return organizationId == null ? "all" : `org:${organizationId}`;
}
