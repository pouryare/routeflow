import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { statementFor, allStatements, readRates } from "@/lib/commissionLedger";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate, toJalali, jalaliToIsoDate } from "@/lib/jalali";
import CommissionEditor from "@/components/sales/CommissionEditor";
import Reveal from "@/components/kargah/Reveal";

export const dynamic = "force-dynamic";

/** The commission ledger.
 *
 *  Defaults to the current Jalali month rather than the Gregorian one -- everyone here
 *  thinks in شهریور, and a report window that ends on the 31st of a month nobody uses
 *  makes the figures impossible to check against anything.
 */
export default async function CommissionPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const today = toJalali(new Date().toISOString())!;
  const period = {
    from: jalaliToIsoDate(today.jy, today.jm, 1),
    to: jalaliToIsoDate(today.jy, today.jm, today.jd),
  };

  const db = getDb();
  const statements =
    session.role === "salesperson"
      ? [statementFor(db, session.user.id, period)]
      : allStatements(db, period, {
          groupId: session.role === "owner" ? undefined : session.groupId,
        });

  const sellers =
    session.role === "owner"
      ? plain(
          db
            .prepare(
              "SELECT id, display_name FROM users WHERE role = 'salesperson' AND active = 1 ORDER BY display_name"
            )
            .all()
        ) as unknown as { id: number; display_name: string }[]
      : [];

  const rates = session.role === "owner" ? readRates(db).slice(0, 12) : [];

  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
        دوره {faJalaliDate(period.from)} تا {faJalaliDate(period.to)} · پورسانت روی وزن
        تحویل‌شده حساب می‌شود، نه سفارش‌شده.
      </p>

      {statements.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
          هنوز فروشنده‌ای ثبت نشده است.
        </p>
      ) : (
        <Reveal replayKey="commission" select="li">
          <ul className="flex list-none flex-col gap-[var(--space-3)] p-0">
            {statements.map((s) => (
              <li
                key={s.salesperson_user_id}
                className="card p-[var(--space-4)]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                  <h2 className="m-0 text-[length:var(--text-base)] font-medium text-[var(--text)]">
                    {s.display_name}
                  </h2>
                  <span className="tabular-nums text-[length:var(--text-base)] text-[var(--text)]">
                    {faToman(s.accrued_toman)}
                  </span>
                </div>

                <div className="mt-[var(--space-2)] flex flex-wrap gap-x-[var(--space-4)] gap-y-[var(--space-1)] text-[length:var(--text-xs)] tabular-nums text-[var(--text-muted)]">
                  <span>{faNum(s.kg)} کیلو در این دوره</span>
                  <span>پرداختی این دوره {faToman(s.paid_toman)}</span>
                  <span
                    style={{ color: s.owed_toman > 0 ? "var(--warn)" : "var(--text-muted)" }}
                  >
                    مانده کل {faToman(s.owed_toman)}
                  </span>
                </div>

                {s.orders.length > 0 && (
                  <details className="mt-[var(--space-3)]">
                    <summary className="cursor-pointer text-[length:var(--text-xs)] text-[var(--text-muted)] hover:text-[var(--text)]">
                      {faNum(s.orders.length)} سفارش پشت این عدد
                    </summary>
                    <table className="mt-[var(--space-2)] w-full border-collapse text-[length:var(--text-xs)]">
                      <thead>
                        <tr className="text-[var(--text-muted)]">
                          <th className="border-b border-[var(--border)] py-[var(--space-1)] text-right font-medium">
                            مشتری
                          </th>
                          <th className="border-b border-[var(--border)] py-[var(--space-1)] text-left font-medium">
                            تاریخ
                          </th>
                          <th className="border-b border-[var(--border)] py-[var(--space-1)] text-left font-medium">
                            وزن
                          </th>
                          <th className="border-b border-[var(--border)] py-[var(--space-1)] text-left font-medium">
                            نرخ
                          </th>
                          <th className="border-b border-[var(--border)] py-[var(--space-1)] text-left font-medium">
                            پورسانت
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.orders.map((o) => (
                          <tr key={o.order_id}>
                            <td className="border-b border-[var(--border)] py-[var(--space-1)] text-[var(--text-muted)]">
                              {o.customer_name}
                            </td>
                            <td className="border-b border-[var(--border)] py-[var(--space-1)] text-left tabular-nums text-[var(--text-muted)]">
                              {faJalaliDate(o.order_date)}
                            </td>
                            <td className="border-b border-[var(--border)] py-[var(--space-1)] text-left tabular-nums text-[var(--text-muted)]">
                              {faNum(o.kg)}
                            </td>
                            <td className="border-b border-[var(--border)] py-[var(--space-1)] text-left tabular-nums text-[var(--text-muted)]">
                              {faToman(o.rate_per_kg_toman)}
                            </td>
                            <td className="border-b border-[var(--border)] py-[var(--space-1)] text-left tabular-nums text-[var(--text)]">
                              {faToman(o.accrual_toman)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </Reveal>
      )}

      {session.role === "owner" && <CommissionEditor sellers={sellers} />}

      {rates.length > 0 && (
        <section className="card p-[var(--space-4)]">
          <h2 className="m-0 text-[length:var(--text-base)] font-medium text-[var(--text)]">
            نرخ‌های پورسانت
          </h2>
          <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
            نرخ‌ها پاک نمی‌شوند. هر تغییر یک سطر تازه است.
          </p>
          <ul className="mt-[var(--space-3)] flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
            {rates.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]"
              >
                <span className="text-[var(--text)]">{r.display_name ?? "همه فروشنده‌ها"}</span>
                <span className="tabular-nums text-[var(--text-muted)]">
                  {faToman(r.rate_per_kg_toman)} در هر کیلو · از {faJalaliDate(r.valid_from)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
