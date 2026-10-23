import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { catalogueFor } from "@/lib/repo/sessionReads";
import { getSessionFromCookies } from "@/lib/session";
import BatchesPanel from "@/components/sales/BatchesPanel";
import PageHeader from "@/components/meridian/PageHeader";

import { MANAGE_ROLES } from "@/lib/roles";
export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!MANAGE_ROLES.includes(session.role)) redirect("/sales");

  const products = (await catalogueFor(session)).map((p) => ({
    id: p.id,
    name: p.name,
    base_unit: p.base_unit,
  }));

  return (
    <>
      <PageHeader route="/sales/batches" />
      <BatchesPanel products={products} />
    </>
  );
}
