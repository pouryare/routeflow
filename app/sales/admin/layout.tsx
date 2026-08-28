import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Administration, folded into the same app rather than a second one behind it.
 *
 *  These two pages used to sit under /admin with their own top bar, their own brand
 *  mark, and their own tab row -- so opening "مدیریت" felt like leaving the app rather
 *  than reaching a part of it. They now inherit app/sales/layout.tsx's chrome directly,
 *  and this layout does nothing but the authorisation check that one used to do.
 *
 *  proxy.ts already refuses a non-owner before this renders (it gates on the
 *  /sales/admin prefix the same way it gated on /admin); the redirect here is the belt
 *  to its braces, because a coarse gate on a cookie's own claims is not an authorisation
 *  decision -- it cannot see a demotion that happened after the token was issued.
 */
export default async function SalesAdminLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/sales");

  return <>{children}</>;
}
