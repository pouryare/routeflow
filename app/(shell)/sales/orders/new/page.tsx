import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, groupFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { readCatalogue } from "@/lib/catalogue";
import { customerDebtsForOrg } from "@/lib/repo/payments";
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

  const db = getDb();
  const scope = groupFilter(session);

  // plain() because these cross into a client component -- see lib/db.ts.
  const debtByCustomer = customerDebtsForOrg(session.organizationId);
  const customers = (
    plain(
      db
        .prepare(
          `SELECT id, customer_code, business_name, phone, credit_limit_toman
             FROM customers
            WHERE 1 = 1${scope.sql}
            ORDER BY business_name`
        )
        .all(...scope.params)
    ) as unknown as {
      id: number;
      customer_code: string;
      business_name: string;
      phone: string | null;
      credit_limit_toman: number | null;
    }[]
  ).map((c) => ({ ...c, debt: debtByCustomer.get(c.id)?.total ?? 0 }));

  const products = readCatalogue(db, session.organizationId).map((product) => ({
    id: product.id,
    name: product.name,
    base_unit: product.base_unit,
    kg_per_base_unit: product.kg_per_base_unit,
    packagings: product.packagings.map((pack) => ({
      id: pack.id,
      name: pack.name,
      qty_per_pack: pack.qty_per_pack,
      price_toman: pack.price_toman,
    })),
  }));

  // Only a manager or the owner may credit an order to somebody else; a فروشنده's
  // orders are always their own, so they are not offered the choice.
  const sellers =
    session.role === "phone_sales"
      ? []
      : (plain(
          db
          .prepare(
            `SELECT id, display_name FROM users
              WHERE role = 'phone_sales' AND active = 1${scope.sql}
              ORDER BY display_name`
          )
          .all(...scope.params)
        ) as unknown as { id: number; display_name: string }[]);

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
