import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { salesDashboard, fillRateByDriver } from "@/lib/dashboard";
import { stockPosition } from "@/lib/purchases";
import { allStatements, statementFor } from "@/lib/commissionLedger";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate, toJalali, jalaliToIsoDate } from "@/lib/jalali";
import { movingAverage } from "@/lib/chartScale";
import BarChart from "@/components/charts/BarChart";
import SplineChart from "@/components/charts/SplineChart";
import DonutChart from "@/components/charts/DonutChart";
import CollapsibleSection from "@/components/CollapsibleSection";
import Reveal from "@/components/kargah/Reveal";
import GradientStat from "@/components/kargah/GradientStat";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "پیش‌نویس",
  confirmed: "تأییدشده",
  delivered: "تحویل‌شده",
  cancelled: "لغوشده",
};

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
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const d = salesDashboard(db, session);

  const today = toJalali(new Date().toISOString())!;
  const period = {
    from: jalaliToIsoDate(today.jy, today.jm, 1),
    to: jalaliToIsoDate(today.jy, today.jm, today.jd),
  };

  const commission =
    session.role === "salesperson"
      ? [statementFor(db, session.user.id, period)]
      : allStatements(db, period, {
          groupId: session.role === "owner" ? undefined : session.groupId,
        });
  const owedTotal = commission.reduce((sum, c) => sum + c.owed_toman, 0);

  const stock = session.role === "salesperson" ? [] : stockPosition(db);
  const stockValue = stock.reduce((sum, r) => sum + r.value_toman, 0);
  const negatives = stock.filter((r) => r.negative);

  const drivers = session.role === "salesperson" ? [] : fillRateByDriver(db, session);

  const empty = "هنوز داده‌ای برای این نمودار نیست";

  return (
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
      <Reveal replayKey="dash-stats" className="statrow">
        <GradientStat
          tone="peach"
          label="فروش (تحویل‌شده)"
          value={faNum(d.revenue_toman)}
          unit="تومان"
          chip={`${faNum(d.order_count)} سفارش · میانگین ${faToman(d.average_order_toman)}`}
        />
        <GradientStat
          tone="mint"
          small
          icon="⇄"
          label="نرخ تحویل"
          value={pct(d.fill_rate)}
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
          icon="₸"
          label="مانده حساب مشتریان"
          value={faNum(d.debt.total)}
          unit="تومان"
          chip={
            d.debt.over_30 > 0
              ? `${faToman(d.debt.over_30)} بالای ۳۰ روز`
              : "چیزی بالای ۳۰ روز نمانده"
          }
          chipTone="amber"
        />
      </Reveal>

      <div className="grid gap-[var(--space-4)] md:grid-cols-2">
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

      <CollapsibleSection title="فروش به تفکیک" icon="📊" storageKey="dash-breakdown" defaultOpen>
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
          {session.role !== "salesperson" && (
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
              label: STATUS_LABEL[p.key] ?? p.key,
              value: p.value,
            }))}
            formatValue={(v) => faNum(v)}
            centreLabel="سفارش"
            empty={empty}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="بدهی و پورسانت" icon="💰" storageKey="dash-money">
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
            title="پورسانت این ماه"
          barLabel={compactToman}
            subtitle={`مانده کل ${faToman(owedTotal)}`}
            data={commission.map((c) => ({ label: c.display_name, value: c.accrued_toman }))}
            formatValue={faToman}
            colorful
            empty={empty}
          />
        </div>
      </CollapsibleSection>

      {session.role !== "salesperson" && (
        <CollapsibleSection title="انبار و تحویل" icon="📦" storageKey="dash-stock">
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
    </div>
  );
}
