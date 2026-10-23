import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { customersFor } from "@/lib/repo/sessionReads";
import { getSessionFromCookies } from "@/lib/session";
import PaymentsPanel from "@/components/sales/PaymentsPanel";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const customers = (await customersFor(session)).map((c) => ({
    id: c.id,
    business_name: c.business_name,
    customer_code: c.customer_code,
  }));

  return (
    <>
      <PageHeader route="/sales/payments" />
      <PaymentsPanel customers={customers} />
    </>
  );
}
