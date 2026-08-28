import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, groupFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { faNum } from "@/lib/format";
import { toJalali, JALALI_MONTHS, jalaliToIsoDate, faJalaliDate } from "@/lib/jalali";
import ScheduleMonth from "@/components/kargah/ScheduleMonth";

export const dynamic = "force-dynamic";

/** برنامهٔ روز — the artifact's fifth screen.
 *
 *  The artifact carried a notice saying this screen had no data behind it. It does now,
 *  but only what the schema actually records: delivery_runs are real rows with a date, a
 *  driver and a stop count, so the month marks and the day rail are read from them. What
 *  is still NOT here is customer visits — visit_plans exists, but deciding whether "the
 *  day's plan" means routes, visits, or both is a product decision, not a layout one, so
 *  the notice says so rather than the screen inventing an answer.
 */
export default async function SchedulePage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const scope = groupFilter(session);
  const today = toJalali(new Date().toISOString())!;

  // The whole Persian month, so the calendar's marks and the rail agree.
  const from = jalaliToIsoDate(today.jy, today.jm, 1);
  const to = jalaliToIsoDate(today.jy, today.jm, 31);

  const runs = plain(
    db
      .prepare(
        `SELECT r.id, r.run_date, r.status,
                COALESCE(u.display_name, 'بدون راننده') AS driver,
                (SELECT COUNT(*) FROM delivery_stops s WHERE s.run_id = r.id) AS stops
           FROM delivery_runs r
           LEFT JOIN users u ON u.id = r.driver_user_id
          WHERE r.run_date >= ? AND r.run_date <= ?${scope.sql.replaceAll("c.group_id", "r.group_id")}
          ORDER BY r.run_date, r.id`
      )
      .all(from, to, ...scope.params)
  ) as unknown as { id: number; run_date: string; status: string; driver: string; stops: number }[];

  const todayIso = jalaliToIsoDate(today.jy, today.jm, today.jd);
  const forToday = runs.filter((r) => r.run_date === todayIso);

  // Which day-of-month carries work, for the calendar dots.
  const marks: Record<number, string[]> = {};
  for (const r of runs) {
    const j = toJalali(r.run_date);
    if (!j) continue;
    (marks[j.jd] ??= []).push(
      r.status === "done" ? "var(--sage)" : r.status === "in_progress" ? "var(--accent)" : "var(--sky)"
    );
  }

  const EV = ["a", "b", "c"] as const;

  return (
    <>
      <div className="notice">
        <b>این صفحه فقط مسیرهای تحویل را نشان می‌دهد.</b> جدول{" "}
        <span className="mono">visit_plans</span> هم در دیتابیس هست، ولی اینکه «برنامهٔ
        روز» ویزیت مشتری‌ها را هم دربر بگیرد یا نه، یک تصمیم دربارهٔ خودِ قابلیت است، نه
        دربارهٔ این صفحه — تا آن تصمیم گرفته نشود، اینجا چیزی از خودش نمی‌سازد.
      </div>

      <div className="sched">
        <div className="block">
          <div className="bhead">
            <div>
              <h2>
                {JALALI_MONTHS[today.jm - 1]} {faNum(today.jy)}
              </h2>
              <div className="n">نقطه‌ها یعنی آن روز مسیری ثبت شده</div>
            </div>
          </div>
          <div className="cal">
            <ScheduleMonth today={today.jd} marks={marks} />
          </div>
        </div>

        <div className="block">
          <div className="bhead">
            <div>
              <h2>{faJalaliDate(todayIso)}</h2>
              <div className="n">
                {forToday.length === 0
                  ? "امروز مسیری ثبت نشده"
                  : `${faNum(forToday.length)} مسیر تحویل · ${faNum(
                      forToday.reduce((s, r) => s + r.stops, 0)
                    )} توقف`}
              </div>
            </div>
          </div>
          <div className="rail">
            {forToday.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5 }}>
                برای امروز مسیری در دفتر نیست.
              </p>
            ) : (
              forToday.map((r, i) => (
                <div className="slot" key={r.id}>
                  <div className="h">{["۰۸:۰۰", "۱۱:۰۰", "۱۳:۰۰", "۱۶:۰۰"][i] ?? "—"}</div>
                  <div className="lane">
                    <div className={`ev ${EV[i % EV.length]}`}>
                      <span className="dot">🚚</span>
                      <div>
                        <div className="t">مسیر {r.driver}</div>
                        <div className="s">
                          {faNum(r.stops)} توقف ·{" "}
                          {r.status === "done"
                            ? "تمام شد"
                            : r.status === "in_progress"
                              ? "در حال اجرا"
                              : "برنامه‌ریزی‌شده"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
