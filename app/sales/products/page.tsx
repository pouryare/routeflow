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
import SplineChart from "@/components/charts/SplineChart";

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
  const products = readCatalogue(db, session.organizationId, {
    includeInactive: session.role === "owner",
  });

  const allPriceRows = db
    .prepare(
      `SELECT pp.id, pp.product_id, pp.packaging_id, pp.price_toman, pp.valid_from,
              p.name AS product_name, pk.name AS packaging_name, u.display_name AS by_name
         FROM product_prices pp
         JOIN products p ON p.id = pp.product_id
         LEFT JOIN packagings pk ON pk.id = pp.packaging_id
         LEFT JOIN users u ON u.id = pp.created_by
        ORDER BY pp.valid_from DESC, pp.id DESC`
    )
    .all() as unknown as {
    id: number;
    product_id: number;
    packaging_id: number | null;
    price_toman: number;
    valid_from: string;
    product_name: string;
    packaging_name: string | null;
    by_name: string | null;
  }[];

  const priceRows = allPriceRows.slice(0, 10);

  /* One chart per packaging-price-series: each packaging keeps its own price timeline,
     so a chart never has to reconcile two packagings that started their price rows on
     different days. Rows already arrive newest-first, which is the order SplineChart
     wants -- index 0 drawn at the right edge. */
  const historySeries = Object.values(
    allPriceRows.reduce<Record<string, { productName: string; packagingName: string | null; rows: typeof allPriceRows }>>(
      (acc, row) => {
        const key = `${row.product_id}:${row.packaging_id ?? "all"}`;
        (acc[key] ??= { productName: row.product_name, packagingName: row.packaging_name, rows: [] }).rows.push(
          row
        );
        return acc;
      },
      {}
    )
  ).filter((s) => s.rows.length >= 2);

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

          {historySeries.length > 0 ? (
            <div className="mt-[var(--space-5)] grid grid-cols-1 gap-[var(--space-4)] md:grid-cols-2">
              {historySeries.map((s, i) => {
                const rowsAsc = [...s.rows].reverse(); // oldest→newest, for the caption
                const first = rowsAsc[0];
                const last = rowsAsc[rowsAsc.length - 1];
                const delta = last.price_toman - first.price_toman;
                return (
                  <SplineChart
                    key={i}
                    title={s.packagingName ? `${s.productName} · ${s.packagingName}` : s.productName}
                    subtitle={
                      delta === 0
                        ? "بدون تغییر در این بازه"
                        : `${delta > 0 ? "افزایش" : "کاهش"} ${faToman(Math.abs(delta))} از ${faJalaliDate(first.valid_from)}`
                    }
                    labels={s.rows.map((r) => faJalaliDate(r.valid_from))}
                    series={[{ label: "قیمت", values: s.rows.map((r) => r.price_toman) }]}
                    formatValue={faToman}
                  />
                );
              })}
            </div>
          ) : (
            <p className="mt-[var(--space-4)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
              هنوز هیچ کالایی بیش از یک بار قیمت‌گذاری نشده — نمودار وقتی معنا پیدا می‌کند
              که یک بسته‌بندی حداقل دو قیمت داشته باشد.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
