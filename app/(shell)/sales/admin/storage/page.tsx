import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orgScopeId } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";
import StoragePanel from "@/components/storage/StoragePanel";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/admin/storage");

export const dynamic = "force-dynamic";

/** Each company's own S3 storages (docs/storage.md). The admin layout lets owners through. */
export default async function StoragePage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  return (
    <>
      <PageHeader route="/sales/admin/storage" />
      <StoragePanel isPlatform={session.hasRole("platform_owner")} allCompanies={orgScopeId(session) === null} />
    </>
  );
}
