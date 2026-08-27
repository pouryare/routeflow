import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb } from "@/lib/db";
import { salesDashboard } from "@/lib/dashboard";
import { movingAverage } from "@/lib/chartScale";
import { faToman, faNum } from "@/lib/format";
import { faJalaliLong, faJalaliDate } from "@/lib/jalali";
import Reveal from "@/components/kargah/Reveal";
import GradientStat from "@/components/kargah/GradientStat";
import SplineChart from "@/components/charts/SplineChart";

export const dynamic = "force-dynamic";

const SHORTCUTS = [
  { href: "/sales/orders/new", label: "ثبت سفارش تازه", note: "قیمت و وزن همان لحظه ثبت می‌شود" },
  { href: "/sales/journey", label: "تابلوی سفارش‌ها", note: "پیش‌نویس‌ها را تأیید کنید" },
  { href: "/sales/runs", label: "مسیر تحویل", note: "سفارش‌ها را روی وانت بچینید" },
  { href: "/sales/stock", label: "انبار و خرید", note: "موجودی و بهای تمام‌شده" },
];

/** The سالن of the sales section: the four figures somebody wants before they have
 *  decided what they came here to do, and the shortest route to each of the four things
 *  they might have come to do.
 *
 *  Everything is read from the same salesDashboard the داشبورد tab uses, so the two
 *  cannot disagree -- a summary computing its own totals is how a system ends up with
 *  two answers to "what did we sell today".
 */
export default async function SalesHomePage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const d = salesDashboard(db, session);

  const todayIso = new Date().toISOString().slice(0, 10);
  const today = d.revenue_by_day.find((p) => p.key === todayIso)?.value ?? 0;

  const byStatus = new Map(d.status_mix.map((s) => [s.key, s.value]));
  const drafts = byStatus.get("draft") ?? 0;
  const awaiting = byStatus.get("confirmed") ?? 0;

  // Newest first, which is the order the chart wants: index 0 is drawn at the right edge.
  const days = d.revenue_by_day;
  const labels = days.map((p) => faJalaliDate(p.key));
  const values = days.map((p) => p.value);

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
        امروز، {faJalaliLong(new Date().toISOString())}
      </p>

      <Reveal
        replayKey="home-stats"
        className="grid gap-[var(--space-3)] sm:grid-cols-2 xl:grid-cols-4"
      >
        <GradientStat
          tone="peach"
          icon="☀"
          label="فروش امروز"
          value={faToman(today)}
          note={`از ابتدا ${faToman(d.revenue_toman)}`}
        />
        <GradientStat
          tone="sand"
          icon="✎"
          label="پیش‌نویس‌ها"
          value={faNum(drafts)}
          note={drafts > 0 ? "منتظر تأیید و قیمت‌گذاری" : "چیزی معطل نمانده"}
        />
        <GradientStat
          tone="sky"
          icon="⇄"
          label="در انتظار تحویل"
          value={faNum(awaiting)}
          note={`نرخ تحویل ${faNum(Math.round(d.fill_rate * 100))}٪`}
        />
        <GradientStat
          tone="mint"
          icon="⌂"
          label="مانده حساب مشتریان"
          value={faToman(d.debt.total)}
          note={
            d.debt.over_30 > 0
              ? `${faToman(d.debt.over_30)} بالای ۳۰ روز`
              /* customer_count is COUNT(*) over the territory's customers, NOT the ones
                 in debt -- a shop with no orders yet is still in it. Calling it
                 «مشتری بدهکار» printed "141 customers in debt" beside a balance of zero. */
              : `${faNum(d.customer_count)} مشتری در منطقه`
          }
        />
      </Reveal>

      <SplineChart
        title="فروش روزانه"
        subtitle="۳۰ روز اخیر · بر اساس مقدار تحویل‌شده"
        labels={labels}
        series={[
          { label: "فروش روز", values },
          // Same unit, same axis, and a genuine comparison rather than a second measure:
          // the line the day is doing better or worse than.
          { label: "میانگین ۷ روزه", values: movingAverage(values, 7), dashed: true },
        ]}
        formatValue={faToman}
        empty="هنوز تحویلی ثبت نشده است"
      />

      <section>
        <h2 className="m-0 mb-[var(--space-3)] text-[length:var(--text-md)] font-medium text-[var(--text)]">
          کارهای همیشگی
        </h2>
        <Reveal
          replayKey="home-links"
          className="grid gap-[var(--space-3)] sm:grid-cols-2 xl:grid-cols-4"
        >
          {SHORTCUTS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="block rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] no-underline shadow-[var(--sh-1)] transition-[box-shadow,transform] duration-[var(--dur-base)] hover:-translate-y-px hover:shadow-[var(--sh-2)]"
            >
              <span className="block text-[length:var(--text-base)] font-medium text-[var(--text)]">
                {s.label}
              </span>
              <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {s.note}
              </span>
            </Link>
          ))}
        </Reveal>
      </section>
    </div>
  );
}
