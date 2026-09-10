import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { advancedStockPosition, readPurchases } from "@/lib/purchases";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate, toJalali, jalaliToIsoDate } from "@/lib/jalali";
import PurchaseEntry from "@/components/sales/PurchaseEntry";
import InventoryBoard from "@/components/meridian/InventoryBoard";
import GradientStat from "@/components/meridian/GradientStat";
import { expiringBatches, listBatchesWithProduct } from "@/lib/repo/batches";
import BatchList from "@/components/sales/BatchList";
import PageHeader from "@/components/meridian/PageHeader";

export const dynamic = "force-dynamic";

/** انبار پیشرفته -- the advanced inventory board (MASTER: the approved artifact,
 *  favicon 📦). Everything a plain موجودی table could not show at a glance: which
 *  products are about to run out, how fast each is actually moving, and what buying
 *  more of it now would cost. */
export default async function StockPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const stock = advancedStockPosition(db);
  const purchases = session.role === "owner" ? readPurchases(db, session.organizationId, 15) : [];
  const products =
    session.role === "owner"
      ? (plain(
          db
            .prepare(
              "SELECT id, name, base_unit FROM products WHERE active = 1 AND organization_id = ? ORDER BY name"
            )
            .all(session.organizationId)
        ) as unknown as { id: number; name: string; base_unit: string }[])
      : [];

  const totalValue = stock.reduce((sum, row) => sum + row.value_toman, 0);
  const critCount = stock.filter((r) => r.status === "crit").length;
  const lowCount = stock.filter((r) => r.status === "low").length;
  const negatives = stock.filter((row) => row.negative);
  const stockName = new Map(stock.map((r) => [r.product_id, r.name]));
  const expiring = expiringBatches(session.organizationId);
  /* Item 18: the batch list lives with the stock it makes up. The quarantine, release and
     recall actions stay on /sales/batches, for the roles that tab is open to. */
  const canManageBatches = session.role === "owner" || session.role === "group_manager";
  const batches = listBatchesWithProduct(session.organizationId).map((b) => ({
    id: b.id,
    batch_code: b.batch_code,
    product: b.product_name,
    produced_at: b.produced_at,
    expiry_date: b.expiry_date,
    on_hand: b.on_hand,
    status: b.status,
  }));

  const today = toJalali(new Date().toISOString())!;
  const monthFrom = jalaliToIsoDate(today.jy, today.jm, 1);
  const monthPurchases = db
    .prepare(
      `SELECT COUNT(DISTINCT pu.id) AS n, COALESCE(SUM(pl.base_qty * pl.unit_cost_toman), 0) AS total
         FROM purchases pu LEFT JOIN purchase_lines pl ON pl.purchase_id = pu.id
        WHERE pu.purchase_date >= ?`
    )
    .get(monthFrom) as { n: number; total: number };

  const rows = stock.map((r) => ({
    product_id: r.product_id,
    name: r.name,
    base_unit: r.base_unit,
    on_hand: r.on_hand,
    value_toman: r.value_toman,
    reorder_point: r.reorder_point,
    target_stock: r.target_stock,
    status: r.status,
    daily_rate: r.daily_rate,
    days_left: r.days_left,
    spark: r.spark,
    last_purchase_date: r.last_purchase_date ? faJalaliDate(r.last_purchase_date) : null,
  }));

  return (
    <>
    <PageHeader route="/sales/stock" />
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="statrow">
        <GradientStat tone="peach" label="ارزش کل انبار" value={faNum(totalValue)} unit="تومان" chip={`از ${faNum(stock.length)} کالای فعال`} />
        <GradientStat
          tone="sand"
          small
          icon="warn"
          label="کالای بحرانی"
          value={faNum(critCount)}
          chip={critCount > 0 ? "زیر نقطهٔ سفارش -- نیاز به خرید فوری" : "چیزی زیر نقطهٔ سفارش نیست"}
          chipTone="amber"
        />
        <GradientStat
          tone="mint"
          small
          icon="receipt"
          label="خرید این ماه"
          value={`${faNum(monthPurchases.n)} فقره`}
          chip={`به ارزش ${faToman(monthPurchases.total)}`}
          chipTone="sky"
        />
      </div>

      {expiring.length > 0 && (
        <section className="card p-[var(--space-4)]">
          <h2 className="sechead__title" style={{ color: "var(--warn)" }}>
            انقضا — {faNum(expiring.length)} بچ
          </h2>
          <ul className="mt-[var(--space-3)] flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
            {expiring.slice(0, 12).map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]">
                <span className="text-[var(--text)]">
                  {stockName.get(b.product_id) ?? "کالا"}
                  <span className="text-[var(--text-muted)]"> · بچ {b.batch_code}</span>
                </span>
                <span
                  className="tabular-nums"
                  style={{ color: (b.days_to_expiry ?? 0) < 0 ? "var(--crit)" : "var(--warn)" }}
                >
                  {b.expiry_date ? faJalaliDate(b.expiry_date) : "—"} ·{" "}
                  {(b.days_to_expiry ?? 0) < 0
                    ? `${faNum(Math.abs(b.days_to_expiry ?? 0))} روز گذشته`
                    : `${faNum(b.days_to_expiry ?? 0)} روز مانده`}{" "}
                  · {faNum(b.on_hand)} واحد
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {negatives.length > 0 && (
        <p className="m-0 rounded-[var(--radius-md)] border border-[var(--warn)] p-[var(--space-3)] text-[length:var(--text-sm)] leading-6 text-[var(--warn)]">
          موجودی {faNum(negatives.length)} کالا منفی است. یعنی خریدِ ثبت‌نشده دارید — تا
          وقتی فاکتورهای کاغذی وارد نشده‌اند این طبیعی است.
        </p>
      )}

      {lowCount > 0 && critCount === 0 && (
        <p className="m-0 rounded-[var(--radius-md)] border border-[var(--amber)] p-[var(--space-3)] text-[length:var(--text-sm)] leading-6" style={{ color: "var(--amber)" }}>
          {faNum(lowCount)} کالا به نقطهٔ سفارش نزدیک می‌شود -- وقت خوبی برای برنامه‌ریزی خرید بعدی است.
        </p>
      )}

      {stock.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
          هنوز کالایی ثبت نشده است.
        </p>
      ) : (
        <InventoryBoard rows={rows} canEdit={session.role === "owner"} />
      )}

      <BatchList rows={batches} canManage={canManageBatches} />

      {session.role === "owner" && <PurchaseEntry products={products} />}

      {purchases.length > 0 && (
        <section className="card p-[var(--space-4)]">
          <h2 className="sechead__title">
            خریدهای اخیر
          </h2>
          <ul className="mt-[var(--space-3)] flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
            {purchases.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]"
              >
                <span className="text-[var(--text)]">
                  {p.supplier ?? "بدون تأمین‌کننده"}
                  <span className="text-[var(--text-muted)]">
                    {" "}
                    · {faNum(p.line_count)} قلم
                  </span>
                </span>
                <span className="tabular-nums text-[var(--text-muted)]">
                  {faToman(p.total_toman)} · {faJalaliDate(p.purchase_date)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>    </>
  );
}
