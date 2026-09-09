import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { readCatalogue } from "@/lib/catalogue";
import BatchesPanel from "@/components/sales/BatchesPanel";

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role !== "owner" && session.role !== "group_manager") redirect("/sales");

  const products = readCatalogue(getDb(), session.organizationId).map((p) => ({
    id: p.id,
    name: p.name,
    base_unit: p.base_unit,
  }));

  return <BatchesPanel products={products} />;
}
