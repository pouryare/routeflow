import { createSessionToken, COOKIE_NAME } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** A cookie for a real user, so the smoke suite can reach the pages the defects are on.
 *
 *  Every /sales route is behind proxy.ts, and /login — the one page reachable without a
 *  session — has `overflow-hidden` on its root. That clips any child wide enough to
 *  overflow, so the geometry rules below cannot fire on it at all: the first version of
 *  this suite passed a 4000px-wide probe element without complaint. An unauthenticated
 *  harness is not a smaller harness, it is a harness that reports success over an empty
 *  set.
 *
 *  The token is minted in-process rather than by driving the login form: the form needs a
 *  password this suite has no business knowing, and createSessionToken is the same
 *  function the login route calls. SESSION_SECRET comes from .env.local via @next/env,
 *  loaded in vitest.smoke.mts, so the signature matches what the dev server verifies.
 */
export async function sessionCookie(): Promise<{ name: string; value: string }> {
  const db = getDb();
  /* The highest-privilege active user, because a فروشنده is shown fewer panels and would
     leave most of the layout untested. Read-only: this suite never writes. */
  const user = await db
    .prepare(
      `SELECT id, role, group_id, organization_id, token_version, display_name AS name
         FROM users
        WHERE active = 1
        ORDER BY CASE role WHEN 'platform_owner' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END, id
        LIMIT 1`,
    )
    .get() as
    | {
        id: number;
        role: string;
        group_id: number | null;
        organization_id: number;
        token_version: number;
        name: string;
      }
    | undefined;

  if (!user) throw new Error("no active user in the database — cannot mint a smoke session");

  const token = createSessionToken({
    uid: user.id,
    role: user.role as Parameters<typeof createSessionToken>[0]["role"],
    gid: user.group_id,
    oid: user.organization_id,
    tv: user.token_version,
    name: user.name,
  });

  /* name and value only: playwright rejects a cookie carrying both `url` and
     `domain`/`path`, and the caller supplies the url. */
  return { name: COOKIE_NAME, value: token };
}
