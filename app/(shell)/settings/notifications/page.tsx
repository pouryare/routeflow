import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getPrefsMatrix } from "@/lib/repo/notifications";
import NotificationSettings from "@/components/settings/NotificationSettings";

export const dynamic = "force-dynamic";

/** Same six roles as GET /api/notifications and the prefs route — everyone who can receive
 *  a notification can govern it. Kept as a literal here rather than imported so the page
 *  and its API can never disagree silently about who is allowed in. */
const ROLES = ["platform_owner", "owner", "group_manager", "rep_manager", "salesperson", "driver"];

export default async function NotificationSettingsPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!ROLES.includes(session.role)) redirect("/");

  // Rendered server-side so the switches arrive already in their real positions — no
  // flash of every row reading "off" while a client fetch lands. The org id comes from
  // the signed session, never the request.
  const initial = getPrefsMatrix(session.user.id, session.organizationId);

  return <NotificationSettings initial={initial} />;
}
