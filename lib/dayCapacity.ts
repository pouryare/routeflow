import { clusterIntoDays, daysNeeded } from "@/lib/clusterDays";
import type { LatLng } from "@/lib/geo";
import { straightLine, type DistanceFn } from "@/lib/routing/distance";

/** The three ways a day can run out of room. All nullable, because a manager may set one, two
 *  or none of them — `vehicles.max_stops` / `max_weight_kg` / `max_volume_m3` are all nullable
 *  columns, and an unset limit means unbounded rather than zero. */
export interface DayLimit {
  stops?: number | null;
  weightKg?: number | null;
  volumeM3?: number | null;
}

/** One order as the split sees it.
 *
 *  `lat`/`lng` are explicitly `number | null` rather than optional: `customers.lat/lng` are
 *  nullable columns, so SQL hands back real `null`s, not missing keys. A missing coordinate is a
 *  refusal to split rather than a silent drop, so the null has to survive the trip from the row
 *  to this type — widening it to `undefined` here would not accept what the driver actually gives. */
export interface SplitOrder {
  id: string;
  lat: number | null;
  lng: number | null;
  /** The day this order was promised to. Present means PINNED — never clustered, never moved. */
  requestedDay?: string | null;
  weightKg?: number | null;
  volumeM3?: number | null;
}

export interface ExistingDay {
  day: string;
  /** How many stops are already committed on it, pinned ones included. */
  count: number;
  limit?: DayLimit;
}

/** What a day is already using. Weight and volume are summed over the stops already placed. */
export interface DayUsage {
  stops: number;
  weightKg: number;
  volumeM3: number;
}

export interface DayPlan {
  day: string;
  orderIds: string[];
}

export interface SplitPlan {
  /** Extra orders joining a day that already has a run, soonest first. */
  fill: DayPlan[];
  /** Days that do not exist yet and have to be created. */
  newDays: DayPlan[];
  /** Pinned orders, grouped by the day they were promised to. Never proposed for placement. */
  pinnedByDay: DayPlan[];
  /** Orders with no location. Non-empty means NOTHING was split. */
  blocked: string[];
}

/** Rooms left on a day, bounded by the tightest of the three limits.
 *
 *  Returns Infinity for an unset limit, because a manager who typed no cap must not be told a
 *  day is full. Clamps at zero: an over-full day has no headroom, and reporting a negative
 *  number would send a caller looking for space that does not exist. */
export function remainingCapacity(used: number, limit: number | null | undefined): number {
  if (limit == null || limit <= 0) return Infinity;
  return Math.max(0, limit - used);
}

/** The tightest headroom across all three limits, given what a day already carries.
 *
 *  Stops, kilograms and cubic metres are compared separately and the smallest wins, because a
 *  van can be full of room by volume and still unable to take another box. A limit the manager
 *  never set is ignored entirely. */
export function headroom(usage: DayUsage, limit: DayLimit): number {
  return Math.min(
    remainingCapacity(usage.stops, limit.stops),
    remainingCapacity(usage.weightKg, limit.weightKg),
    remainingCapacity(usage.volumeM3, limit.volumeM3)
  );
}

/** True when this order still FITS on the day — i.e. adding it does not push any of the three
 *  limits over.
 *
 *  The test is "does it exceed", not "is there room left afterwards". A day limited to 8 stops
 *  that holds 7 has room for exactly one more, and asking `headroom(after) > 0` would refuse it
 *  and cap every day at limit-1: a van that can legally carry 8 boxes would silently take 7. */
export function fits(order: SplitOrder, usage: DayUsage, limit: DayLimit): boolean {
  const over = (used: number, cap: number | null | undefined): boolean =>
    cap != null && cap > 0 && used > cap;

  return (
    !over(usage.stops + 1, limit.stops) &&
    !over(usage.weightKg + (order.weightKg ?? 0), limit.weightKg) &&
    !over(usage.volumeM3 + (order.volumeM3 ?? 0), limit.volumeM3)
  );
}

interface SplitArgs {
  /** Orders with no requested day. These — and only these — are clustered. */
  free: SplitOrder[];
  /** Orders already promised to a day. Held out of clustering entirely. */
  pinned?: SplitOrder[];
  /** Days that already have a run, soonest first. Filling them comes before creating any. */
  existingDays?: ExistingDay[];
  limit?: DayLimit;
  origin?: LatLng | null;
  distanceFn?: DistanceFn;
}

/** Suggests how to spread uncommitted orders across days, without moving anything.
 *
 *  THE PINNING CONTRACT. An order with a `requestedDay` is a promise the office already made,
 *  so it is removed from the clustered set BEFORE `clusterIntoDays` is called rather than being
 *  passed in as a seed. That is deliberate and it is the whole subtlety: `seeds` only bias the
 *  initial centroids and sort seed-bearing days first. `assign()` still receives every stop it
 *  is given, and `rebalanceToSizes` will move one to make the day sizes exact — so a seeded stop
 *  is a HINT, not a pin. Partitioning the pinned orders out is what actually makes them
 *  immovable, and `tests/day-capacity.test.ts` proves the difference rather than asserting it.
 *
 *  Fill-before-create: an order goes into free room on a day that already has a run before any
 *  new day is proposed. Otherwise splitting 30 unplaced orders piles work onto a day already
 *  holding 20.
 *
 *  A blocked order — one with no coordinates — aborts the whole plan. Clustering needs a
 *  position, and quietly leaving an order out is how work disappears with no trace of it. */
