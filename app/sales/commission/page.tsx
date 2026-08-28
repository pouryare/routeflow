import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { statementFor, allStatements, readRates } from "@/lib/commissionLedger";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate, toJalali, jalaliToIsoDate } from "@/lib/jalali";
import CommissionEditor from "@/components/sales/CommissionEditor";

export const dynamic = "force-dynamic";

/** One tone per person, picked from the name so a person keeps a colour between visits. */
const AV_TONE = ["plum", "sage", "sky", "amber"] as const;

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
        <div className="pcards">
          {statements.map((s) => {
            const tone = AV_TONE[s.display_name.length % AV_TONE.length];
            /* How much of what has accrued is still owed. The bar is the point of the
               card: two people can accrue the same and be settled very differently. */
            const settled =
              s.accrued_toman > 0
                ? Math.max(0, Math.min(100, ((s.accrued_toman - s.owed_toman) / s.accrued_toman) * 100))
                : 100;
            return (
              <article className="pcard" key={s.salesperson_user_id}>
                <header className="pcard__head">
                  <span
                    className="pcard__av"
                    style={{ background: `var(--${tone}-soft)`, color: `var(--${tone})` }}
                    aria-hidden
                  >
                    {s.display_name.trim()[0]}
                  </span>
                  <div className="min-w-0">
                    <h2>{s.display_name}</h2>
                    <div className="pcard__sub mono">{faNum(s.kg)} کیلو در این دوره</div>
                  </div>
                </header>

                <div className="pcard__big mono">
                  {faNum(s.accrued_toman)}
                  <small>تومان پورسانت</small>
                </div>

                <div className="pcard__bar" role="img"
                     aria-label={`${Math.round(settled)} درصد تسویه‌شده`}>
                  <i style={{ width: `${settled}%` }} />
                </div>

                <dl className="pcard__grid">
                  <div><dt>پرداخت‌شده</dt><dd className="mono">{faToman(s.paid_toman)}</dd></div>
                  <div>
                    <dt>مانده</dt>
                    <dd className="mono" style={{ color: s.owed_toman > 0 ? "var(--accent)" : "var(--sage)" }}>
                      {faToman(s.owed_toman)}
                    </dd>
                  </div>
                  <div><dt>سفارش</dt><dd className="mono">{faNum(s.orders.length)}</dd></div>
                </dl>

                {s.orders.length > 0 && (
                  <details className="pcard__more">
                    <summary>{faNum(s.orders.length)} سفارش پشت این عدد</summary>
                    <div className="pcard__rows">
                      {s.orders.slice(0, 8).map((o) => (
                        <div className="pcard__row" key={o.order_id}>
                          <span className="pcard__who">{o.customer_name}</span>
                          <span className="mono">{faNum(o.kg)} کیلو</span>
                          <span className="mono pcard__amt">{faToman(o.accrual_toman)}</span>
                        </div>
                      ))}
                      {s.orders.length > 8 && (
                        <p className="pcard__rest">
                          و {faNum(s.orders.length - 8)} سفارش دیگر
                        </p>
                      )}
                    </div>
                  </details>
                )}
              </article>
            );
          })}
        </div>
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
