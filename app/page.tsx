import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";

/** The app's front door.
 *
 *  Phase 7: the briefing at /today is the landing page after login -- it is where the
 *  day's actionable items live, role-branched. A driver goes to /driver, a
 *  platform_owner to /platform, everyone else to /today; a logged-out visitor to
 *  /login. A redirect rather than a copy: /today owns its own chrome and guard.
 */
export default async function Home() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");
  if (session.role === "platform_owner") redirect("/platform");
  redirect("/today");
}
