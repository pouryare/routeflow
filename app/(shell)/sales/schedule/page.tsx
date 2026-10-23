import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, type Session } from "@/lib/session";
import { planViewData, runsViewData } from "@/lib/repo/scheduleView";
import { faJalaliDate, toJalali, jalaliToIsoDate, jalaliMonthGrid, jalaliMonthLength } from "@/lib/jalali";
import { monthConditions, worstCondition, CONDITION_LABEL } from "@/lib/weather/calendarForecast";
import { snapshotsInRange } from "@/lib/repo/weather";
import { listHolidaysForMonth } from "@/lib/repo/holidays";
import { type AirBand } from "@/lib/weather/openMeteoAir";
import { CONDITION_ICON } from "@/lib/weather/calendarForecast";
import type { IconName } from "@/components/meridian/icon-map";
import ScheduleBoard from "@/components/meridian/ScheduleBoard";
import { TRIP_PURPOSES, tripPurpose } from "@/lib/tripPurpose";
import PageHeader from "@/components/meridian/PageHeader";
import { Icon } from "@/components/meridian/Icon";
import ViewTabs, { type ViewTab } from "@/components/meridian/ViewTabs";
import { oneOf, type SearchParams } from "@/lib/viewParam";
import { isVanRole } from "@/lib/roles";
import RunsViewClient from "@/components/sales/RunsViewClient";
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
/** «مسیرها» — the runs view.
 *
 *  It reads three things and hands them to one client component, and nothing else. The five
 *  panels that used to live here (RunPlanner, DaySplitPanel, OrderRouteBoard, RunTimeline,
 *  DriverStreaks) are GONE, and each was removed for a stated reason rather than tidiness:
 *
 *    RunPlanner      the form for creating a run. The board's own commit button replaces it,
 *                    because a lane IS the run form -- and the old pairing meant scrolling up
 *                    to create and down to drop, with an empty-state message in between saying
 *                    «اول باید یک مسیر باز بسازید».
 *    DaySplitPanel   raw HTML5 `draggable`, so the same gesture behaved differently here than
 *                    on /leads, which uses the shared useCardDrag.
 *    OrderRouteBoard its own code says "single-stop removal has no endpoint".
 *    RunTimeline     summed TOMAN -- money -- on the one graphic built to compare loads. It
 *                    now reports kilograms, and it IS «بار مسیرها» rather than sitting
 *                    beside it.
 *    DriverStreaks   a report about the past, sitting where the decision about the future is
 *                    made. It moved into the driver picker.
 *
 *  DRAFTS are read here and passed down rather than fetched in the browser, because a draft
 *  is private to one user and that is a server-side fact — never something the client is
 *  trusted to have filtered. */
async function RunsView({ session }: { session: Session }) {
  const { drivers, runs, kgByRun, plannable, drafts } = await runsViewData(session);

  return (
    <RunsViewClient
      drivers={drivers}
      drafts={drafts}
      runs={runs.map((r) => ({
        id: r.id,
        // faJalaliDate returns "" for an unparseable date, and the raw ISO string is a
        // better answer than a blank -- so fall back to what we were given.
        date: faJalaliDate(r.run_date) || r.run_date,
        driverName: r.driver_name,
        kg: kgByRun.get(r.id) ?? 0,
        stops: 0,
        status: r.status,
      }))}
      kgByRun={Object.fromEntries(kgByRun)}
      plannable={plannable}
    />
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
async function PlanView({ session }: { session: Session }) {
  const today = toJalali(new Date().toISOString())!;
  const grid = jalaliMonthGrid(today.jy, today.jm);

  // The whole Persian month, so the calendar's marks and the rail agree.
  const from = jalaliToIsoDate(today.jy, today.jm, 1);
  const to = jalaliToIsoDate(today.jy, today.jm, grid.days.length);

  const { runs, visits } = await planViewData(session, from, to);

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
    await snapshotsInRange(
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
  for (const h of await listHolidaysForMonth(today.jy, today.jm)) {
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
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const params = (await searchParams) as SearchParams;
  const view: DayView = oneOf(params, DAY_VIEWS, "");

  /* Carried over from /sales/runs, and load-bearing. proxy.ts's isBatchAdmin covers
     /sales/runs and /sales/deliveries by PREFIX, so it no longer covers this page once
     the planner moved here -- a phone_sales rep would otherwise be let in and shown the
     delivery-run planner. The gate is now the page's own, and it must stay. */
  if (view === "runs" && session.role === "phone_sales") redirect("/sales");

  /* ONE return, and the chrome is ABOVE the choice of view.
   *
   *  This is the shape /sales/orders already uses for its three views, and it is the whole
   *  fix: a view switch selects a BODY, never a page. Every view therefore gets the title
   *  card, the overview and the view strip by construction, because there is no branch that
   *  can reach the screen without passing through them. */
  return (
    <ScheduleChrome view={view}>
      {view === "runs" ? (
        <RunsView session={session} />
      ) : (
        <PlanView session={session} />
      )}
    </ScheduleChrome>
  );
}
