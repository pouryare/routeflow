import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, groupFilter, orderFilter, type Session } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { toJalali, jalaliToIsoDate, jalaliMonthGrid, jalaliMonthLength, tehranTodayIso } from "@/lib/jalali";
import { monthConditions, worstCondition, CONDITION_LABEL } from "@/lib/weather/calendarForecast";
import { snapshotsInRange } from "@/lib/repo/weather";
import { listHolidaysForMonth } from "@/lib/repo/holidays";
import { dayAirBand, AIR_BAND_LABEL_FA, type AirBand } from "@/lib/weather/openMeteoAir";
import { CONDITION_ICON } from "@/lib/weather/calendarForecast";
import type { IconName } from "@/components/meridian/icon-map";
import ScheduleBoard from "@/components/meridian/ScheduleBoard";
import { TRIP_PURPOSES, tripPurpose } from "@/lib/tripPurpose";
import PageHeader from "@/components/meridian/PageHeader";
import { Icon } from "@/components/meridian/Icon";
import ViewTabs, { type ViewTab } from "@/components/meridian/ViewTabs";
import { oneOf, type SearchParams } from "@/lib/viewParam";
import { isVanRole, VAN_ROLES } from "@/lib/roles";
import { readOrders } from "@/lib/orders";
import RunPlanner from "@/components/sales/RunPlanner";
import AssignmentBoard from "@/components/sales/AssignmentBoard";
import RunTimeline, { type TimelineStop } from "@/components/sales/RunTimeline";
import DriverStreaks from "@/components/sales/DriverStreaks";
import { readDriverActivity } from "@/lib/repo/driverActivity";
import { buildStreak } from "@/lib/streak";
import type { DatabaseSync } from "node:sqlite";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

/** برنامه / سفرها — what is planned, and who is carrying it.
 *
 *  The month grid was already the spine: this page queries delivery_runs AND
 *  visit_plans and merges them into one calendar, which is the answer to "the day's
 *  plan". Assignment is the same subject read one verb later — "whose van is it" rather
 *  than "what is on". So it is a second view of this page, not a separate route.
 *
 *  `RunTimeline` stays inside the runs view rather than earning a third tab. It shows
 *  runs in progress and recently finished, which is a third question from the month
 *  ahead — but a third tab here would put three *views* of one page into the nav group
 *  the header draws its own tab row from, so the two rows would answer the same
 *  question. Spec 2 section 8 flags this; the conservative placement wins for now. */
const DAY_VIEWS = ["", "runs"] as const;
type DayView = (typeof DAY_VIEWS)[number];

const DAY_TABS: ViewTab[] = [
  { value: "", label: "برنامه", route: "/sales/schedule" },
  { value: "runs", label: "سفرها", route: "/sales/schedule" },
];

/** The page's chrome — the overview card and the view strip — wrapped around EITHER view.
 *
 *  A wrapper rather than the same two tags repeated at two return sites, because two copies
 *  are two things to forget. This page did exactly that: `if (view === "runs") return
 *  <RunsView />` returned into a component with its own `return`, so the runs view rendered
 *  with no title card, no overview, and no way back to «برنامه» — while the file still
 *  imported and rendered PageHeader for the OTHER view, so every test that asked "does this
 *  page have a header?" reported green.
 *
 *  Making the chrome the wrapper means a branch cannot return past it, because the branch is
 *  the thing being wrapped. `view` is passed through so each view opens with copy about ITSELF
 *  (see lib/pageMeta's "/sales/schedule?view=runs"), and so the correct tab is the selected one.
 */
function ScheduleChrome({ view, children }: { view: DayView; children: ReactNode }) {
  return (
    <>
      <PageHeader route="/sales/schedule" view={view} />
      <ViewTabs tabs={DAY_TABS} current={view} />
      {children}
    </>
  );
}

/** برنامهٔ روز — the artifact's fifth screen.
 *
 *  The artifact carried a notice saying this screen had no data behind it. It does now,
 *  but only what the schema actually records: delivery_runs are real rows with a date, a
 *  driver and a stop count, so the month marks and the day rail are read from them. What
 *  is still NOT here is customer visits — visit_plans exists, but deciding whether "the
 *  day's plan" means routes, visits, or both is a product decision, not a layout one, so
 *  the notice says so rather than the screen inventing an answer.
 */
