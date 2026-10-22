import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { orderEntryFor } from "@/lib/repo/ordersView";
import OrderForm from "@/components/sales/OrderForm";
import OrderQuickEntry from "@/components/flows/OrderQuickEntry";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** Repeated parameters arrive as an array; the first is enough here. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The order form's data, loaded on the server and scoped.
 *
 *  Customers come through groupFilter, so a manager cannot pick another territory's
 *  shop out of the list -- the API refuses it too, but a picker that offers something
 *  the server will reject is a worse experience than one that never offers it.
 */
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const { customers, products, sellers } = orderEntryFor(session);

  // Validated against the customers this caller can already see, rather than passed
  // through. A link is user input: an id from another group must not preselect anything,
  // and the form falls back to its search box as though no customer had been named.
  const requested = one((await searchParams).customer);
  const initialCustomerId =
    requested !== undefined && /^\d+$/.test(requested)
      ? (customers.find((c) => c.id === Number(requested))?.id ?? null)
      : null;

  return (
    <>
    <PageHeader route="/sales/orders/new" />
    <OrderQuickEntry
      customers={customers}
      products={products}
      initialCustomerId={initialCustomerId}
    />
    <OrderForm
      customers={customers}
      products={products}
      sellers={sellers}
      initialCustomerId={initialCustomerId}
    />    </>
  );
}
