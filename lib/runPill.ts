/** What the live run pill says: which stop of the run is next, out of how many. Pure, so it is tested. */

export interface PillStop {
  id: number;
  status: string;
  customer_name: string;
}

export interface RunPillModel {
  /** 1-based place of the next unfinished stop in the run. */
  index: number;
  total: number;
  /** Stops already finished (delivered or returned): the filled part of the bar. */
  doneCount: number;
  nextId: number;
  name: string;
}

/** The next pending stop, or null when the run has none left (the pill then goes away). */
export function runPillOf(stops: PillStop[]): RunPillModel | null {
  const at = stops.findIndex((s) => s.status === "pending");
  if (at === -1) return null;
  return {
    index: at + 1,
    total: stops.length,
    doneCount: stops.filter((s) => s.status !== "pending").length,
    nextId: stops[at].id,
    name: stops[at].customer_name,
  };
}
