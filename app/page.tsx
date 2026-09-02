import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";

/** The app's front door.
 *
 *  Phase 7: the briefing is the landing page after login -- it is where the day's
 *  actionable items live, role-branched. A driver goes to /driver, a platform_owner to
 *  /platform, everyone else to /sales/today (the briefing as a sales tab); a logged-out
 *  visitor to /login. The bare /today route still serves the driver's briefing.
 */
export default async function Home() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");
  if (session.role === "platform_owner") redirect("/platform");
  redirect("/sales/today");
}
