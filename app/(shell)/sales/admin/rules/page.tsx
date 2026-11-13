import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";
import RulesList from "@/components/sales/RulesList";
import { rulesOverview } from "@/lib/repo/rules";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/admin/rules");

export const dynamic = "force-dynamic";

/** F130, first slice: the company's automation rules with their state and 14-day firings, for the owner (the admin layout gates it). */
export default async function RulesPage() {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  return (
    <>
      <PageHeader route="/sales/admin/rules" />
      <RulesList rules={await rulesOverview(session.organizationId)} />
    </>
  );
}