export function planDaySplit({
  free,
  pinned = [],
  existingDays = [],
  limit = {},
  origin = null,
  distanceFn,
}: SplitArgs): SplitPlan {
  const pinnedByDay = groupByDay(pinned);

  /* A promised order is dropped from the clustered set here, by id, rather than merely being
     omitted by a careful caller. The pinning contract is the reason this module exists, so it
     must not depend on the caller partitioning the two lists perfectly: one caller that passes
     the same order in both would otherwise silently get a "never moved" guarantee that does not
     hold. Cheap, and it makes the guarantee structural. */
  const pinnedIds = new Set(pinned.map((o) => o.id));
  const candidates = free.filter((o) => !pinnedIds.has(o.id));

  const blocked = candidates.filter((o) => o.lat == null || o.lng == null).map((o) => o.id);

  // Nothing about a partial plan is safe to show: a missing order would look placed.
  if (blocked.length > 0) return { fill: [], newDays: [], pinnedByDay, blocked };

  /* Each day starts from what it already carries, plus the pinned orders promised to it, so a
     promise consumes capacity rather than appearing free. */
  const days = existingDays.map((d) => ({
    day: d.day,
    usage: {
      stops: d.count + (pinnedByDay.find((p) => p.day === d.day)?.orderIds.length ?? 0),
      weightKg: 0,
      volumeM3: 0,
    },
    limit: { ...limit, ...d.limit },
    orderIds: [] as string[],
  }));

  /* Nearest-to-origin first, so filling the closest day is what happens by default.
   *
   * This used to call `byOrigin`, which computed `Math.hypot(dLat, dLng)` -- raw DEGREES,
   * not kilometres, not even haversine -- and ignored the `distanceFn` it was sitting next
   * to. So «پیشنهاد بده» laid out 314 real orders by a number that means nothing, and this
   * ordering is what decides which day fills first.
   *
   * Two things that were wrong with it are fixed here rather than in the comparator:
   *   - it measured, so the caller's distance function was decorative. It is used now.
   *   - an order it could not measure scored 0, which sorted it TIED with everything and
   *     let it win. An unlocatable order now sorts LAST. A missing location is not the
   *     nearest one. */
  const measure = distanceFn ?? straightLine;
  const rank = (o: SplitOrder): number => {
    if (!origin) return 0;
    if (o.lat == null || o.lng == null) return Number.MAX_SAFE_INTEGER;
    return measure(origin, { lat: o.lat, lng: o.lng });
  };
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b));
  for (const order of ordered) {
    // Oldest-with-room first: a stop goes wherever there is space, in the order days come.
    const target = days.find((d) => fits(order, d.usage, d.limit));
    if (!target) continue;
    target.usage = {
      stops: target.usage.stops + 1,
      weightKg: target.usage.weightKg + (order.weightKg ?? 0),
      volumeM3: target.usage.volumeM3 + (order.volumeM3 ?? 0),
    };
    target.orderIds.push(order.id);
  }

  const placed = new Set(days.flatMap((d) => d.orderIds));
  const leftovers = candidates.filter((o) => !placed.has(o.id));

  return {
    fill: days.filter((d) => d.orderIds.length > 0).map((d) => ({ day: d.day, orderIds: d.orderIds })),
    newDays: spreadAcrossNewDays(leftovers, limit, origin, distanceFn),
    pinnedByDay,
    blocked,
  };
}

/** Clusters whatever did not fit a real day into whole new days, honouring the same limits.
 *
 *  Even by stop count is not the same as within the limits: a run of heavy orders can blow the
 *  weight cap while the count looks fine. Oversized days are reported as they came out rather
 *  than trimmed, because quietly dropping an order here would lose it. */
function spreadAcrossNewDays(
  leftovers: SplitOrder[],
  limit: DayLimit,
  origin: LatLng | null,
  distanceFn?: DistanceFn
): DayPlan[] {
  if (leftovers.length === 0) return [];

  /* Every order reaching here already passed the no-coordinate check, but the TYPE cannot know
     that — `SplitOrder.lat` is `number | null` because SQL says so, and `clusterIntoDays` wants
     a plain `LatLng`. Narrowing with a real guard rather than a cast: if an order without a
     coordinate ever slipped through, it would be reported as blocked instead of crashing the
     whole plan on a null dereference inside the clusterer. */
  const located: Array<SplitOrder & LatLng> = [];
  const stranded: string[] = [];
  for (const o of leftovers) {
    if (o.lat == null || o.lng == null) stranded.push(o.id);
    else located.push({ ...o, lat: o.lat, lng: o.lng });
  }
  if (stranded.length > 0) throw new Error(`planDaySplit: orders without a location reached clustering: ${stranded.join(", ")}`);

  // No cap typed means one day holding everything, matching clusterIntoDays' own fallback.
  const perDay = limit.stops && limit.stops > 0 ? limit.stops : located.length;
  const count = daysNeeded(located.length, perDay);

  const days = clusterIntoDays(located, count, origin, distanceFn, undefined, perDay);
  return days.map((d) => ({ day: "", orderIds: d.stops.map((s) => s.id) }));
}

function groupByDay(pinned: SplitOrder[]): DayPlan[] {
  const byDay = new Map<string, string[]>();
  for (const o of pinned) {
    if (!o.requestedDay) continue;
    const list = byDay.get(o.requestedDay) ?? [];
    list.push(o.id);
    byDay.set(o.requestedDay, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, orderIds]) => ({ day, orderIds }));
}

/* GONE: this was `Math.hypot(dLat, dLng)` -- raw degrees, and ignoring the distanceFn beside
   it. It measured instead of using, and it scored an unmeasurable order 0 so that order
   sorted tied with everything and could win. Both fixed at the call site above, which is
   where the distance function is actually in scope. */