import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import { canReachGroup, type Session } from "@/lib/session";
import { nextActionFor, visitOutcomeLabel } from "@/lib/crm/leadDesire";

/** A lead run: one driver, one day, an ordered set of pins.
 *
 *  Modelled on delivery_runs rather than invented, down to the UNIQUE(driver_user_id,
 *  run_date) and the select-then-reuse upsert in lib/repo/routing.ts. Two lead runs for one
 *  driver on one day is the bug that constraint exists to stop, and a driver who could see
 *  both would be shown an arbitrary one.
 *
 *  What happened at a stop is NOT stored here. It lives on the pin
 *  (saved_locations.visit_outcome), written by the visit, and is joined in on read. A second
 *  copy here would be a third thing to keep in step with the visit and the card. */

export type LeadRunStatus = "planned" | "in_progress" | "done";

export interface LeadRunStop {
  location_id: number;
  sort_order: number;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: string | null;
  visit_outcome: string | null;
  rating_potential: number | null;
  /** The words for the card, and the follow-up the outcome implies. Both derived. */
  outcome_label: string;
  next_action: string | null;
}

export interface LeadRun {
  id: number;
  driver_user_id: number;
  driver_name: string | null;
  group_id: number | null;
  run_date: string;
  status: LeadRunStatus;
  notes: string | null;
  planned_by: number;
  stops: LeadRunStop[];
}

const RUN_COLS = `r.id, r.driver_user_id, u.display_name AS driver_name, r.group_id, r.run_date,
                  r.status, r.notes, r.planned_by`;

/** Stops with everything the driver's card needs, derived rather than stored. */
const STOPS_SQL = `
  SELECT s.location_id, s.sort_order, l.name, l.address, l.lat, l.lng,
         l.status, l.visit_outcome, l.rating_potential
    FROM lead_run_stops s
    JOIN saved_locations l ON l.id = s.location_id
   WHERE s.run_id = ? AND l.organization_id = ?
   ORDER BY s.sort_order`;

function stopsFor(conn: DatabaseSync, runId: number, orgId: number): LeadRunStop[] {
  const rows = conn.prepare(STOPS_SQL).all(runId, orgId) as unknown as Array<{
    location_id: number; sort_order: number; name: string; address: string | null;
    lat: number | null; lng: number | null; status: string | null;
    visit_outcome: string | null; rating_potential: number | null;
  }>;
  return rows.map((r) => ({
    ...r,
    outcome_label: visitOutcomeLabel(r.visit_outcome),
    next_action: nextActionFor(r.visit_outcome),
  }));
}

function hydrate(conn: DatabaseSync, row: Record<string, unknown>, orgId: number): LeadRun {
  return { ...(row as unknown as LeadRun), stops: stopsFor(conn, Number(row.id), orgId) };
}

/** One run, or null. 404 rather than 403 elsewhere in this app for the same reason: a 403
 *  would confirm a row exists that the caller may not see. */
export function readLeadRun(conn: DatabaseSync, id: number, orgId: number): LeadRun | null {
  const row = conn
    .prepare(`SELECT ${RUN_COLS} FROM lead_runs r LEFT JOIN users u ON u.id = r.driver_user_id
               WHERE r.id = ? AND r.organization_id = ?`)
    .get(id, orgId) as Record<string, unknown> | undefined;
  return row ? hydrate(conn, row, orgId) : null;
}

/** Every run a driver has, newest first. A driver's own list is this and nothing else. */
export function readDriverLeadRuns(conn: DatabaseSync, driverUserId: number, orgId: number): LeadRun[] {
  const rows = conn
    .prepare(`SELECT ${RUN_COLS} FROM lead_runs r LEFT JOIN users u ON u.id = r.driver_user_id
               WHERE r.driver_user_id = ? AND r.organization_id = ?
               ORDER BY r.run_date DESC`)
    .all(driverUserId, orgId) as unknown as Record<string, unknown>[];
  return rows.map((r) => hydrate(conn, r, orgId));
}

/** Runs a manager may see: their group's, or the whole organisation for an owner. */
export function readScopedLeadRuns(conn: DatabaseSync, session: Session): LeadRun[] {
  const org = session.organizationId;
  const all = session.role === "owner";
  const rows = conn
    .prepare(`SELECT ${RUN_COLS} FROM lead_runs r LEFT JOIN users u ON u.id = r.driver_user_id
               WHERE r.organization_id = ? ${all ? "" : "AND r.group_id = ?"}
               ORDER BY r.run_date DESC, r.id DESC`)
    .all(...(all ? [org] : [org, session.groupId ?? -1])) as unknown as Record<string, unknown>[];
  return rows.map((r) => hydrate(conn, r, org));
}

