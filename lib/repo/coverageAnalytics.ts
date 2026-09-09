/** The field-and-coverage half of the old `/analytics` page.
 *
 *  `/analytics` and `/sales/dashboard` were two analytics pages, and the CRM one is the
 *  one people use — so the standalone page is gone and the panels only it had moved
 *  here. Its debt-ageing buckets and its top-ten-customers list did NOT come along: the
 *  dashboard already draws both (سن بدهی as a donut, مشتریان برتر as a bar chart), and
 *  two answers to the same question on one page is how a reader learns to distrust both.
 *
 *  What survived is everything the dashboard could not answer, because it is about
 *  ground covered rather than money moved: which districts are in which state, who has
 *  gone quiet, what is overdue, how many visits actually got logged, how long the days
 *  ran, and what it costs to serve a customer given how far away they are.
 *
 *  Every figure is scoped by the caller's group. An aggregate is a leak even when it
 *  names nobody — a manager reading a province-wide total learns the size of a business
 *  that is not theirs — so the scope is applied to the rows being aggregated, never to
 *  the page.
 */
import type { DatabaseSync } from "node:sqlite";
import { getDb, type Customer, type District, type CoverageStatus } from "@/lib/db";
import { daysSinceLastPurchase } from "@/lib/types";
import { readFacilities } from "@/lib/facilities";
import { distanceKm } from "@/lib/geo";
import { groupFilter, groupFilterWithShared, scopeGroupIds, type Session } from "@/lib/session";
import type { CostToServeRow, MatchQuality } from "@/components/CostToServePanel";

export type DayLogRow = {
  day: string;
  start: string;
  /** Null when a single arrival is all the evidence there is: one point cannot bound a
   *  day, so it reports a start and no span rather than a span of zero. */
  end: string | null;
  minutes: number | null;
  stops: number;
  done: number;
};

export type CoverageAnalytics = {
  districtTotal: number;
  districtCounts: Partial<Record<CoverageStatus, number>>;
  /** Active customers whose last purchase is more than 30 days old. */
  dormant: number;
  reminders: { overdue: number; today: number; total: number };
  /** Eight weekly buckets of logged visits, oldest first. */
  weeks: { label: string; count: number }[];
  dayLog: DayLogRow[];
  costToServe: CostToServeRow[];
  dispatchSiteName: string | null;
  match: MatchQuality;
  /** The customers the aggregates were computed over, so the caller can date the data. */
  customers: Customer[];
};

