import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { hasSyncClient } from "@/lib/roles";
import SyncStatus from "@/components/SyncStatus";

/** Mounts the offline sync client, but only for a role that actually has one.
 *
 * `<SyncStatus />` used to be mounted unconditionally by AppShell. Mounting it is not a
 * passive thing to render: its effect calls `getSyncEngine().start()`, whose first act is a
 * `GET /api/sync/pull` — and the route has always answered a `platform_owner` with a 403,
 * because the vendor is not a device that goes offline. So the founder's browser asked on
 * every page, every 30 s, and was told no every time. `GET /api/sync/pull?since=now 403`
 * was the server being right and the client being unable to know it.
 *
 * Rendering nothing is the whole fix, and it is the cheapest available one: no request, no
 * 403 in the console, and no outbox store opened for an account that will never drain one.
 *
 * A separate component rather than an `if` inside AppShell, because of the rule that file
 * exists to obey: the shell layout is SYNCHRONOUS and must not await cookies(), or every
 * navigation blocks on it and each loading.tsx silently becomes dead code
 * (tests/shellLayout.test.ts). AppShell stays sync and renders this behind its own
 * <Suspense>; the session read happens here instead, exactly as AppHeader does.
 *
 * Reads the session rather than the cookie's role claim on purpose. `getSessionFromCookies`
 * is the one implementation a page and its API route both go through, so this gate and
 * `/api/sync/pull` cannot disagree about who the caller is — including after a demotion
 * that landed while the cookie was still valid, which is exactly when a stale claim matters.
 *
 * No session renders nothing, matching proxy.ts: an unauthenticated request never reaches
 * this shell anyway, and there is no one to sync for. */
export default async function SyncIsland() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session || !hasSyncClient(session.role)) return null;
  return <SyncStatus />;
}