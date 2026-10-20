import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";

import { isOwner } from "@/lib/roles";
export const dynamic = "force-dynamic";

/** Administration, folded into the same app rather than a second one behind it.
 *
 *  These pages used to sit under /admin with their own top bar, brand mark and tab row --
 *  so opening "مدیریت" felt like leaving the app rather than reaching a part of it. They
 *  now inherit the shell's chrome from app/(shell)/layout.tsx, and this layout does
 *  nothing but the authorisation check.
 *
 *  **This layout is async on purpose, and must stay that way.** Everywhere else in the
 *  shell an `await cookies()` in a layout was removed, because it blocks navigation and
 *  disables loading.tsx. Here the cost is worth paying and the check is not optional:
 *
 *  - proxy.ts gates the /sales/admin prefix, but only on the token's own claims. It
 *    cannot see a demotion that happened after the token was issued -- middleware has no
 *    safe path to SQLite.
 *  - None of the pages under this layout re-check the role themselves (users/,
 *    groups/, representatives/ -- verified). requireRole() in lib/session.ts returns a
 *    NextResponse and serves the API routes, not these pages.
 *
 *  So this DB-backed check is the ONLY authorisation standing between a freshly demoted
 *  user and the user list. Do not make it synchronous to speed up navigation; three
 *  owner-only pages loading a beat slower is the correct trade. If you want both, move
 *  the check into each page and let this layout go.
 */
export default async function SalesAdminLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!isOwner(session.role)) redirect("/sales");

  return <>{children}</>;
}
