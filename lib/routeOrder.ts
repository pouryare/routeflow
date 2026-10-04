import { twoOptOrder, distanceKm as straightLineKm, type LatLng } from "@/lib/geo";

/** A stop on a run, as ordering sees it. `sortOrder` and `status` are what make this different
 *  from a plain list of points: an ordering that ignored them would move work the driver has
 *  already driven. */
export interface OrderableStop extends LatLng {
  id: number;
  /** `pending` until driven. Absent for a `lead_run_stops` row, which has no such column. */
  status?: string | null;
  sortOrder: number;
}

/** Any distance measure. Real roads (an OSRM table) and straight lines are interchangeable here,
 *  which is what lets every test in `tests/route-order.test.ts` run with no network. */
export type DistanceFn = (a: LatLng, b: LatLng) => number;

/** The statuses `delivery_stops.status` can hold: pending, delivered, refused, skipped.
 *
 *  All three non-pending values mean the driver DID drive to the door — refused means the
 *  customer would not buy, which is an outcome, not an absence. None of them may be re-sequenced.
 *
 *  Read from the schema rather than invented: an earlier version listed `failed`, `absent` and
 *  `cancelled`, none of which this database can store. A status list that names values the CHECK
 *  constraint forbids is a list that silently fails to recognise real completed work.
 *
 *  `lead_run_stops` has NO status column at all — a visit is done or it is not, tracked elsewhere —
 *  so a caller synthesises `pending` for those, and a missing status is treated as not-done. */
const DONE_STATUSES = new Set(["delivered", "refused", "skipped"]);

export function isDone(status: string | null | undefined): boolean {
  return status != null && DONE_STATUSES.has(status);
}

/** Where the sequence starts, and therefore what "nearest" means for the first stop. */
export type AnchorKind = "driver" | "previous" | "depot" | "none";

export interface Anchors {
  /** The driver's live location, from the browser's geolocation. */
  driver?: LatLng | null;
  /** The previous stop — which, on a live run, is the last one they drove. */
  previous?: LatLng | null;
  /** The depot or warehouse. */
  depot?: LatLng | null;
}

/** Picks the single best start point from whatever anchors were supplied.
 *
 *  `previous` beats `driver` deliberately: on a run in progress the last completed stop is a KNOWN
 *  position, while a GPS fix is approximate and may be a minute stale. A known-good anchor is
 *  worth more than a fresh uncertain one. */
export function resolveAnchor(anchors: Anchors): { point: LatLng | null; kind: AnchorKind } {
  if (anchors.previous) return { point: anchors.previous, kind: "previous" };
  if (anchors.driver) return { point: anchors.driver, kind: "driver" };
  if (anchors.depot) return { point: anchors.depot, kind: "depot" };
  return { point: null, kind: "none" };
}

/** Sorts a pool by how far each stop is from the anchor, nearest first.
 *
 *  With no anchor the input order is returned UNCHANGED. Inventing an order from nothing would
 *  shuffle the manager's list for no reason, and the manager's list is at least as good as a
 *  guess.
 *
 *  Stable on ties: two stops at the same distance keep the order they arrived in. A driver reads
 *  this as a plan, so a reshuffle decided by the sort implementation rather than by geography is
 *  a visible bug. */
export function sortByDistanceFrom<T extends LatLng>(stops: T[], anchor: LatLng | null): T[] {
  if (!anchor) return stops.slice();
  return stops
    .map((stop, index) => ({ stop, index, d: straightLineKm(anchor, stop) }))
    .sort((a, b) => a.d - b.d || a.index - b.index)
    .map((r) => r.stop);
}

/** The length of the drive, measured with whatever distance function the caller has.
 *
 *  `returnToOrigin` is the difference between a round trip and a one-way drop; a driver's
 *  remaining distance is only honest if it matches what they will actually do. */
export function routeLengthWith<T extends LatLng>(
  origin: LatLng,
  stops: T[],
  returnToOrigin: boolean,
  distanceFn: DistanceFn = straightLineKm,
): number {
  if (stops.length === 0) return 0;
  let km = distanceFn(origin, stops[0]);
  for (let i = 1; i < stops.length; i++) km += distanceFn(stops[i - 1], stops[i]);
  if (returnToOrigin) km += distanceFn(stops[stops.length - 1], origin);
  return km;
}

export interface OptimiseResult<T extends OrderableStop> {
  /** The finished stops, in the order they were driven. Never touched. */
  done: T[];
  /** The stops still to drive, in the order they should now be driven. */
  remaining: T[];
  /** Distance still to drive, from where the driver is. */
  totalKm: number;
  /** Whether `totalKm` came from real roads or straight lines. The UI must say so. */
  approximate: boolean;
}

/** Re-sequences the stops a driver has NOT yet finished.
 *
 *  THE ONE INVARIANT: a finished stop never moves. A driver who has already stood at three doors
 *  has a route that already happened; reordering the part that is done would rewrite history and
 *  move stops the depot has already marked delivered.
 *
 *  Everything after the last finished stop is re-sequenced from THAT stop — or from the depot
 *  when nothing is finished yet — and only when the result is genuinely better. `twoOptOrder` is a
 *  local improvement and can, on a pathological input, return something longer; when it does, the
 *  caller's own order is kept, because an "optimise" button that makes a day worse is worse than
 *  no button at all.
 *
 *  `approximate` travels with the result because a straight-line number displayed as if it were a
 *  driving distance is a lie the driver only discovers at the petrol station. */
export function optimiseRemaining<T extends OrderableStop>(
  stops: T[],
  distanceFn: DistanceFn = straightLineKm,
  depot: LatLng | null = null,
  returnToOrigin = false,
): OptimiseResult<T> {
  const done = stops.filter((s) => isDone(s.status)).sort((a, b) => a.sortOrder - b.sortOrder);
  const remaining = stops.filter((s) => !isDone(s.status)).sort((a, b) => a.sortOrder - b.sortOrder);

  if (remaining.length === 0) return { done, remaining: [], totalKm: 0, approximate: true };

  // The last thing actually driven, or the depot if the day has not started.
  const lastDone = done[done.length - 1];
  const origin: LatLng = lastDone ?? depot ?? remaining[0];

  const ordered = twoOptOrder(remaining, origin, returnToOrigin, distanceFn);
  const before = routeLengthWith(origin, remaining, returnToOrigin, distanceFn);
  const after = routeLengthWith(origin, ordered, returnToOrigin, distanceFn);

  // Only accept a genuine improvement. A tie keeps the caller's order, which is the one a human
  // built and can reason about.
  const settled = after < before - 1e-9 ? ordered : remaining;

  return {
    done,
    remaining: settled,
    totalKm: routeLengthWith(origin, settled, returnToOrigin, distanceFn),
    approximate: isApproximate(distanceFn),
  };
}

/** True when a distance function is straight-line rather than a real road matrix.
 *
 *  Detected by identity against `distanceKm` rather than by a flag the caller must remember to
 *  set: if the matrix failed to load and the code fell back, the fallback IS `distanceKm`, so
 *  this cannot be forgotten and cannot be wrong. */
export function isApproximate(distanceFn: DistanceFn): boolean {
  return distanceFn === straightLineKm;
}