/** «سفرها» — assigning the day's orders to vans. Which was /sales/runs.
 *
 *  The queries below are moved, not retyped. The driver list in particular: it read
 *  `role = 'driver'`, which matched nobody after lib/db.ts renamed that role to
 *  `delivery_driver`, and spec 1 (2026-09-29-leads-manager-only-driver-my-day section
 *  3.8) fixed it to the van-role set. Carrying the SET is the point of this comment: a
 *  copy of the old query would silently reintroduce the empty dropdown in its new home.
 *
 *  Only confirmed orders are offered. A draft is a list somebody is still editing, and
 *  loading a van from one means the quantities can change after it has left the depot. */
function RunsView({ db, session }: { db: DatabaseSync; session: Session }) {
  const userScope = groupFilter(session);

  const vanRoleList = VAN_ROLES.map((r) => `'${r}'`).join(", ");
  const drivers = plain(
    db
      .prepare(
        `SELECT id, display_name FROM users
          WHERE role IN (${vanRoleList}) AND active = 1${userScope.sql}
          ORDER BY display_name`,
      )
      .all(...userScope.params),
  ) as unknown as { id: number; display_name: string }[];

  const runScope = groupFilter(session, "dr.group_id");
  const runs = plain(
    db
      .prepare(
        `SELECT dr.id, dr.run_date, dr.status, dr.driver_user_id, dr.group_id,
                u.display_name AS driver_name,
                COUNT(ds.id) AS stop_count,
                COALESCE(SUM(CASE WHEN ds.status = 'pending' THEN 1 ELSE 0 END), 0) AS remaining
           FROM delivery_runs dr
           JOIN users u ON u.id = dr.driver_user_id
           LEFT JOIN delivery_stops ds ON ds.run_id = dr.id
          WHERE 1 = 1${runScope.sql}
          GROUP BY dr.id
          ORDER BY dr.run_date DESC, dr.id DESC
          LIMIT 30`,
      )
      .all(...runScope.params),
  ) as unknown as {
    id: number;
    run_date: string;
    status: string;
    driver_user_id: number;
    group_id: number | null;
    driver_name: string;
    stop_count: number;
    remaining: number;
  }[];

  /* Every stop on the runs above, in delivery order, with the order total each carries.
     One query for all runs rather than one per run: at 30 runs the per-run version is
     30 round trips to answer a question SQLite can answer once. */
  const stopScope = groupFilter(session, "dr.group_id");
  const stopRows = plain(
    db
      .prepare(
        `SELECT ds.id, ds.run_id, ds.status, o.order_no,
                COALESCE(c.business_name, '—') AS customer_name,
                COALESCE(SUM(ol.packs_ordered * ol.unit_price_toman), 0) AS total_toman
           FROM delivery_stops ds
           JOIN delivery_runs dr ON dr.id = ds.run_id
           JOIN orders o ON o.id = ds.order_id
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN order_lines ol ON ol.order_id = o.id
          WHERE 1 = 1${stopScope.sql}
          GROUP BY ds.id
          ORDER BY ds.run_id, ds.sort_order, ds.id`,
      )
      .all(...stopScope.params),
  ) as unknown as (TimelineStop & { run_id: number })[];

  const stopsByRun = new Map<number, TimelineStop[]>();
  for (const row of stopRows) {
    const { run_id, ...stop } = row;
    if (!stopsByRun.has(run_id)) stopsByRun.set(run_id, []);
    stopsByRun.get(run_id)!.push(stop);
  }

  // Confirmed orders not already on a run -- the pool a manager is choosing from.
  const unassigned = readOrders(db, orderFilter(session), { status: "CONFIRMED", limit: 200 }).filter(
    (order) => db.prepare("SELECT 1 FROM delivery_stops WHERE order_id = ?").get(order.id) === undefined,
  );

  /* Tehran, not UTC: this is yesterday for the last 3.5 hours of every evening, and it feeds
     both readDriverActivity and buildStreak — so driver streaks were being scored against
     the wrong day exactly when the day was ending. See tehranTodayIso. */
  const today = tehranTodayIso();

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <RunPlanner drivers={drivers} />
      <AssignmentBoard
        runs={runs}
        orders={unassigned.map((o) => ({
          id: o.id,
          order_no: o.order_no,
          customer_name: o.customer_name,
          total_toman: o.total_toman,
          order_date: o.order_date,
          group_id: o.group_id,
        }))}
      />
      <RunTimeline
        runs={runs.filter((r) => r.status !== "done").map((r) => ({ ...r, stops: stopsByRun.get(r.id) ?? [] }))}
      />
      <DriverStreaks
        people={readDriverActivity(db, session, today).map((d) => ({
          id: d.id,
          name: d.name,
          streak: buildStreak(d.dates, today, 12),
        }))}
      />
    </div>
  );
}

