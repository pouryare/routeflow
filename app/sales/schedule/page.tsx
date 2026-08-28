import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, groupFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { faNum } from "@/lib/format";
import { toJalali, JALALI_MONTHS, jalaliToIsoDate, faJalaliDate } from "@/lib/jalali";
import ScheduleMonth from "@/components/kargah/ScheduleMonth";
import { TRIP_PURPOSES, tripPurpose } from "@/lib/tripPurpose";

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

  /* Planned visits, with what each is FOR. Joined to the customer so the rail can name
     the shop rather than an id — a plan that says "visit #418" is not a plan anyone can
     follow out of the door. */
  const visits = plain(
    db
      .prepare(
        `SELECT v.id, v.planned_date, v.status, v.purpose, v.entity_type, v.entity_id,
                COALESCE(c.business_name, d.name, 'بدون نام') AS who,
                c.city AS where_
           FROM visit_plans v
           LEFT JOIN customers c ON v.entity_type = 'customer' AND c.id = v.entity_id
           LEFT JOIN districts d ON v.entity_type = 'district' AND d.id = v.entity_id
          WHERE v.planned_date >= ? AND v.planned_date <= ?
          ORDER BY v.planned_date, v.sort_order, v.id`
      )
      .all(from, to)
  ) as unknown as {
    id: number;
    planned_date: string;
    status: string;
    purpose: string | null;
    who: string;
    where_: string | null;
  }[];

  const todayIso = jalaliToIsoDate(today.jy, today.jm, today.jd);
  const forToday = runs.filter((r) => r.run_date === todayIso);
  const visitsToday = visits.filter((v) => v.planned_date === todayIso);

  // Which day-of-month carries work, for the calendar dots.
  const marks: Record<number, string[]> = {};
  for (const r of runs) {
    const j = toJalali(r.run_date);
    if (!j) continue;
    (marks[j.jd] ??= []).push("var(--accent)");
  }
  /* A visit's dot is the colour of what it is FOR, so a month reads as a pattern of
     purposes before it reads as a count of appointments. */
  for (const v of visits) {
    const j = toJalali(v.planned_date);
    if (!j) continue;
    (marks[j.jd] ??= []).push(tripPurpose(v.purpose)?.dot ?? "var(--muted)");
  }

  return (
    <>
      <div className="legend2">
        <span className="legend2__t">هدف سفر:</span>
        {TRIP_PURPOSES.map((p) => (
          <span key={p.id} className="legend2__i" style={{ background: p.soft, color: p.ink }}>
            <span aria-hidden>{p.icon}</span>
            {p.label}
          </span>
        ))}
        <span className="legend2__i legend2__i--none">بدون هدف</span>
      </div>

      <div className="sched">
        <div className="kblock">
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

        <div className="kblock">
          <div className="bhead">
            <div>
              <h2>{faJalaliDate(todayIso)}</h2>
              <div className="n">
                {faNum(visitsToday.length)} ویزیت · {faNum(forToday.length)} مسیر تحویل
              </div>
            </div>
          </div>
          <div className="rail">
            {visitsToday.length === 0 && forToday.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5 }}>
                برای امروز نه ویزیتی برنامه‌ریزی شده و نه مسیری در دفتر است.
              </p>
            ) : (
              <>
                {visitsToday.map((v) => {
                  const p = tripPurpose(v.purpose);
                  return (
                    <div className="slot" key={`v${v.id}`}>
                      <div className="h">{p ? p.icon : "•"}</div>
                      <div className="lane">
                        <div
                          className="ev"
                          style={{
                            background: p?.soft ?? "var(--sunk)",
                            color: p?.ink ?? "var(--muted)",
                          }}
                        >
                          <span
                            className="dot"
                            style={{ background: "color-mix(in srgb, currentColor 16%, transparent)" }}
                          >
                            {p ? p.icon : "•"}
                          </span>
                          <div>
                            <div className="t">{v.who}</div>
                            <div className="s">
                              {p ? p.label : "بدون هدف"}
                              {v.where_ ? ` · ${v.where_}` : ""}
                              {v.status === "done" ? " · انجام شد" : v.status === "skipped" ? " · رد شد" : ""}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {forToday.map((r) => (
                  <div className="slot" key={`r${r.id}`}>
                    <div className="h">🚚</div>
                    <div className="lane">
                      <div className="ev a">
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
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
