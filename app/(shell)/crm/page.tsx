import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { plain } from "@/lib/db";
import PageHeader from "@/components/meridian/PageHeader";
import CrmBoard from "@/components/crm/CrmBoard";
import { listBusinesses, viewCounts } from "@/lib/repo/crm/businesses";
import { pageMetaFor } from "@/lib/pageMeta";
import type { Metadata } from "next";
import { isVanRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageMetaFor("/crm").title,
  description: pageMetaFor("/crm").overview,
};

/** «مشتریان و سرنخ‌ها» -- the field CRM. Opens on today's follow-ups; falls back to "my
 *  leads" when there are none, so the first screen is never empty for a rep with work. */
export default async function CrmPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");
  const counts = viewCounts(session);
  const view = counts.today > 0 ? "today" : session.role === "phone_sales" ? "my_leads" : "all";
  const { rows } = listBusinesses(session, { view });
  return (
    <>
      <PageHeader route="/crm" />
      {/* node:sqlite rows have a null prototype, which a client component cannot receive. */}
      <CrmBoard initialRows={plain(rows)} initialCounts={counts} initialView={view} />
    </>
  );
}
