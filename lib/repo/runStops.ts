// How many things a driver actually has to do on a run.
//
// A load and an unload ARE stops. They take real time -- unloading twenty crates is not a
// doorstep -- so every count of "how much work is in this day" is short by two without this.
// Four readers were: the briefing's today panel, capacity learning, the health panel, and the
// runs API. Left uncorrected, run-duration predictions get quietly WORSE the moment facility
// stops land, and nothing anywhere reports that they had.
//
// One module rather than four copies of the same UNION, because four copies is how the
// numbers came to disagree in the first place.

import type { Db } from "@/lib/database/client";

export type StopStatus = "pending" | "done";

/** A stop from either table, flattened to the shape every caller actually wants.
 *
 *  `entity` is which table it came from, so a caller that genuinely needs to tell a delivery
 *  from a warehouse visit can -- rather than having that forced on all of them. */
export interface RunStop {
  run_id: number;
  sort_order: number;
  status: StopStatus;
  entity: "delivery" | "facility";
  facility_id: number | null;
  role: "load" | "unload" | null;
}

/** Every stop on the given runs, deliveries and facility visits together.
 *
 *  `sort_order` is the delivery sequence; the facility load sorts at -1 because it is ALWAYS
 *  the first stop of the day, and the unload sorts last because it has NO position at all. A
 *  caller listing stops in order therefore shows the load first without special-casing it, and
 *  never shows the unload pretending to be a numbered stop. */
export async function stopsForRuns(db: Db, runIds: readonly number[]): Promise<RunStop[]> {
  if (runIds.length === 0) return [];
  const list = runIds.join(",");

  const deliveries = await db
    .prepare(
      `SELECT run_id, sort_order, status, 'delivery' AS entity,
              NULL AS facility_id, NULL AS role
         FROM delivery_stops WHERE run_id IN (${list})`
    )
    .all() as unknown as RunStop[];

  const facilities = await db
    .prepare(
      `SELECT run_id,
              CASE role WHEN 'load' THEN -1 ELSE 2147483647 END AS sort_order,
              status,
              'facility' AS entity,
              facility_id,
              role
         FROM run_facility_stops WHERE run_id IN (${list})`
    )
    .all() as unknown as RunStop[];

  return [...deliveries, ...facilities].sort(
    (a, b) => a.run_id - b.run_id || a.sort_order - b.sort_order
  );
}

/** Total stops per run id, facility visits included. */
export async function stopCountsByRun(
  db: Db,
  runIds: readonly number[]
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  for (const s of await stopsForRuns(db, runIds)) {
    counts.set(s.run_id, (counts.get(s.run_id) ?? 0) + 1);
  }
  return counts;
}

/** How many are still outstanding per run id.
 *
 *  A facility stop is 'done' only when the driver has confirmed it. A queued-but-unsent
 *  reconciliation stays outstanding on purpose -- the manager's question is "did the extras
 *  physically come back", and that is only true once the server says so. */
export async function remainingByRun(
  db: Db,
  runIds: readonly number[]
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  for (const s of await stopsForRuns(db, runIds)) {
    if (s.status !== "pending") continue;
    counts.set(s.run_id, (counts.get(s.run_id) ?? 0) + 1);
  }
  return counts;
}