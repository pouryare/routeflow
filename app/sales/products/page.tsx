import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { readCatalogue } from "@/lib/catalogue";
import { faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import CatalogueEditor from "@/components/sales/CatalogueEditor";
import ProductsView from "@/components/kargah/ProductsView";

export const dynamic = "force-dynamic";

/** The catalogue, and the prices in force today.
 *
 *  Read by anyone who sells; edited only by the owner. The editor is only mounted for an
 *  owner, so a فروشنده gets the price list without a set of controls that would refuse
 *  them -- the same rule the map's link list follows.
 */
export default async function ProductsPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const products = readCatalogue(db, { includeInactive: session.role === "owner" });

  const priceRows = db
    .prepare(
      `SELECT pp.id, pp.product_id, pp.packaging_id, pp.price_toman, pp.valid_from,
              p.name AS product_name, pk.name AS packaging_name, u.display_name AS by_name
         FROM product_prices pp
         JOIN products p ON p.id = pp.product_id
         LEFT JOIN packagings pk ON pk.id = pp.packaging_id
         LEFT JOIN users u ON u.id = pp.created_by
        ORDER BY pp.valid_from DESC, pp.id DESC
        LIMIT 25`
    )
    .all() as unknown as {
    id: number;
    price_toman: number;
    valid_from: string;
    product_name: string;
    packaging_name: string | null;
    by_name: string | null;
  }[];

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      {products.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
          هنوز کالایی ثبت نشده است.
          {session.role === "owner" && " با فرم پایین اولین کالا را اضافه کنید."}
        </p>
      ) : (
        <ProductsView
          products={products.map((p) => ({
            id: p.id,
            name: p.name,
            base_unit: p.base_unit,
            kg_per_base_unit: p.kg_per_base_unit,
            active: p.active,
            packagings: p.packagings.map((k) => ({
              id: k.id,
              name: k.name,
              qty_per_pack: k.qty_per_pack,
              price_toman: k.price_toman,
            })),
          }))}
        />
      )}

      {session.role === "owner" && (
        <CatalogueEditor
          products={products.map((p) => ({
            id: p.id,
            name: p.name,
            base_unit: p.base_unit,
            packagings: p.packagings.map((k) => ({ id: k.id, name: k.name })),
          }))}
        />
      )}

      {priceRows.length > 0 && (
        <section className="card p-[var(--space-4)]">
          <h2 className="m-0 text-[length:var(--text-base)] font-medium text-[var(--text)]">
            تاریخچه قیمت‌ها
          </h2>
          <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
            قیمت‌ها پاک نمی‌شوند. هر تغییر یک سطر تازه است، تا سفارش‌های قبلی با قیمت
            همان روز بمانند.
          </p>
          <ul className="mt-[var(--space-3)] flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
            {priceRows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]"
              >
                <span className="text-[var(--text)]">
                  {row.product_name}
                  {row.packaging_name && (
                    <span className="text-[var(--text-muted)]"> · {row.packaging_name}</span>
                  )}
                </span>
                <span className="tabular-nums text-[var(--text-muted)]">
                  {faToman(row.price_toman)} · از {faJalaliDate(row.valid_from)}
                  {row.by_name && ` · ${row.by_name}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
