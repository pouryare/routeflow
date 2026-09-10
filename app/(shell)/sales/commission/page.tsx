import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { statementFor, allStatements, readRates } from "@/lib/commissionLedger";
import { allDriverStatements, readDriverRates } from "@/lib/driverCommissionLedger";
import { allManagerStatements, managerStatementFor, readManagerOverrides } from "@/lib/managerCommissionLedger";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate, toJalali, jalaliToIsoDate } from "@/lib/jalali";
import CommissionEditor from "@/components/sales/CommissionEditor";
import Avatar from "@/components/meridian/Avatar";
import EarnerCard from "@/components/meridian/EarnerCard";
import PageHeader from "@/components/meridian/PageHeader";

export const dynamic = "force-dynamic";

/** The commission ledger -- سه دفتر, one per way of earning it.
 *
 *  فروشنده and راننده are both "weight × the rate in force", just measured against a
 *  different set of rows (orders credited to them vs. stops their own runs delivered).
 *  مدیر گروه is not a weight at all -- it is a percentage of what their whole group's
 *  فروشنده‌ها accrued, which is why it gets its own section rather than being forced
 *  through EarnerCard's kg-shaped layout.
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
  const groupId = session.role === "owner" ? undefined : session.groupId;

  const statements =
    session.role === "salesperson"
      ? [statementFor(db, session.user.id, period)]
      : allStatements(db, period, { groupId });

  // A فروشنده sees only their own figures -- someone else's earnings, driver or
  // manager, are none of their business, the same boundary their own statement draws.
  const driverStatements = session.role === "salesperson" ? [] : allDriverStatements(db, period, { groupId });
  const managerStatements =
    session.role === "owner"
      ? allManagerStatements(db, period)
      : session.role === "group_manager"
        ? [managerStatementFor(db, session.user.id, period)]
        : [];

  const sellers =
    session.role === "owner"
      ? (plain(
          db
            .prepare("SELECT id, display_name FROM users WHERE role = 'salesperson' AND active = 1 ORDER BY display_name")
            .all()
        ) as unknown as { id: number; display_name: string }[])
      : [];
  const drivers =
    session.role === "owner"
      ? (plain(
          db.prepare("SELECT id, display_name FROM users WHERE role = 'driver' AND active = 1 ORDER BY display_name").all()
        ) as unknown as { id: number; display_name: string }[])
      : [];
  const managers =
    session.role === "owner"
      ? (plain(
          db
            .prepare("SELECT id, display_name FROM users WHERE role = 'group_manager' AND active = 1 ORDER BY display_name")
            .all()
        ) as unknown as { id: number; display_name: string }[])
      : [];

  const rates = session.role === "owner" ? readRates(db, session.organizationId).slice(0, 12) : [];
  const driverRates =
    session.role === "owner" ? readDriverRates(db, session.organizationId).slice(0, 12) : [];
  const managerOverrides =
    session.role === "owner" ? readManagerOverrides(db, session.organizationId).slice(0, 12) : [];

  return (
    <>
    <PageHeader route="/sales/commission" />
    <div className="flex flex-col gap-[var(--space-5)]">
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
        دوره {faJalaliDate(period.from)} تا {faJalaliDate(period.to)} · پورسانت فروشنده و
        راننده روی وزن تحویل‌شده حساب می‌شود، نه سفارش‌شده.
      </p>

      {/* ---- فروشنده‌ها ---------------------------------------------------- */}
      {statements.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
          هنوز فروشنده‌ای ثبت نشده است.
        </p>
      ) : (
        <div className="pcards">
          {statements.map((s) => (
            <EarnerCard
              key={s.salesperson_user_id}
              id={s.salesperson_user_id}
              displayName={s.display_name}
              subLabel={`${faNum(s.kg)} کیلو در این دوره`}
              accruedToman={s.accrued_toman}
              paidToman={s.paid_toman}
              owedToman={s.owed_toman}
              lineNoun="سفارش"
              lines={s.orders.map((o) => ({ key: o.order_id, who: o.customer_name, kg: o.kg, amount_toman: o.accrual_toman }))}
            />
          ))}
        </div>
      )}

      {/* ---- راننده‌ها ------------------------------------------------------ */}
      {driverStatements.length > 0 && (
        <>
          <h2 className="sechead__title">پورسانت راننده‌ها</h2>
          <div className="pcards">
            {driverStatements.map((s) => (
              <EarnerCard
                key={s.driver_user_id}
                id={s.driver_user_id}
                displayName={s.display_name}
                subLabel={`${faNum(s.kg)} کیلو تحویل‌شده در این دوره`}
                accruedToman={s.accrued_toman}
                paidToman={s.paid_toman}
                owedToman={s.owed_toman}
                lineNoun="تحویل"
                lines={s.stops.map((st) => ({ key: st.order_id, who: st.customer_name, kg: st.kg, amount_toman: st.accrual_toman }))}
              />
            ))}
          </div>
        </>
      )}

      {/* ---- مدیران گروه ------------------------------------------------------
          A percentage of the group's total, not a weight -- so the card says the
          arithmetic in words instead of pretending it is one more EarnerCard. */}
      {managerStatements.length > 0 && (
        <>
          <h2 className="sechead__title">پورسانت مدیران گروه</h2>
          <div className="pcards">
            {managerStatements.map((m) => (
              <article className="pcard" key={m.manager_user_id}>
                <header className="pcard__head">
                  <Avatar userId={m.manager_user_id} name={m.display_name} size={46} className="pcard__av" />
                  <div className="min-w-0">
                    <h2>{m.display_name}</h2>
                    <div className="pcard__sub mono">
                      {m.group_name ?? "بدون گروه"} · {faNum(m.override_pct)}٪ از فروش گروه
                    </div>
                  </div>
                </header>

                <div className="pcard__big mono">
                  {faNum(m.accrued_toman)}
                  <small>تومان پورسانت</small>
                </div>

                <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  گروه در این دوره {faToman(m.group_accrued_toman)} پورسانت فروشنده انباشته — سهم شما
                  {" "}{faNum(m.override_pct)}٪ آن است.
                </p>

                <dl className="pcard__grid">
                  <div>
                    <dt>پرداخت‌شده</dt>
                    <dd className="mono">{faToman(m.paid_toman)}</dd>
                  </div>
                  <div>
                    <dt>مانده</dt>
                    <dd className="mono" style={{ color: m.owed_toman > 0 ? "var(--accent)" : "var(--sage)" }}>
                      {faToman(m.owed_toman)}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}

      {session.role === "owner" && (
        <CommissionEditor sellers={sellers} drivers={drivers} managers={managers} />
      )}

      {(rates.length > 0 || driverRates.length > 0 || managerOverrides.length > 0) && (
        <section className="card p-[var(--space-4)]">
          <h2 className="sechead__title">نرخ‌های پورسانت</h2>
          <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
            نرخ‌ها پاک نمی‌شوند. هر تغییر یک سطر تازه است.
          </p>

          {rates.length > 0 && (
            <>
              <h3 className="sechead__title sechead__title--minor mt-[var(--space-4)]">فروشنده</h3>
              <ul className="mt-[var(--space-2)] flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
                {rates.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]">
                    <span className="text-[var(--text)]">{r.display_name ?? "همه فروشنده‌ها"}</span>
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {faToman(r.rate_per_kg_toman)} در هر کیلو · از {faJalaliDate(r.valid_from)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {driverRates.length > 0 && (
            <>
              <h3 className="sechead__title sechead__title--minor mt-[var(--space-4)]">راننده</h3>
              <ul className="mt-[var(--space-2)] flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
                {driverRates.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]">
                    <span className="text-[var(--text)]">{r.display_name ?? "همه راننده‌ها"}</span>
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {faToman(r.rate_per_kg_toman)} در هر کیلو · از {faJalaliDate(r.valid_from)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {managerOverrides.length > 0 && (
            <>
              <h3 className="sechead__title sechead__title--minor mt-[var(--space-4)]">مدیر گروه</h3>
              <ul className="mt-[var(--space-2)] flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
                {managerOverrides.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]">
                    <span className="text-[var(--text)]">{r.display_name ?? "همه مدیران"}</span>
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {faNum(r.override_pct)}٪ از فروش گروه · از {faJalaliDate(r.valid_from)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>    </>
  );
}
