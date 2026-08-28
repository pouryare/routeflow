import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orderFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { salesDashboard } from "@/lib/dashboard";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import GradientStat from "@/components/kargah/GradientStat";
import SalesSpark, { type SparkPoint } from "@/components/kargah/SalesSpark";
import CarvedCard from "@/components/kargah/CarvedCard";

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
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const d = salesDashboard(db, session);

  /* Both dates from ONE clock read. Two separate reads can straddle midnight and make
     "yesterday" the same day as "today". */
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const today = d.revenue_by_day.find((p) => p.key === todayIso)?.value ?? 0;
  const yesterdayIso = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const yesterday = d.revenue_by_day.find((p) => p.key === yesterdayIso)?.value ?? 0;
  const delta = yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100) : null;

  const byStatus = new Map(d.status_mix.map((s) => [s.key, s.value]));
  const awaiting = byStatus.get("confirmed") ?? 0;

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

  /* Who took today's orders, and how many each. The cradle's avatars are people, so this
     is the one figure on the screen that is about the team rather than the money. */
  const scope = orderFilter(session);
  const team = plain(
    db
      .prepare(
        `SELECT COALESCE(u.display_name, 'بدون فروشنده') AS name, COUNT(*) AS n
           FROM orders o
           LEFT JOIN users u ON u.id = o.salesperson_user_id
          WHERE o.order_date = ?${scope.sql}
          GROUP BY o.salesperson_user_id
          ORDER BY n DESC
          LIMIT 5`
      )
      .all(todayIso, ...scope.params)
  ) as unknown as { name: string; n: number }[];
  const todayOrders = team.reduce((sum, t) => sum + t.n, 0);

  const AV_TONE = ["plum", "sage", "sky", "amber", "accent"] as const;

  return (
    <>
      <div className="statrow">
        <GradientStat
          tone="peach"
          label="فروش امروز"
          value={faNum(today)}
          unit="تومان"
          chip={
            delta === null
              ? `از ابتدا ${faToman(d.revenue_toman)}`
              : `${delta >= 0 ? "▲" : "▼"} ${faNum(Math.abs(delta))}٪ نسبت به دیروز`
          }
        />
        <GradientStat
          tone="mint"
          small
          icon="◷"
          label="در انتظار تحویل"
          value={`${faNum(awaiting)} سفارش`}
          chip={`${faNum(Math.round(d.kg))} کیلو · نرخ تحویل ${faNum(Math.round(d.fill_rate * 100))}٪`}
          chipTone="sky"
        />
        <GradientStat
          tone="sand"
          small
          icon="₸"
          label="مانده حساب مشتریان"
          value={fa1(d.debt.total / M)}
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
                {team.map((t, i) => (
                  <div
                    key={t.name}
                    className="av"
                    title={t.name}
                    style={{
                      background: `var(--${AV_TONE[i % AV_TONE.length]}-soft)`,
                      color: `var(--${AV_TONE[i % AV_TONE.length]})`,
                    }}
                  >
                    {t.name.trim()[0]}
                    <span className="badge mono">{faNum(t.n)}</span>
                  </div>
                ))}
              </>
            )
          }
        >
          <h2>تیم فروش امروز</h2>
          <p>
            {todayOrders === 0
              ? "امروز هنوز سفارشی ثبت نشده است."
              : `${faNum(todayOrders)} سفارش بین ${faNum(team.length)} نفر پخش شده — عدد روی هر نفر، تعداد سفارش‌های اوست.`}
          </p>
        </CarvedCard>
      </div>
    </>
  );
}
