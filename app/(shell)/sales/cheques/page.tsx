import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { customersFor } from "@/lib/repo/sessionReads";
import { getSessionFromCookies } from "@/lib/session";
import ChequesBoard from "@/components/sales/ChequesBoard";
import PageHeader from "@/components/meridian/PageHeader";

import { MANAGE_ROLES } from "@/lib/roles";
export const dynamic = "force-dynamic";

export default async function ChequesPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!MANAGE_ROLES.includes(session.role)) redirect("/sales");

  const customers = customersFor(session).map((c) => ({
    id: c.id,
    business_name: c.business_name,
    customer_code: c.customer_code,
  }));

  return (
    <>
      <PageHeader route="/sales/cheques" />
      <ChequesBoard customers={customers} />
    </>
  );
}
