import { REP_HEALTH_BAND_FA } from "@/lib/repo/repHealth";
import { ORDER_STATUS_LABEL } from "@/lib/orderStateMachine";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { salesDashboard, fillRateByDriver, jalaliMonthKey } from "@/lib/dashboard";
import { stockPosition } from "@/lib/purchases";
import { allStatements, statementFor } from "@/lib/commissionLedger";
import { allDriverStatements } from "@/lib/driverCommissionLedger";
import { allManagerStatements, managerStatementFor } from "@/lib/managerCommissionLedger";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate, faJalaliDateTime, toJalali, jalaliToIsoDate } from "@/lib/jalali";
import { movingAverage } from "@/lib/chartScale";
import { kpiBoard, kpiHistory, newestComputedAt } from "@/lib/repo/kpiSnapshots";
import { actionCenterFor } from "@/lib/repo/actionCenter";
import { customersHealthOverview } from "@/lib/repo/health";
import { currentPeriod, shiftPeriod } from "@/lib/analysis/period";
import BarChart from "@/components/charts/BarChart";
import SplineChart from "@/components/charts/SplineChart";
import DonutChart from "@/components/charts/DonutChart";
import CollapsibleSection from "@/components/CollapsibleSection";
import GradientStat from "@/components/meridian/GradientStat";
import CountUp from "@/components/meridian/CountUp";
import ActionCenter from "@/components/analysis/ActionCenter";
import KpiStrip from "@/components/analysis/KpiStrip";
import MarginTable from "@/components/analysis/MarginTable";
import SweepButton from "@/components/SweepButton";
import PageHeader from "@/components/meridian/PageHeader";
import CoveragePanels from "@/components/analysis/CoveragePanels";
import { coverageAnalytics } from "@/lib/repo/coverageAnalytics";
import { isVanRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/* ORDER_STATUS_LABEL, not a local map: a local one keyed `draft`/`delivered` never
   matched the real, uppercase statuses and printed «DELIVERED» to Persian readers. */
const STATUS_LABEL = ORDER_STATUS_LABEL as Record<string, string>;

const BAND_LABEL = REP_HEALTH_BAND_FA as Record<string, string>;

const pct = (n: number) => `${faNum(Math.round(n * 100))}٪`;

/** «۳٫۷م» rather than «۳٬۷۲۶٬۵۰۰ تومان». A bar label has about six characters of room
 *  before it collides with its neighbour, and the exact figure is a tap away in the
 *  tooltip and spelled out in the data table underneath.
 *
 *  Everything from a hundred thousand upward is expressed in millions, including
 *  «۰٫۸م». Switching unit partway down a chart -- thousands for the short bars,
 *  millions for the tall ones -- makes two bars look comparable when one is a thousand
 *  times the other, which is the single worst thing a chart can do.
 */
function compactToman(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${faNum(Math.round(n / 100_000_000) / 10)} میلیارد`;
  if (abs >= 100_000) return `${faNum(Math.round(n / 100_000) / 10)}م`;
  return faNum(n);
}

export default async function DashboardPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const db = getDb();
  const d = salesDashboard(db, session);

  const today = toJalali(new Date().toISOString())!;
  const period = {
    from: jalaliToIsoDate(today.jy, today.jm, 1),
    to: jalaliToIsoDate(today.jy, today.jm, today.jd),
  };

  const groupId = session.role === "owner" ? undefined : session.groupId;

  const commission =
    session.role === "phone_sales"
      ? [statementFor(db, session.user.id, period)]
      : allStatements(db, period, { groupId });
  // A فروشنده sees none of this -- someone else's earnings, driver or manager, are
  // none of their business, the same boundary /sales/commission itself draws.
  const driverCommission = session.role === "phone_sales" ? [] : allDriverStatements(db, period, { groupId });
  const managerCommission =
    session.role === "owner"
      ? allManagerStatements(db, period)
      : session.role === "group_manager"
        ? [managerStatementFor(db, session.user.id, period)]
        : [];
  const owedTotal =
    commission.reduce((sum, c) => sum + c.owed_toman, 0) +
    driverCommission.reduce((sum, c) => sum + c.owed_toman, 0) +
    managerCommission.reduce((sum, c) => sum + c.owed_toman, 0);

  const stock = session.role === "phone_sales" ? [] : stockPosition(db);
  const stockValue = stock.reduce((sum, r) => sum + r.value_toman, 0);
  const negatives = stock.filter((r) => r.negative);

  const drivers = session.role === "phone_sales" ? [] : fillRateByDriver(db, session);

  /* ── پوشش و میدان — the former standalone /analytics, folded in.
     Whole-group coverage, dormancy and cost-to-serve. proxy.ts denied a فروشنده the old
     page for exactly this reason, and folding it into a page they CAN reach would have
     handed them the aggregate by the back door -- so the read itself is skipped, not
     just the markup. One clock for the whole section, so its day boundaries agree. */
  const coverageNow = new Date();
  const coverage = session.role === "phone_sales" ? null : coverageAnalytics(session, coverageNow, db);

  const newThisMonth = d.new_customers_by_month.find((p) => p.key === jalaliMonthKey(period.to))?.value ?? 0;

  const empty = "هنوز داده‌ای برای این نمودار نیست";

  // ── تحلیل عمیق — the former /sales/analysis page, folded in below the KPI tiles.
  const aPeriod = currentPeriod();
  const aPrev = shiftPeriod(aPeriod, 1);
  const kpiCards = kpiBoard(session.organizationId, aPeriod, aPrev, session);
  /* Six periods of every metric for the KPI bar's sparklines, oldest first (item 10). */
  const kpiTrends = kpiHistory(
    session.organizationId,
    [5, 4, 3, 2, 1, 0].map((n) => shiftPeriod(aPeriod, n)),
    session,
  );
  const buckets = actionCenterFor(session);
  const health = customersHealthOverview(session);
  const kpiComputedAt = newestComputedAt(session.organizationId, aPeriod);
  const isManager = session.role === "owner" || session.role === "group_manager";
  const bandCounts = health.reduce<Record<string, number>>((acc, h) => {
    acc[h.band] = (acc[h.band] ?? 0) + 1;
    return acc;
  }, {});
  const risky = health.filter((h) => h.band === "risk").slice(0, 8);

  return (
    <>
    <PageHeader route="/sales/dashboard" />
    <div className="flex flex-col gap-[var(--space-5)]">
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
        همه ارقام بر اساس مقدار تحویل‌شده است — نه سفارش‌شده. تا {faJalaliDate(period.to)}.
      </p>

      {/* The wash is decoration and grouping, nothing more: it gives the four tiles
          distinct identities so the row scans as four things rather than one block. It
          deliberately does NOT encode good or bad -- the note says that in words, and
          letting two systems both grade the same tile is how a dashboard ends up saying
          two contradictory things at once. */}
      {/* The headline figures live on /sales now — this tab is the deeper cut. The row is
          kept because the breakdowns below are read against it. */}
      <div className="statrow">
        <GradientStat
          tone="peach"
          label="فروش (تحویل‌شده)"
          value={<CountUp value={d.revenue_toman} />}
          unit="تومان"
          chip={`${faNum(d.order_count)} سفارش · میانگین ${faToman(d.average_order_toman)}`}
        />
        <GradientStat
          tone="mint"
          small
          icon="truck"
          label="نرخ تحویل"
          value={<CountUp value={d.fill_rate} mode="pct" />}
          chip={
            d.fill_rate > 0 && d.fill_rate < 0.9
              ? "زیر ۹۰٪ — تحویل‌شده به سفارش‌شده"
              : "تحویل‌شده به سفارش‌شده"
          }
          chipTone="sky"
        />
        <GradientStat
          tone="sand"
          small
          icon="banknote"
          label="مانده حساب مشتریان"
          value={<CountUp value={d.debt.total} />}
          unit="تومان"
          chip={
            d.debt.over_30 > 0
              ? `${faToman(d.debt.over_30)} بالای ۳۰ روز`
              : "چیزی بالای ۳۰ روز نمانده"
          }
          chipTone="amber"
        />
      </div>

      {/* Cost is never shown anywhere a فروشنده can reach -- PurchaseEntry gates entering
          it the same way. Profit is exactly the number a stakeholder wants that a revenue
          figure alone cannot answer, so it gets a card of its own rather than a clause
          buried in the revenue chip. Sized 1fr rather than sharing .statrow's validated
          1.5fr/1fr/1fr split, which assumes exactly three cards. */}
      {session.role !== "phone_sales" && (
        <div className="statrow" style={{ marginTop: -4 }}>
          <GradientStat
            tone="peach"
            small
            icon="target"
            label="سود ناخالص (تحویل‌شده)"
            value={<CountUp value={d.margin_toman} />}
            unit="تومان"
            chip={`حاشیهٔ سود ${pct(d.revenue_toman > 0 ? d.margin_toman / d.revenue_toman : 0)} از فروش`}
          />
        </div>
      )}

      {/* Two operational figures a revenue chart cannot answer: how long a customer
          waits, and whether the customer base is actually growing or just repeating.
          Visible to everyone -- neither is cost, so there is nothing here a فروشنده
          should not see. */}
      <div className="statrow" style={{ marginTop: -4 }}>
        <GradientStat
          tone="sand"
          small
          icon="clock"
          label="میانگین زمان تحویل"
          value={d.avg_lead_days === null ? "—" : `${faNum(Math.round(d.avg_lead_days * 10) / 10)}`}
          unit={d.avg_lead_days === null ? undefined : "روز"}
          chip={d.avg_lead_days === null ? "هنوز سفارش تحویل‌شده‌ای با تاریخ تحویل ثبت نشده" : "از ثبت سفارش تا تحویل"}
        />
        <GradientStat
          tone="mint"
          small
          icon="sparkle"
          label="مشتریان جدید این ماه"
          value={<CountUp value={newThisMonth} suffix=" مشتری" />}
          chip="اولین سفارش عمر مشتری در این ماه بوده"
        />
      </div>

      {/* ── تحلیل عمیق — snapshot KPIs, the action centre, margins and customer health.
          Was its own /sales/analysis tab; it reads the same figures against the same
          period and belongs next to the dashboard it was always compared with. */}
      <section className="flex flex-col gap-[var(--space-4)]">
        <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
          <h2
            className="sechead__title"
            style={{ fontFamily: "var(--font-display)" }}
          >
            تحلیل عمیق
          </h2>
          <div className="flex items-center gap-[var(--space-2)]">
            <span className="text-[length:var(--text-xs)] text-[var(--text-faint)]">
              {kpiComputedAt ? `عددها تا ${faJalaliDateTime(kpiComputedAt)}` : "هنوز محاسبه نشده"}
            </span>
            {isManager && (
              <SweepButton endpoint="/api/analysis/refresh" idleLabel="به‌روزرسانی تحلیل" />
            )}
          </div>
        </div>

        <ActionCenter buckets={buckets} />
        <KpiStrip cards={kpiCards} period={aPeriod} trends={kpiTrends} />
        {isManager && <MarginTable period={aPeriod} />}

        <div className="kblock" dir="rtl">
          <div className="bhead">
            <h2>سلامت مشتری</h2>
            <div className="n">
              خوب {faNum(bandCounts.good ?? 0)} · مراقبت {faNum(bandCounts.watch ?? 0)} · پرخطر{" "}
              {faNum(bandCounts.risk ?? 0)}
            </div>
          </div>
          <div className="kblock__body">
            {risky.length === 0 ? (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">مشتری پرخطری ندارید.</p>
            ) : (
              <ul className="m-0 list-none p-0 text-[length:var(--text-sm)]">
                {risky.map((h) => (
                  <li
                    key={h.customer_id}
                    className="flex items-center justify-between border-b border-[var(--border)] py-[var(--space-1)]"
                  >
                    <span className="text-[var(--text)]">{h.business_name}</span>
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {faNum(h.score)} · {BAND_LABEL[h.band]} · {h.reasons[0] ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <CollapsibleSection title="روند فروش و مشتریان" icon="trend" storageKey="dash-trends">
        <div className="grid gap-[var(--space-4)] md:grid-cols-2">
          <BarChart
            title="فروش به تفکیک روز هفته"
            barLabel={compactToman}
            subtitle="شنبه تا جمعه"
            data={d.revenue_by_weekday.map((p) => ({ label: p.label, value: p.value }))}
            formatValue={faToman}
            colorful
            empty={empty}
          />
          <BarChart
            title="پرفروش‌ترین کالاها بر اساس وزن"
            subtitle="کیلوگرم، نه تومان -- ترتیب می‌تواند با «فروش هر کالا» فرق کند"
            data={d.top_products_by_kg.map((p) => ({ label: p.label, value: p.value }))}
            formatValue={(v) => `${faNum(v)} کیلو`}
            colorful
            empty={empty}
          />
          <BarChart
            title="مشتریان جدید"
            subtitle="بر اساس ماه شمسیٔ اولین سفارش"
            data={d.new_customers_by_month.map((p) => ({ label: p.label, value: p.value }))}
            formatValue={(v) => faNum(v)}
            empty={empty}
          />
        </div>
      </CollapsibleSection>

      {/* dash-top: a marker for RevealRoute, not a style hook. These two charts sit
          outside any CollapsibleSection, but the ones further down do not -- an
          unqualified `.card` selector would catch a chart nested inside a `.sect` too,
          animating it on a second clock the instant its section opens. Scoping to this
          wrapper is the same combinator trick /sales/schedule uses for `.sched > .kblock`. */}
      <div className="dash-top grid gap-[var(--space-4)] md:grid-cols-2">
        <SplineChart
          title="فروش روزانه"
          subtitle="۳۰ روز اخیر"
          labels={d.revenue_by_day.map((p) => faJalaliDate(p.key))}
          series={[
            { label: "فروش روز", values: d.revenue_by_day.map((p) => p.value) },
            // Same unit and the same axis: the line each day is doing better or worse
            // than, not a second measure smuggled onto one chart.
            {
              label: "میانگین ۷ روزه",
              values: movingAverage(d.revenue_by_day.map((p) => p.value), 7),
              dashed: true,
            },
          ]}
          formatValue={faToman}
          empty={empty}
        />
        <BarChart
          title="فروش ماهانه"
          barLabel={compactToman}
          subtitle="بر اساس ماه شمسی"
          data={d.revenue_by_month.map((p) => ({ label: p.label, value: p.value }))}
          formatValue={faToman}
          empty={empty}
        />
      </div>

      <CollapsibleSection title="فروش به تفکیک" icon="chart" storageKey="dash-breakdown" defaultOpen>
        <div className="grid gap-[var(--space-4)] md:grid-cols-2">
          <BarChart
            title="فروش هر کالا"
          barLabel={compactToman}
            data={d.revenue_by_product.map((p) => ({ label: p.label, value: p.value }))}
            formatValue={faToman}
            colorful
            empty={empty}
          />
          <BarChart
            title="مشتریان برتر"
          barLabel={compactToman}
            data={d.top_customers.map((p) => ({ label: p.label, value: p.value }))}
            formatValue={faToman}
            empty={empty}
          />
          {session.role !== "phone_sales" && (
            <BarChart
              title="فروش هر فروشنده"
          barLabel={compactToman}
              data={d.revenue_by_salesperson.map((p) => ({ label: p.label, value: p.value }))}
              formatValue={faToman}
              colorful
              empty={empty}
            />
          )}
          <DonutChart
            title="وضعیت سفارش‌ها"
            data={d.status_mix.map((p) => ({
              label: STATUS_LABEL[p.key] ?? "نامشخص",
              value: p.value,
            }))}
            formatValue={(v) => faNum(v)}
            centreLabel="سفارش"
            empty={empty}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="بدهی و پورسانت" icon="wallet" storageKey="dash-money">
        <p className="m-0 mb-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
          مانده کل پورسانت -- فروشنده، راننده و مدیر گروه با هم -- {faToman(owedTotal)}.
        </p>
        <div className="grid gap-[var(--space-4)] md:grid-cols-2">
          <DonutChart
            title="سن بدهی"
            data={[
              { label: "۰ تا ۷ روز", value: d.debt.d0_7, color: "var(--good)" },
              { label: "۸ تا ۳۰ روز", value: d.debt.d8_30, color: "var(--warn)" },
              { label: "بالای ۳۰ روز", value: d.debt.over_30, color: "var(--crit)" },
            ]}
            formatValue={faToman}
            centreLabel="تومان"
            empty={empty}
          />
          <BarChart
            title="پورسانت فروشنده‌ها"
            barLabel={compactToman}
            subtitle={`مانده ${faToman(commission.reduce((sum, c) => sum + c.owed_toman, 0))}`}
            data={commission.map((c) => ({ label: c.display_name, value: c.accrued_toman }))}
            formatValue={faToman}
            colorful
            empty={empty}
          />
          {driverCommission.length > 0 && (
            <BarChart
              title="پورسانت راننده‌ها"
              barLabel={compactToman}
              subtitle={`مانده ${faToman(driverCommission.reduce((sum, c) => sum + c.owed_toman, 0))}`}
              data={driverCommission.map((c) => ({ label: c.display_name, value: c.accrued_toman }))}
              formatValue={faToman}
              colorful
              empty={empty}
            />
          )}
          {managerCommission.length > 0 && (
            <BarChart
              title="پورسانت مدیران گروه"
              barLabel={compactToman}
              subtitle={`مانده ${faToman(managerCommission.reduce((sum, c) => sum + c.owed_toman, 0))}`}
              data={managerCommission.map((c) => ({ label: c.display_name, value: c.accrued_toman }))}
              formatValue={faToman}
              colorful
              empty={empty}
            />
          )}
        </div>
      </CollapsibleSection>

      {session.role !== "phone_sales" && (
        <CollapsibleSection title="انبار و تحویل" icon="package" storageKey="dash-stock">
          <div className="grid gap-[var(--space-4)] md:grid-cols-2">
            <BarChart
              title="موجودی انبار"
              subtitle={`ارزش ${faToman(stockValue)}${
                negatives.length ? ` · ${faNum(negatives.length)} کالای منفی` : ""
              }`}
              data={stock.map((r) => ({
                label: r.name,
                value: r.on_hand,
                color: r.negative ? "var(--crit)" : undefined,
              }))}
              formatValue={(v) => faNum(v)}
              empty={empty}
            />
            <BarChart
              title="نرخ تحویل هر راننده"
              subtitle="درصد بسته‌های تحویل‌شده از سفارش‌شده"
              data={drivers.map((r) => ({ label: r.label, value: r.value }))}
              formatValue={(v) => `${faNum(v)}٪`}
              barLabel={(v) => `${faNum(v)}٪`}
              /* Against a fixed 100, not against the best driver: scaled to its own
                 maximum, 95% and 100% draw almost the same bar and the gap disappears. */
              max={100}
              colorful
              empty={empty}
            />
          </div>
        </CollapsibleSection>
      )}

      {coverage && (
        <CollapsibleSection title="پوشش و میدان" icon="compass" storageKey="dash-coverage">
          <CoveragePanels data={coverage} now={coverageNow} />
        </CollapsibleSection>
      )}
    </div>    </>
  );
}
