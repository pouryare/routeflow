import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, scopeGroupIds } from "@/lib/session";
import { getDb } from "@/lib/db";
import { readCustomers } from "@/lib/customers";
import PaymentsPanel from "@/components/sales/PaymentsPanel";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const customers = readCustomers(getDb(), scopeGroupIds(session)).map((c) => ({
    id: c.id,
    business_name: c.business_name,
    customer_code: c.customer_code,
  }));

  return <PaymentsPanel customers={customers} />;
}
