import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, scopeGroupIds } from "@/lib/session";
import { getDb } from "@/lib/db";
import { readCustomers } from "@/lib/customers";
import ChequesBoard from "@/components/sales/ChequesBoard";

export const dynamic = "force-dynamic";

export default async function ChequesPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role !== "owner" && session.role !== "group_manager") redirect("/sales");

  const customers = readCustomers(getDb(), scopeGroupIds(session)).map((c) => ({
    id: c.id,
    business_name: c.business_name,
    customer_code: c.customer_code,
  }));

  return <ChequesBoard customers={customers} />;
}
