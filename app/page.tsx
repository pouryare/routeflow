import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { homePathFor } from "@/lib/roles";

/** The app's front door.
 *
 *  Phase 7: the briefing is the landing page after login -- it is where the day's
 *  actionable items live, role-branched. A driver goes to /driver, everyone else to
 *  /sales/today (the briefing as a sales tab); a logged-out visitor to /login. The bare
 *  /start route still serves the briefing and, for someone with several roles, the role picker.
 */
export default async function Home() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  redirect(homePathFor(session.role));
}
