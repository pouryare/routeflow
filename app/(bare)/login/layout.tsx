import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { homePathFor } from "@/lib/roles";

/** Someone who is already signed in has no use for the sign-in form: send them to their home.
 *
 *  Decided on the DATABASE-checked session (`getSessionFromCookies`), not on a cookie that merely
 *  carries a valid signature. A signed cookie for a user who has since been deactivated, or whose
 *  token version moved on, must still see the form: redirecting on the signature alone would send
 *  them home, the home page would send them back here, and that is an endless loop. Every page
 *  that bounces to /login does so on the same `!session` test, so a session that passes here
 *  passes there. */
export default async function LoginLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (session) redirect(homePathFor(session.role));
  return <>{children}</>;
}
