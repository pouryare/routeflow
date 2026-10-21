import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, scopeGroupIds } from "@/lib/session";
import { getDb } from "@/lib/db";
import { readCustomers } from "@/lib/customers";
import { readCatalogue } from "@/lib/catalogue";
import ComplaintsPanel from "@/components/sales/ComplaintsPanel";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole, MANAGE_ROLES } from "@/lib/roles";


export const dynamic = "force-dynamic";

export default async function ComplaintsPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const db = getDb();
  const customers = readCustomers(db, scopeGroupIds(session)).map((c) => ({
    id: c.id,
    business_name: c.business_name,
  }));
  const products = readCatalogue(db, session.organizationId).map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
    <PageHeader route="/sales/complaints" />
    <ComplaintsPanel
      customers={customers}
      products={products}
      canManage={MANAGE_ROLES.includes(session.role)}
    />    </>
  );
}
