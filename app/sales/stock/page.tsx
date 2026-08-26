import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { stockPosition, readPurchases } from "@/lib/purchases";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import PurchaseEntry from "@/components/sales/PurchaseEntry";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const stock = stockPosition(db);
  const purchases = session.role === "owner" ? readPurchases(db, 15) : [];
  const products =
    session.role === "owner"
      ? (plain(
          db.prepare("SELECT id, name, base_unit FROM products WHERE active = 1 ORDER BY name").all()
        ) as unknown as { id: number; name: string; base_unit: string }[])
      : [];

  const totalValue = stock.reduce((sum, row) => sum + row.value_toman, 0);
  const negatives = stock.filter((row) => row.negative);

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          موجودی از خرید منهای تحویل حساب می‌شود — نه سفارش.
        </p>
        <span className="tabular-nums text-[length:var(--text-base)] text-[var(--text)]">
          ارزش انبار {faToman(totalValue)}
        </span>
      </div>

      {negatives.length > 0 && (
        <p className="m-0 rounded-[var(--radius-md)] border border-[var(--warn)] p-[var(--space-3)] text-[length:var(--text-sm)] leading-6 text-[var(--warn)]">
          موجودی {faNum(negatives.length)} کالا منفی است. یعنی خریدِ ثبت‌نشده دارید — تا
          وقتی فاکتورهای کاغذی وارد نشده‌اند این طبیعی است.
        </p>
      )}

      {stock.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--text-faint)]">
          هنوز کالایی ثبت نشده است.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full border-collapse text-[length:var(--text-sm)]">
            <thead>
              <tr className="text-[var(--text-faint)]">
                <th className="border-b border-[var(--border)] p-[var(--space-3)] text-right font-medium">
                  کالا
                </th>
                <th className="border-b border-[var(--border)] p-[var(--space-3)] text-left font-medium">
                  خرید
                </th>
                <th className="border-b border-[var(--border)] p-[var(--space-3)] text-left font-medium">
                  تحویل
                </th>
                <th className="border-b border-[var(--border)] p-[var(--space-3)] text-left font-medium">
                  موجودی
                </th>
                <th className="border-b border-[var(--border)] p-[var(--space-3)] text-left font-medium">
                  میانگین قیمت
                </th>
                <th className="border-b border-[var(--border)] p-[var(--space-3)] text-left font-medium">
                  ارزش
                </th>
              </tr>
            </thead>
            <tbody>
              {stock.map((row) => (
                <tr key={row.product_id}>
                  <td className="border-b border-[var(--border)] p-[var(--space-3)] text-[var(--text)]">
                    {row.name}
                  </td>
                  <td className="border-b border-[var(--border)] p-[var(--space-3)] text-left tabular-nums text-[var(--text-muted)]">
                    {faNum(row.purchased_qty)}
                  </td>
                  <td className="border-b border-[var(--border)] p-[var(--space-3)] text-left tabular-nums text-[var(--text-muted)]">
                    {faNum(row.delivered_qty)}
                  </td>
                  <td
                    className="border-b border-[var(--border)] p-[var(--space-3)] text-left tabular-nums"
                    style={{ color: row.negative ? "var(--warn)" : "var(--text)" }}
                  >
                    {faNum(row.on_hand)} {row.base_unit}
                  </td>
                  <td className="border-b border-[var(--border)] p-[var(--space-3)] text-left tabular-nums text-[var(--text-muted)]">
                    {faToman(row.avg_cost_toman)}
                  </td>
                  <td className="border-b border-[var(--border)] p-[var(--space-3)] text-left tabular-nums text-[var(--text)]">
                    {faToman(row.value_toman)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {session.role === "owner" && <PurchaseEntry products={products} />}

      {purchases.length > 0 && (
        <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <h2 className="m-0 text-[length:var(--text-base)] font-medium text-[var(--text)]">
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
                  <span className="text-[var(--text-faint)]">
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
    </div>
  );
}
