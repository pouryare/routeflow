import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";
import CompaniesPanel from "@/components/companies/CompaniesPanel";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/admin/companies");

export const dynamic = "force-dynamic";

/** Companies and their addresses. Platform owner only: the admin layout lets every owner through, so this checks again. */
export default async function CompaniesPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!session.hasRole("platform_owner")) redirect("/sales");
  return (
    <>
      <PageHeader route="/sales/admin/companies" />
      <CompaniesPanel />
    </>
  );
}
