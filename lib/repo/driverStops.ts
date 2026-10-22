/** What a driver's phone reads and writes at one door. Every lookup is keyed to the signed-in
 *  driver AND their company, so another driver's (or company's) stop reads as absent. */

import { getDb } from "@/lib/db";
import { deferStop, readDriverRuns, readRun, recordDelivery } from "@/lib/delivery";

export interface OwnedStop {
  id: number;
  status: string;
  collected_toman: number | null;
  order_id: number;
  run_status: string;
  customer_id: number;
}

export function findOwnedStop(stopId: number, driverUserId: number, organizationId: number): OwnedStop | undefined {
  return getDb()
    .prepare(
      `SELECT ds.id, ds.status, ds.collected_toman, ds.order_id, dr.status AS run_status, o.customer_id
         FROM delivery_stops ds
         JOIN delivery_runs dr ON dr.id = ds.run_id
         JOIN orders o ON o.id = ds.order_id
        WHERE ds.id = ? AND dr.driver_user_id = ? AND dr.organization_id = ?`
    )
    .get(stopId, driverUserId, organizationId) as OwnedStop | undefined;
}

/** Packs already recorded as delivered per line, to recognise an identical resubmission. */
export function storedDeliveries(orderId: number): { id: number; d: number }[] {
  return getDb()
    .prepare("SELECT id, COALESCE(packs_delivered, -1) AS d FROM order_lines WHERE order_id = ?")
    .all(orderId) as { id: number; d: number }[];
}

export function invoiceTotal(orderId: number): number {
  return (
    getDb()
      .prepare("SELECT COALESCE(SUM(packs_ordered * unit_price_toman), 0) AS t FROM order_lines WHERE order_id = ?")
      .get(orderId) as { t: number }
  ).t;
}

export function recordStopDelivery(
  stopId: number,
  input: { lines: { line_id: number; packs_delivered: number }[]; collected_toman: number; by: number; notes: string | null }
): void {
  recordDelivery(getDb(), stopId, input);
}

export function deferOwnedStop(stopId: number) {
  return deferStop(getDb(), stopId);
}

/** The driver's runs and the one wanted (today's, else the latest, else the one named); null when absent or not theirs. */
export function driverRunView(driverUserId: number, requestedRun: string | null, today: string) {
  const db = getDb();
  const runs = readDriverRuns(db, driverUserId);
  if (runs.length === 0) return { run: null, runs };
  const wanted = requestedRun ?? String(runs.find((r) => r.run_date === today)?.id ?? runs[0].id);
  const run = readRun(db, Number(wanted));
  // The id can be typed into the URL; a run belonging to another driver reads as absent.
  if (!run || run.driver_user_id !== driverUserId) return { run: null, runs };
  return { run, runs };
}
