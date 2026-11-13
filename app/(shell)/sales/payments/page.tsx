import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { customersFor } from "@/lib/repo/sessionReads";
import { getSessionFromCookies } from "@/lib/session";
import PaymentsPanel from "@/components/sales/PaymentsPanel";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole, isOwner } from "@/lib/roles";
import CashInHandCard from "@/components/sales/CashInHandCard";
import { holdings } from "@/lib/repo/cashInHand";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/payments");

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
      {isOwner(session.role) ? <CashInHandCard items={await holdings(session.organizationId)} /> : null}
      <PaymentsPanel customers={customers} canSeeBooks={isOwner(session.role)} />
    </>
  );
}