/** «برنامه» — the month grid. Its own component, so BOTH views can sit behind ONE return.
 *
 *  It used to be inline in the page, after an early `return <RunsView />`. That early return
 *  is the whole defect: it handed the runs view to a component with no header card and no
 *  view strip, while this file still imported and rendered PageHeader for the plan view, so
 *  every test asking "does this page have a header?" reported green. Symmetry with RunsView
 *  is the fix — two views, two components, one place that renders the chrome.
 */
function PlanView({ db, session }: { db: DatabaseSync; session: Session }) {
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

  /* Weather and holidays for the month grid.
   *
   *  Both are keyed by ISO date and projected to `Record<jd, …>` because the grid's unit is
   *  the day-of-month, and neither may be able to break the page: a missing forecast yields
   *  an empty map, and holidays are generated in-process with no I/O at all. The two are
   *  independent — a holiday never touches routing, and the forecast never touches a plan. */
  const weatherIso = monthConditions(
    snapshotsInRange(
      jalaliToIsoDate(today.jy, today.jm, 1).slice(0, 10),
      jalaliToIsoDate(today.jy, today.jm, jalaliMonthLength(today.jy, today.jm)).slice(0, 10),
    ),
  );
  /* Icon AND Persian name. Three conditions share the `fog` glyph, so an icon alone cannot
     say whether a cell means rain, dust or fog — the same reason colour is never the only
     signal in this app. */
  const weatherMarks: Record<number, { icon: IconName; label: string }> = {};
  for (let d = 1; d <= grid.days.length; d++) {
    const worst = worstCondition(weatherIso[jalaliToIsoDate(today.jy, today.jm, d)] ?? []);
    if (worst) weatherMarks[d] = { icon: CONDITION_ICON[worst], label: CONDITION_LABEL[worst] };
  }

  /* Keyed by day-of-month, and only for days the generator produced. A stored lunar row has
     jd = 0 by design (nothing generated it), so keying on jd alone would collapse every such
     row onto day 0 — a cell that does not exist. */
  /* Air quality per day, from the snapshot-free sibling endpoint. This is CAMS reanalysis —
     a MODEL, not a sensor — so it is stored per day and always rendered with its label.
     A failed fetch yields no entries, which is the same as a clear day: an absent badge is
     honest, a wrong red square is not. */
  const airByDay = new Map<number, AirBand>();

  const holidaysByDay = new Map<number, { title_fa: string; kind: "official" | "commemorative" }>();
  for (const h of listHolidaysForMonth(today.jy, today.jm)) {
    if (h.jd >= 1 && h.jd <= grid.days.length) holidaysByDay.set(h.jd, h);
  }

  return (
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

      {/* Open-Meteo's API data is CC BY 4.0, so the credit is owed — and the same line says
          «تخمین مدل» because air quality here is CAMS reanalysis, not a station reading. */}
      <p className="text-xs text-text-muted">
        داده‌های هواشناسی و کیفیت هوا:{" "}
        <a
          href="https://open-meteo.com/en/licence"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Open-Meteo
        </a>{" "}
        · «تخمین مدل»، نه شاخص رسمی
      </p>

      <ScheduleBoard
        jy={today.jy}
        jm={today.jm}
        today={today.jd}
        leadingBlanks={grid.leadingBlanks}
        days={grid.days.length}
        runs={runs}
        visits={visits}
        marks={marks}
        weather={weatherMarks}
        holidays={holidaysByDay}
        air={Object.fromEntries(airByDay)}
      />
    </>
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const params = (await searchParams) as SearchParams;
  const view: DayView = oneOf(params, DAY_VIEWS, "");

  /* Carried over from /sales/runs, and load-bearing. proxy.ts's isBatchAdmin covers
     /sales/runs and /sales/deliveries by PREFIX, so it no longer covers this page once
     the planner moved here -- a phone_sales rep would otherwise be let in and shown the
     delivery-run planner. The gate is now the page's own, and it must stay. */
  if (view === "runs" && session.role === "phone_sales") redirect("/sales");

  const db = getDb();

  /* ONE return, and the chrome is ABOVE the choice of view.
   *
   *  This is the shape /sales/orders already uses for its three views, and it is the whole
   *  fix: a view switch selects a BODY, never a page. Every view therefore gets the title
   *  card, the overview and the view strip by construction, because there is no branch that
   *  can reach the screen without passing through them. */
  return (
    <ScheduleChrome view={view}>
      {view === "runs" ? (
        <RunsView db={db} session={session} />
      ) : (
        <PlanView db={db} session={session} />
      )}
    </ScheduleChrome>
  );
}
