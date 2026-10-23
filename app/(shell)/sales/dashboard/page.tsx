import { Suspense } from "react";
import { ORDER_STATUS_LABEL } from "@/lib/orderStateMachine";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { jalaliMonthKey } from "@/lib/dashboard";
import { dashboardFor } from "@/lib/repo/dashboardView";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate, toJalali, jalaliToIsoDate } from "@/lib/jalali";
import { movingAverage } from "@/lib/chartScale";
import BarChart from "@/components/charts/BarChart";
import SplineChart from "@/components/charts/SplineChart";
import DonutChart from "@/components/charts/DonutChart";
import CollapsibleSection from "@/components/CollapsibleSection";
import GradientStat from "@/components/meridian/GradientStat";
import CountUp from "@/components/meridian/CountUp";
import PageHeader from "@/components/meridian/PageHeader";
import CoveragePanels from "@/components/analysis/CoveragePanels";
import LeadPanels from "@/components/analysis/LeadPanels";
import DeepAnalysisSection from "@/components/dashboard/DeepAnalysisSection";
import MoneySection from "@/components/dashboard/MoneySection";
import StockSection from "@/components/dashboard/StockSection";
import SectionSkeleton from "@/components/dashboard/SectionSkeleton";
import { compactToman, EMPTY_CHART } from "@/components/dashboard/format";
import { coverageAnalytics } from "@/lib/repo/coverageAnalytics";
import { PIN_POOL_ROLES, isVanRole } from "@/lib/roles";


export const dynamic = "force-dynamic";

/* ORDER_STATUS_LABEL, not a local map: a local one keyed `draft`/`delivered` never
   matched the real, uppercase statuses and printed «DELIVERED» to Persian readers. */
const STATUS_LABEL = ORDER_STATUS_LABEL as Record<string, string>;

const pct = (n: number) => `${faNum(Math.round(n * 100))}٪`;


export default async function DashboardPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const d = dashboardFor(session);

  const today = toJalali(new Date().toISOString())!;
  const period = {
    from: jalaliToIsoDate(today.jy, today.jm, 1),
    to: jalaliToIsoDate(today.jy, today.jm, today.jd),
  };



  /* ── پوشش و میدان — the former standalone /analytics, folded in.
     Whole-group coverage, dormancy and cost-to-serve. proxy.ts denied a فروشنده the old
     page for exactly this reason, and folding it into a page they CAN reach would have
     handed them the aggregate by the back door -- so the read itself is skipped, not
     just the markup. One clock for the whole section, so its day boundaries agree. */
  const coverageNow = new Date();
  const coverage = session.role === "phone_sales" ? null : coverageAnalytics(session, coverageNow);

  const newThisMonth = d.new_customers_by_month.find((p) => p.key === jalaliMonthKey(period.to))?.value ?? 0;

  const empty = EMPTY_CHART;


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

      <Suspense fallback={<SectionSkeleton height="h-96" />}>
        <DeepAnalysisSection session={session} />
      </Suspense>

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

      <Suspense fallback={<SectionSkeleton height="h-72" />}>
        <MoneySection session={session} debt={d.debt} />
      </Suspense>

      {session.role !== "phone_sales" && (
        <Suspense fallback={<SectionSkeleton height="h-64" />}>
          <StockSection session={session} />
        </Suspense>
      )}

      {coverage && (
        <CollapsibleSection title="پوشش و میدان" icon="compass" storageKey="dash-coverage">
          <CoveragePanels data={coverage} now={coverageNow} />
        </CollapsibleSection>
      )}

      {/* The pinned leads: /api/locations admits PIN_POOL_ROLES, so only they get the panel. */}
      {PIN_POOL_ROLES.includes(session.role) && (
        <CollapsibleSection title="سرنخ‌ها" icon="target" storageKey="dash-leads">
          <LeadPanels />
        </CollapsibleSection>
      )}
    </div>    </>
  );
}