function countBy<T extends string>(items: T[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const v of items) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function mmdd(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/** `now` is injected rather than read here so that every figure on one page agrees about
 *  what "now" means. Two reads can land either side of a day boundary and disagree about
 *  which days exist. */
export function coverageAnalytics(
  session: Session,
  now: Date = new Date(),
  db: DatabaseSync = getDb(),
): CoverageAnalytics {
  const f = groupFilter(session);
  const districts = db
    .prepare(`SELECT * FROM districts WHERE 1 = 1${f.sql}`)
    .all(...f.params) as unknown as District[];
  const customers = db
    .prepare(`SELECT * FROM customers WHERE 1 = 1${f.sql}`)
    .all(...f.params) as unknown as Customer[];

  const dormant = customers.filter((c) => {
    if (c.lifecycle !== "active") return false;
    const days = daysSinceLastPurchase(c, now);
    return days !== null && days > 30;
  }).length;

  const remindersRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN due_date < date('now') THEN 1 ELSE 0 END) as overdue,
         SUM(CASE WHEN due_date = date('now') THEN 1 ELSE 0 END) as today,
         COUNT(*) as total
       FROM reminders WHERE resolved = 0`,
    )
    .get() as { overdue: number | null; today: number | null; total: number };

  /* Revenue per customer against distance from the site we dispatch from.
     The join is by business name as free text -- sales rows carry no customer id -- so
     any renamed or differently-spelled business drops out silently. That gap is counted
     and surfaced in the panel rather than absorbed, because a total that is quietly
     missing rows is worse than one that says so. */
  const facilities = readFacilities(db, groupFilterWithShared(session));
  const dispatchSite =
    facilities.find((s) => s.is_default_origin === 1) ??
    facilities.find((s) => s.kind === "home_base") ??
    facilities[0] ??
    null;

  /* `match` exists to count sales rows matching no customer at all — and a join drops
     the very rows it is there to measure, so counting them needs the UNSCOPED table.

     Only a platform_owner gets that read, and this is narrower than it looks. The comment
     on the original /analytics page said "an owner reads the unscoped table on purpose",
     and that was true when written — `scopeGroupIds` returned "all" for an owner. It has
     not since tenancy landed: an owner now gets their organisation's group ids, so they
     fall into the joined branch and `unmatchedRows` reads 0 for every real user. The
     figure has been quietly dead rather than wrong.

     It is left that way deliberately. `sales` predates tenancy and has NO organization_id
     — the join to `customers` is the only tenancy the table has — so widening this read
     for an owner would hand them another organisation's sales rows. Fixing it properly
     means migrating `sales` to carry an org, which is a schema decision, not something to
     slip into a page merge. What changed is that the panel now SAYS it cannot measure
     this (`measurable: false`) instead of showing a confident zero. */
  const canCountUnmatched = scopeGroupIds(session) === "all";
  const salesScope = groupFilter(session, "c.group_id");
  const salesByName = (
    canCountUnmatched
      ? db
          .prepare(
            "SELECT customer_name, SUM(amount) as total, COUNT(*) as rows FROM sales GROUP BY customer_name",
          )
          .all()
      : db
          .prepare(
            `SELECT s.customer_name, SUM(s.amount) as total, COUNT(*) as rows
             FROM sales s JOIN customers c ON c.business_name = s.customer_name
             WHERE 1 = 1${salesScope.sql}
             GROUP BY s.customer_name`,
          )
          .all(...salesScope.params)
  ) as { customer_name: string; total: number; rows: number }[];

  const knownNames = new Set(customers.map((c) => c.business_name));
  const match = salesByName.reduce<MatchQuality>(
    (acc, s) => {
      acc.totalRows += s.rows;
      if (!knownNames.has(s.customer_name)) {
        acc.unmatchedRows += s.rows;
        acc.unmatchedRevenue += s.total;
      }
      return acc;
    },
    { unmatchedRows: 0, totalRows: 0, unmatchedRevenue: 0, measurable: canCountUnmatched },
  );

  const revenueByName = new Map(salesByName.map((s) => [s.customer_name, s.total]));
  const costToServe: CostToServeRow[] = customers.map((c) => ({
    business_name: c.business_name,
    customer_code: c.customer_code,
    km:
      dispatchSite && c.lat !== null && c.lng !== null
        ? distanceKm({ lat: c.lat, lng: c.lng }, dispatchSite)
        : null,
    revenue: revenueByName.get(c.business_name) ?? 0,
  }));

  /* The last fortnight of days, reconstructed from depot arrivals logged by the geofence.
     Days with no arrivals are absent rather than shown as zero-hour days: the log is the
     only evidence there is, and a day nobody recorded is unknown, not empty. */
  const logWindowStart = new Date(now.getTime() - 21 * 86400000).toISOString();
  const dayLogRows = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day,
              MIN(created_at) AS first_seen,
              MAX(created_at) AS last_seen,
              COUNT(*) AS stops
       FROM activity_log
       WHERE entity_type = 'facility' AND created_at >= ?
       GROUP BY day
       ORDER BY day DESC
       LIMIT 14`,
    )
    .all(logWindowStart) as { day: string; first_seen: string; last_seen: string; stops: number }[];

  const doneByDay = new Map(
    (
      db
        .prepare(
          `SELECT planned_date, COUNT(*) AS c FROM visit_plans
           WHERE status = 'done' AND planned_date >= ?
           GROUP BY planned_date`,
        )
        .all(logWindowStart.slice(0, 10)) as { planned_date: string; c: number }[]
    ).map((r) => [r.planned_date, r.c] as const),
  );

  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const dayLog: DayLogRow[] = dayLogRows.map((r) => {
    const start = new Date(r.first_seen);
    const end = new Date(r.last_seen);
    const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    return {
      day: r.day,
      start: hhmm(start),
      end: r.stops > 1 ? hhmm(end) : null,
      minutes: r.stops > 1 ? minutes : null,
      stops: r.stops,
      done: doneByDay.get(r.day) ?? 0,
    };
  });

  const weeks: { label: string; count: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * 86400000);
    const start = new Date(end.getTime() - 7 * 86400000);
    const row = db
      .prepare(
        `SELECT COUNT(*) as n FROM activity_log
         WHERE event_type = 'status_change' AND new_value = 'visited'
           AND created_at >= ? AND created_at < ?`,
      )
      .get(start.toISOString(), end.toISOString()) as { n: number };
    weeks.push({ label: mmdd(start), count: row.n });
  }

  return {
    districtTotal: districts.length,
    districtCounts: countBy(districts.map((d) => d.coverage_status)),
    dormant,
    reminders: {
      overdue: remindersRow.overdue ?? 0,
      today: remindersRow.today ?? 0,
      total: remindersRow.total,
    },
    weeks,
    dayLog,
    costToServe,
    dispatchSiteName: dispatchSite?.name ?? null,
    match,
    customers,
  };
}