/** The run a driver should be looking at: today's, else the most recent not finished.
 *
 *  The fallback is the same reasoning as /driver: a driver opening this at 00:30 after a
 *  late round is finishing yesterday's work, not starting a day with no stops. */
export function readTodaysLeadRun(conn: DatabaseSync, driverUserId: number, orgId: number, todayIso: string): LeadRun | null {
  const runs = readDriverLeadRuns(conn, driverUserId, orgId);
  return runs.find((r) => r.run_date === todayIso && r.status !== "done")
    ?? runs.find((r) => r.status !== "done")
    ?? runs[0]
    ?? null;
}

export class LeadRunError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** run_date is stored and compared as an ISO civil date, and that is the only form accepted.
 *
 *  The manager picks it in a Jalali calendar, so the conversion happens at the picker
 *  (jalaliToIsoDate) and this check is the backstop.
 *
 *  The year bound is not decoration. «۱۴۰۵-۰۷-۰۱» is a *syntactically valid* ISO date -- it
 *  parses, and Date.parse accepts it as the year 1405 -- so a shape check alone waves a Jalali
 *  date straight through. It would then sort against real dates as far in the past, and the
 *  driver would simply never see the run: a silent failure, which is the worst kind for a
 *  route. Anything outside a working lifetime is refused instead. */
function assertIsoDate(value: unknown): string {
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new LeadRunError(400, "تاریخ مسیر نامعتبر است");
  }
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) {
    throw new LeadRunError(400, "تاریخ مسیر باید میلادی باشد");
  }
  return value;
}

/** Whether this session may hand a route to this user.
 *
 *  Checked rather than assumed, because assigning a route to the wrong person is how a
 *  driver's day silently disappears: a driver in another group, or a deactivated account,
 *  would accept a run and never open it. */
export function assertAssignableDriver(conn: DatabaseSync, session: Session, driverUserId: number): { id: number; group_id: number | null; display_name: string } {
  const u = conn
    .prepare("SELECT id, group_id, display_name, role, active FROM users WHERE id = ? AND organization_id = ?")
    .get(driverUserId, session.organizationId) as
    | { id: number; group_id: number | null; display_name: string; role: string; active: number }
    | undefined;
  if (!u) throw new LeadRunError(404, "راننده پیدا نشد");
  if (!u.active) throw new LeadRunError(422, "این کاربر غیرفعال است");
  if (u.role !== "driver") throw new LeadRunError(422, "این کاربر راننده نیست");
  // 404 rather than 403 for another group's driver, as everywhere else here.
  if (!canReachGroup(session, u.group_id)) throw new LeadRunError(404, "راننده پیدا نشد");
  return { id: u.id, group_id: u.group_id, display_name: u.display_name };
}

/** Whether this stop is on one of the caller's own routes.
 *
 *  A driver may only record a visit against a stop they were given. Without this, opening
 *  /api/leads for a driver is enough to write a visit against any pin in their group --
 *  including one a colleague is standing in front of, overwriting the outcome they recorded.
 *
 *  The SQL lives here rather than in the route because that is the house rule: routes decide
 *  who and what, lib/repo/ decides how. */
export function isOnDriversRun(conn: DatabaseSync, driverUserId: number, orgId: number, locationId: number): boolean {
  const row = conn
    .prepare(`SELECT 1 FROM lead_run_stops s JOIN lead_runs r ON r.id = s.run_id
               WHERE s.location_id = ? AND r.driver_user_id = ? AND r.organization_id = ? LIMIT 1`)
    .get(locationId, driverUserId, orgId);
  return row !== undefined;
}

/** Drivers this manager may assign a route to. Feeds the dropdown. */
export function assignableDrivers(conn: DatabaseSync, session: Session): Array<{ id: number; name: string; group_id: number | null }> {
  const all = session.role === "owner";
  const rows = conn
    .prepare(`SELECT id, display_name, group_id FROM users
               WHERE organization_id = ? AND role = 'driver' AND active = 1
                 ${all ? "" : "AND group_id = ?"}
               ORDER BY display_name`)
    .all(...(all ? [session.organizationId] : [session.organizationId, session.groupId ?? -1])) as
    | Array<{ id: number; display_name: string; group_id: number | null }>;
  return rows.map((r) => ({ id: r.id, name: r.display_name, group_id: r.group_id }));
}

/** Replace a run's stops. Called from the transaction in createOrReuse, and on its own for
 *  a reorder from the driver's phone. */
