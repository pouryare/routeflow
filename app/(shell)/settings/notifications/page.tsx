import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getPrefsMatrix, renderNotification } from "@/lib/repo/notifications";
import { templatesOf } from "@/lib/repo/notificationTemplates";
import { TEMPLATE_PLACEHOLDERS } from "@/lib/messageTemplate";
import NotificationTemplates from "@/components/settings/NotificationTemplates";
import { isOwner } from "@/lib/roles";
import NotificationSettings from "@/components/settings/NotificationSettings";
import PageHeader from "@/components/meridian/PageHeader";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/settings/notifications");

export const dynamic = "force-dynamic";

/** Same six roles as GET /api/notifications and the prefs route — everyone who can receive
 *  a notification can govern it. Kept as a literal here rather than imported so the page
 *  and its API can never disagree silently about who is allowed in. */
const ROLES = ["platform_owner", "owner", "group_manager", "rep_manager", "phone_sales", "driver"];

export default async function NotificationSettingsPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!ROLES.includes(session.role)) redirect("/");

  // Rendered server-side so the switches arrive already in their real positions — no
  // flash of every row reading "off" while a client fetch lands. The org id comes from
  // the signed session, never the request.
  const initial = await getPrefsMatrix(session.user.id, session.organizationId);

  // F136: the owner can also word each notification their own way.
  const mine = isOwner(session.role) ? new Map((await templatesOf(session.organizationId)).map((t) => [t.type_code, t])) : null;
  const names = new Map(initial.types.map((t) => [t.code, t.name_fa]));
  const rows = mine
    ? Object.keys(TEMPLATE_PLACEHOLDERS).map((code) => {
        const shipped = renderNotification(code, { kind: code, entity_type: null, entity_id: null, occurred_at: "", meta: {} } as never);
        const c = mine.get(code);
        return { code, name: names.get(code) ?? code, shipped: { title: shipped.title_fa, body: shipped.body_fa }, custom: c ? { title: c.title_fa, body: c.body_fa } : null };
      })
    : [];

  return (
    <>
      <PageHeader route="/settings/notifications" />
      <NotificationSettings initial={initial} />
      {rows.length > 0 ? <NotificationTemplates rows={rows} /> : null}
    </>
  );
}
