import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { dashboardFor, teamTodayFor } from "@/lib/repo/dashboardView";
import { faToman, faNum } from "@/lib/format";
import CountUp from "@/components/meridian/CountUp";
import { faJalaliDate, tehranTodayIso } from "@/lib/jalali";
import GradientStat from "@/components/meridian/GradientStat";
import SalesSpark, { type SparkPoint } from "@/components/meridian/SalesSpark";
import CarvedCard from "@/components/meridian/CarvedCard";
import Avatar from "@/components/meridian/Avatar";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** «۱۲٫۴» — one decimal, Persian digits, Persian decimal separator. */
const fa1 = (n: number) => faNum(Math.round(n * 10) / 10).replace(".", "٫");

/** The dashboard — the artifact's first screen, on real figures.
 *
 *  Reads the same salesDashboard the deeper analytics tab uses, so the two cannot answer
 *  "what did we sell today" differently.
 */
export default async function SalesHomePage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const d = dashboardFor(session);

  /* Both dates from ONE clock read. Two separate reads can straddle midnight and make
     "yesterday" the same day as "today". */
  const now = new Date();
  const todayIso = tehranTodayIso(now);
  const today = d.revenue_by_day.find((p) => p.key === todayIso)?.value ?? 0;
  const yesterdayIso = tehranTodayIso(new Date(now.getTime() - 86_400_000));
  const yesterday = d.revenue_by_day.find((p) => p.key === yesterdayIso)?.value ?? 0;
  const delta = yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100) : null;

  const byStatus = new Map(d.status_mix.map((s) => [s.key, s.value]));
  const awaiting = byStatus.get("CONFIRMED") ?? 0;

  /* Seven days, oldest first — SalesSpark draws index 0 on the right. `revenue_by_day`
     arrives newest-first, so it is reversed once here rather than inside the chart. */
  const recent = d.revenue_by_day.slice(0, 7).reverse();
  const prior = d.revenue_by_day.slice(7, 14).reverse();
  const M = 1_000_000;
  const spark: SparkPoint[] = recent.map((p, i) => {
    const a = p.value / M;
    const b = (prior[i]?.value ?? 0) / M;
    return {
      label: faJalaliDate(p.key).slice(-5),
      a,
      b,
      aLabel: `${fa1(a)} میلیون`,
      sub: `${faJalaliDate(p.key)} · هفتهٔ پیش ${fa1(b)}`,
    };
  });
  const sparkMax = Math.max(1, ...spark.map((p) => Math.max(p.a, p.b))) * 1.15;

  /* Who took today's orders, and how many each -- plus what those orders actually add up
     to. The cradle used to show only a count; a count says three people were busy, not
     which one is carrying the day. */
  const { team, orderCount: todayOrders, peopleCount } = teamTodayFor(session, todayIso);


  return (
    <>
    <PageHeader route="/sales" />
    <>
      <div className="statrow">
        <GradientStat
          tone="peach"
          label="فروش امروز"
          value={<CountUp value={today} />}
          unit="تومان"
          chip={
            delta === null
              ? `از ابتدا ${faToman(d.revenue_toman)}`
              : `${delta >= 0 ? "+" : "−"}${faNum(Math.abs(delta))}٪ نسبت به دیروز`
          }
        />
        <GradientStat
          tone="mint"
          small
          icon="clock"
          label="در انتظار تحویل"
          value={<><CountUp value={awaiting} suffix=" سفارش" /></>}
          chip={`${faNum(Math.round(d.kg))} کیلو · نرخ تحویل ${faNum(Math.round(d.fill_rate * 100))}٪`}
          chipTone="sky"
        />
        <GradientStat
          tone="sand"
          small
          icon="banknote"
          label="مانده حساب مشتریان"
          value={<CountUp value={Math.round((d.debt.total / M) * 10) / 10} />}
          unit="میلیون"
          chip={
            d.debt.over_30 > 0
              ? `${faToman(d.debt.over_30)} بالای ۳۰ روز`
              : `${faNum(d.customer_count)} مشتری در منطقه`
          }
          chipTone="amber"
        />
      </div>

      <div>
        <div className="kblock">
          <div className="bhead">
            <div>
              <h2>روند فروش</h2>
              <div className="n">میلیون تومان در روز · نقطه‌ها را لمس کنید</div>
            </div>
            <div className="acts">
              <span className="btn ghost">هفت روز</span>
            </div>
          </div>
          {spark.length > 1 ? (
            <>
              <SalesSpark points={spark} max={sparkMax} ariaLabel="نمودار فروش هفت روز گذشته" />
              <div className="legend">
                <span><i className="sw-a" />این هفته</span>
                <span><i className="sw-b" />هفتهٔ پیش</span>
              </div>
            </>
          ) : (
            <div className="chartbox">
              <p className="m-0 py-10 text-center" style={{ color: "var(--muted)" }}>
                هنوز فروش تحویل‌شده‌ای برای رسم نمودار ثبت نشده است.
              </p>
            </div>
          )}
        </div>

        <CarvedCard
          shoulder={<>امروز <b className="mono">{faNum(todayOrders)}</b> سفارش</>}
          avatars={
            team.length === 0 ? null : (
              <>
                {team.map((t) => (
                  <Avatar key={t.name} name={t.name} count={t.n} size={28} />
                ))}
              </>
            )
          }
        >
          <h2>تیم فروش امروز</h2>
          <p>
            {todayOrders === 0
              ? "امروز هنوز سفارشی ثبت نشده است."
              : `${faNum(todayOrders)} سفارش بین ${faNum(peopleCount)} نفر پخش شده — عدد روی هر نفر، تعداد سفارش‌های اوست.`}
          </p>

          {team.length > 0 && (
            <div className="pcard__rows">
              {team.map((t) => (
                <div className="pcard__row" key={t.name}>
                  <span className="pcard__who">{t.name}</span>
                  <span className="mono">{faNum(Math.round(t.kg * 10) / 10)} کیلو</span>
                  <span className="mono pcard__amt">{faToman(t.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </CarvedCard>
      </div>
    </>    </>
  );
}