export function setRunStops(conn: DatabaseSync, orgId: number, runId: number, locationIds: number[], nowIso?: string): void {
  const now = nowIso ?? new Date().toISOString();
  // Only real, reachable pins. A stop that is not there is worse than a short route: the
  // driver drives to a pin that does not exist.
  const placeholders = locationIds.map(() => "?").join(",");
  const found = locationIds.length === 0
    ? new Set<number>()
    : new Set(
        (conn
          .prepare(`SELECT id FROM saved_locations WHERE organization_id = ? AND id IN (${placeholders})`)
          .all(orgId, ...locationIds) as Array<{ id: number }>).map((r) => r.id)
      );
  if (found.size !== locationIds.length) {
    const missing = locationIds.filter((id) => !found.has(id));
    throw new LeadRunError(404, `مکان پیدا نشد: ${missing.join("، ")}`);
  }

  conn.prepare("DELETE FROM lead_run_stops WHERE run_id = ?").run(runId);
  const insert = conn.prepare(
    "INSERT INTO lead_run_stops (run_id, location_id, sort_order, created_at) VALUES (?, ?, ?, ?)"
  );
  // Walk locationIds, not the rows that came back: an `IN (...)` list yields rows in rowid
  // order, so using it directly would quietly re-sort the route the manager planned into id
  // order. The order of a route is the whole point of it.
  locationIds.forEach((locationId, i) => {
    if (found.has(locationId)) insert.run(runId, locationId, i, now);
  });
}

/** Create the run for a driver and day, or hand back the one that already exists.
 *
 *  Select-then-reuse rather than INSERT OR REPLACE, copied from lib/repo/routing.ts: a
 *  REPLACE would delete the existing row and cascade its stops away, so re-planning a
 *  driver's day would quietly empty the route they may already be driving. */
export function createOrReuseLeadRun(
  conn: DatabaseSync,
  session: Session,
  input: { driver_user_id: number; run_date: unknown; location_ids: number[]; notes?: string | null },
): { run: LeadRun; reused: boolean } {
  const runDate = assertIsoDate(input.run_date);
  const driver = assertAssignableDriver(conn, session, input.driver_user_id);
  const now = new Date().toISOString();

  const existing = conn
    .prepare("SELECT id FROM lead_runs WHERE driver_user_id = ? AND run_date = ? AND organization_id = ?")
    .get(driver.id, runDate, session.organizationId) as { id: number } | undefined;
  if (existing) {
    return { run: readLeadRun(conn, existing.id, session.organizationId)!, reused: true };
  }

  conn.exec("BEGIN IMMEDIATE");
  try {
    const runId = Number(
      conn
        .prepare(`INSERT INTO lead_runs (driver_user_id, group_id, run_date, status, notes, planned_by, organization_id, created_at, updated_at)
                  VALUES (?, ?, ?, 'planned', ?, ?, ?, ?, ?)`)
        .run(driver.id, driver.group_id, runDate, input.notes ?? null, session.user.id,
             session.organizationId, now, now).lastInsertRowid
    );
    setRunStops(conn, session.organizationId, runId, input.location_ids, now);
    conn.exec("COMMIT");
    return { run: readLeadRun(conn, runId, session.organizationId)!, reused: false };
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

/** Reassign a driver or a date, reorder, or move the status along. */
export function updateLeadRun(
  conn: DatabaseSync,
  session: Session,
  id: number,
  patch: { driver_user_id?: number; run_date?: unknown; status?: LeadRunStatus; notes?: string | null; location_ids?: number[] },
): LeadRun {
  const current = readLeadRun(conn, id, session.organizationId);
  if (!current || !canReachGroup(session, current.group_id)) {
    throw new LeadRunError(404, "مسیر پیدا نشد");
  }
  const driverId = patch.driver_user_id ?? current.driver_user_id;
  const driver = patch.driver_user_id !== undefined
    ? assertAssignableDriver(conn, session, patch.driver_user_id)
    : { group_id: current.group_id };
  const runDate = patch.run_date === undefined ? current.run_date : assertIsoDate(patch.run_date);
  const status = patch.status ?? current.status;
  const now = new Date().toISOString();

  // The UNIQUE index means a move onto an occupied day has to be reported rather than
  // silently merged with the other run.
  const clash = conn
    .prepare("SELECT id FROM lead_runs WHERE driver_user_id = ? AND run_date = ? AND organization_id = ? AND id != ?")
    .get(driverId, runDate, session.organizationId, id) as { id: number } | undefined;
  if (clash) throw new LeadRunError(409, "برای این راننده در این تاریخ مسیر دیگری وجود دارد");

  conn.exec("BEGIN IMMEDIATE");
  try {
    conn
      .prepare("UPDATE lead_runs SET driver_user_id = ?, group_id = ?, run_date = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?")
      .run(driverId, driver.group_id, runDate, status, patch.notes === undefined ? current.notes : patch.notes, now, id);
    if (patch.location_ids) setRunStops(conn, session.organizationId, id, patch.location_ids, now);
    conn.exec("COMMIT");
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
  return readLeadRun(conn, id, session.organizationId)!;
}
