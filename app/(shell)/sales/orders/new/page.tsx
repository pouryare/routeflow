import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { orderEntryFor } from "@/lib/repo/ordersView";
import OrderForm from "@/components/sales/OrderForm";
import OrderQuickEntry from "@/components/flows/OrderQuickEntry";
import PageHeader from "@/components/meridian/PageHeader";
import { canSell, isVanRole } from "@/lib/roles";
import Link from "next/link";
import StatePage from "@/components/meridian/StatePage";
import { Icon } from "@/components/meridian/Icon";

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
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");
  /* A rep manager reaches the orders list but cannot sell (the order API refuses them). Say
     so here, with the way back, instead of a form whose save fails at the last tap. */
  if (!canSell(session.role)) {
    return (
      <StatePage
        icon="ban"
        eyebrow="ثبت سفارش"
        title="این نقش سفارش ثبت نمی‌کند"
        hint="سفارش را فروشنده یا مدیر گروه ثبت می‌کند. از فهرست سفارش‌ها می‌توانید سفارش‌های گروه را ببینید."
        actions={
          <Link className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" href="/sales/orders">
            <Icon name="arrow-right" size="md" />
            فهرست سفارش‌ها
          </Link>
        }
      />
    );
  }

  const { customers, products, sellers } = await orderEntryFor(session);

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
