import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, groupFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { readCatalogue } from "@/lib/catalogue";
import OrderForm from "@/components/sales/OrderForm";

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
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const scope = groupFilter(session);

  // plain() because these cross into a client component -- see lib/db.ts.
  const customers = plain(
    db
    .prepare(
      `SELECT id, customer_code, business_name, phone,
              COALESCE(debt_0_7, 0) + COALESCE(debt_8_30, 0) + COALESCE(debt_30_plus, 0) AS debt,
              credit_limit_toman
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
    debt: number;
    credit_limit_toman: number | null;
  }[];

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
    session.role === "salesperson"
      ? []
      : (plain(
          db
          .prepare(
            `SELECT id, display_name FROM users
              WHERE role = 'salesperson' AND active = 1${scope.sql}
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
    <OrderForm
      customers={customers}
      products={products}
      sellers={sellers}
      initialCustomerId={initialCustomerId}
    />
  );
}
