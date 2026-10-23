import { tehranTodayIso, faJalaliDate, faJalaliDateTime } from "@/lib/jalali";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { catalogueFor } from "@/lib/repo/sessionReads";
import { priceHistoryFor, ownerCostingFor } from "@/lib/repo/productsView";
import { faToman } from "@/lib/format";
import CatalogueEditor from "@/components/sales/CatalogueEditor";
import ProductsView from "@/components/meridian/ProductsView";
import SplineChart from "@/components/charts/SplineChart";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole, isOwner } from "@/lib/roles";
import { recentProductChanges } from "@/lib/repo/productLog";
import Link from "next/link";
import { Icon } from "@/components/meridian/Icon";


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
  if (isVanRole(session.role)) redirect("/driver");

  const products = catalogueFor(session, { includeInactive: isOwner(session.role) });

  /* ONE date for the whole page. The drawer resolves cost and commission against it, and
     the drawer resolves the price against it too -- three separate effective-dated series
     read on three different "today" values would be three answers to one question, and a
     midnight rollover mid-render would make them disagree. */
  const today = tehranTodayIso();

  const allPriceRows = priceHistoryFor(session);

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

  // The owner's costing inputs are read only for an owner: cost never reaches anyone else.
  const costing = isOwner(session.role) ? ownerCostingFor(session, products, today) : null;
  // F99: who added a product or packaging, or moved a reorder line. Owner-only, like the editor.
  const changes = isOwner(session.role) ? recentProductChanges(session) : [];

  return (
    <>
    <PageHeader route="/sales/products" />
    <div className="flex flex-col gap-[var(--space-5)]">
      {/* F23: today's prices as a sheet to print or save as PDF and send to a customer. */}
      {products.length > 0 && (
        <Link href="/print/price-list" className="btn inline-flex min-h-[44px] items-center gap-[var(--space-2)] self-start">
          <Icon name="edit" size="sm" />
          برگهٔ قیمت برای مشتری
        </Link>
      )}
      {products.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
          هنوز کالایی ثبت نشده است.
          {isOwner(session.role) && " با فرم پایین اولین کالا را اضافه کنید."}
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

      {isOwner(session.role) && (
        <CatalogueEditor
          companyRatePerKg={costing!.companyRatePerKg}
          products={products.map((p) => {
            /* The drawer's cost basis, resolved through the SAME `costBasisFor` the order
               line snapshots. Resolving it here rather than in the component is what keeps
               one answer per product: a number computed twice, from two queries, is two
               numbers that can drift apart.

               `null` when nothing is known -- a product never purchased. That is passed
               through as `cost_method: null` rather than as a cost of 0, because the
               forward solve would otherwise return a confident price built from overheads
               alone for a product whose real cost was never entered. */
            const basis = costing!.basisByProduct.get(p.id) ?? null;
            return {
              id: p.id,
              name: p.name,
              base_unit: p.base_unit,
              kg_per_base_unit: p.kg_per_base_unit,
              avg_cost_toman: p.avg_cost_toman,
              cost_toman: basis?.cost_toman ?? 0,
              cost_method: basis?.method ?? null,
              packagings: p.packagings.map((k) => ({
                id: k.id,
                name: k.name,
                price_toman: k.price_toman,
              })),
            };
          })}
        />
      )}

      {priceRows.length > 0 && (
        <section className="card p-[var(--space-4)]">
          <h2 className="sechead__title">
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

      {changes.length > 0 && (
        <section className="card p-[var(--space-4)]">
          <h2 className="sechead__title">تغییرات کاتالوگ</h2>
          <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
            کالای تازه، بسته‌بندی تازه و تغییر آستانه‌های انبار، با نام کسی که ثبت کرد. تغییر قیمت در تاریخچهٔ قیمت‌ها آمده است.
          </p>
          <ul className="mt-[var(--space-3)] flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
            {changes.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]"
              >
                <span className="text-[var(--text)]">
                  {c.product_name} · {c.note}
                  {c.new_value && (
                    <span className="text-[var(--text-muted)]">
                      {" "}
                      {c.old_value ? `از «${c.old_value}» به «${c.new_value}»` : `«${c.new_value}»`}
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-[var(--text-muted)]">
                  {faJalaliDateTime(c.created_at)}
                  {c.changed_by && ` · ${c.changed_by}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>    </>
  );
}
