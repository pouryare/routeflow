import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orgScopeId } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";
import DataPanel from "@/components/admin/DataPanel";
import { pageMetadata } from "@/lib/pageMeta";
import { groupsOf } from "@/lib/repo/dataIO";

export const metadata = pageMetadata("/sales/admin/data");

export const dynamic = "force-dynamic";

/** F34: download the company's data as one Excel file, or upload an edited one and read what would change first.
 *  The admin layout lets owners through. */
export default async function DataPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const org = orgScopeId(session);
  const groups = org === null ? [] : await groupsOf(org);
  return (
    <>
      <PageHeader route="/sales/admin/data" />
      <DataPanel groups={groups} />
    </>
  );
}
