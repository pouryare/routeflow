import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, groupFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { toJalali, jalaliToIsoDate, jalaliMonthGrid } from "@/lib/jalali";
import ScheduleBoard from "@/components/meridian/ScheduleBoard";
import { TRIP_PURPOSES, tripPurpose } from "@/lib/tripPurpose";
import PageHeader from "@/components/meridian/PageHeader";
import { Icon } from "@/components/meridian/Icon";
import { isVanRole } from "@/lib/roles";

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
  if (isVanRole(session.role)) redirect("/driver");

  const db = getDb();
  // Qualified: the runs query joins delivery_runs to users, and for an owner this
  // fragment filters on organization_id -- a column both tables carry.
  const scope = groupFilter(session, "r.group_id");
  const today = toJalali(new Date().toISOString())!;
  const grid = jalaliMonthGrid(today.jy, today.jm);

  // The whole Persian month, so the calendar's marks and the rail agree.
  const from = jalaliToIsoDate(today.jy, today.jm, 1);
  const to = jalaliToIsoDate(today.jy, today.jm, grid.days.length);

  const runs = plain(
    db
      .prepare(
        `SELECT r.id, r.run_date, r.status,
                COALESCE(u.display_name, 'بدون راننده') AS driver,
                (SELECT COUNT(*) FROM delivery_stops s WHERE s.run_id = r.id) AS stops
           FROM delivery_runs r
           LEFT JOIN users u ON u.id = r.driver_user_id
          WHERE r.run_date >= ? AND r.run_date <= ?${scope.sql}
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
    <PageHeader route="/sales/schedule" />
    <>
      <div className="legend2">
        <span className="legend2__t">هدف سفر:</span>
        {TRIP_PURPOSES.map((p) => (
          <span key={p.id} className="legend2__i" style={{ background: p.soft, color: p.ink }}>
            <Icon name={p.icon} size="sm" />
            {p.label}
          </span>
        ))}
        <span className="legend2__i legend2__i--none">بدون هدف</span>
      </div>

      <ScheduleBoard
        jy={today.jy}
        jm={today.jm}
        today={today.jd}
        leadingBlanks={grid.leadingBlanks}
        days={grid.days.length}
        runs={runs}
        visits={visits}
        marks={marks}
      />
    </>    </>
  );
}
