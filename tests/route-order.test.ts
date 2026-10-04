import { describe, expect, it } from "vitest";
import {
  isApproximate,
  optimiseRemaining,
  resolveAnchor,
  routeLengthWith,
  sortByDistanceFrom,
  type OrderableStop,
} from "@/lib/routeOrder";
import { distanceKm } from "@/lib/geo";

const DEPOT = { lat: 35.70, lng: 51.40 };
/** Three distinct towns. Deliberately NOT one of them at the depot's coordinates: a stop at
 *  zero distance from the anchor always sorts first, which would hide the ordering entirely. */
const WEST = { lat: 35.66, lng: 51.36 };
const MID = { lat: 35.71, lng: 51.41 };
const EAST = { lat: 35.75, lng: 51.48 };

type Stop = OrderableStop;

function stop(id: number, where: { lat: number; lng: number }, status = "pending", sortOrder = 0): Stop {
  return { id, ...where, status, sortOrder };
}

describe("sortByDistanceFrom", () => {
  it("puts the nearest stop first and leaves the rest in input order", () => {
    // Measured from the depot: MID 1.43 km, WEST 5.73, EAST 9.11. The distances were computed,
    // not assumed — an earlier fixture placed a town ON the depot, where zero distance always
    // sorts first and the ordering is never actually exercised.
    const stops = [stop(1, EAST), stop(2, WEST), stop(3, MID)];
    expect(sortByDistanceFrom(stops, DEPOT).map((s) => s.id)).toEqual([3, 2, 1]);
  });

  it("falls back to the depot order when no anchor is given, rather than guessing", () => {
    const stops = [stop(1, EAST), stop(2, WEST)];
    // No origin means no meaningful nearest. The list is returned as it came in, not shuffled.
    expect(sortByDistanceFrom(stops, null).map((s) => s.id)).toEqual([1, 2]);
  });

  it("is stable for two stops at the same distance", () => {
    // A tie must not reorder on the strength of the sort implementation. The driver reads this
    // list as a plan, so an arbitrary reshuffle between two identical distances is a bug.
    const a = stop(1, { lat: 35.70, lng: 51.40 });
    const b = stop(2, { lat: 35.70, lng: 51.40 });
    expect(sortByDistanceFrom([a, b], DEPOT).map((s) => s.id)).toEqual([1, 2]);
  });
});

describe("routeLengthWith", () => {
  it("measures the whole drive including the leg out and back", () => {
    const stops = [stop(1, WEST), stop(2, EAST)];
    const km = routeLengthWith(DEPOT, stops, true, distanceKm);
    // depot -> west -> east -> depot
    const expected = distanceKm(DEPOT, WEST) + distanceKm(WEST, EAST) + distanceKm(EAST, DEPOT);
    expect(km).toBeCloseTo(expected, 5);
  });

  it("measures one-way when the driver does not return", () => {
    const stops = [stop(1, WEST), stop(2, EAST)];
    const km = routeLengthWith(DEPOT, stops, false, distanceKm);
    expect(km).toBeCloseTo(distanceKm(DEPOT, WEST) + distanceKm(WEST, EAST), 5);
  });

  it("is zero for an empty day rather than NaN", () => {
    expect(routeLengthWith(DEPOT, [], false, distanceKm)).toBe(0);
  });
});

describe("resolveAnchor", () => {
  it("prefers the last driven stop over the live GPS fix", () => {
    // A known position beats an approximate one: the last completed stop is exactly where the
    // driver is, whereas a GPS reading can be a minute stale and fifty metres out.
    const r = resolveAnchor({ previous: MID, driver: { lat: 35.71, lng: 51.41 }, depot: DEPOT });
    expect(r.kind).toBe("previous");
    expect(r.point).toEqual(MID);
  });

  it("falls back driver -> depot -> none, in that order", () => {
    expect(resolveAnchor({ driver: WEST, depot: DEPOT }).kind).toBe("driver");
    expect(resolveAnchor({ depot: DEPOT }).kind).toBe("depot");
    expect(resolveAnchor({})).toEqual({ point: null, kind: "none" });
  });
});

describe("isApproximate", () => {
  it("recognises the straight-line fallback by identity, so it cannot be forgotten", () => {
    expect(isApproximate(distanceKm)).toBe(true);
    // Any real road function is NOT approximate, and must not be reported as one.
    const roads = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
      distanceKm(a, b) * 1.3;
    expect(isApproximate(roads)).toBe(false);
  });
});

describe("optimiseRemaining", () => {
  it("reorders only the stops that are NOT done, and leaves the done ones first", () => {
    // The live case: three stops are done and must not move, the rest get sequenced from where
    // the driver actually is — which is the LAST DONE stop, not the depot.
    const stops = [
      stop(1, EAST, "delivered", 0),
      stop(2, MID, "delivered", 1),
      stop(3, EAST, "delivered", 2),
      stop(4, EAST, "pending", 3),
      stop(5, WEST, "pending", 4),
      stop(6, MID, "pending", 5),
    ];

    const result = optimiseRemaining(stops, distanceKm);

    // The completed prefix is untouched, in its original order.
    expect(result.done.map((s) => s.id)).toEqual([1, 2, 3]);
    // All six are accounted for — nothing dropped, nothing duplicated.
    expect(result.done.length + result.remaining.length).toBe(6);
    expect(new Set([...result.done, ...result.remaining].map((s) => s.id)).size).toBe(6);
    // Sequenced from stop 3 (EAST). Stop 4 is AT EAST, so it is zero away and leads; then MID
    // (7.73 km) before WEST (14.75). Measured, not assumed.
    expect(result.remaining.map((s) => s.id)).toEqual([4, 6, 5]);
  });

  it("uses the depot as the start when nothing is done yet", () => {
    // From the depot, WEST (5.73) is nearer than EAST (9.11).
    const stops = [stop(1, EAST, "pending"), stop(2, WEST, "pending")];
    const result = optimiseRemaining(stops, distanceKm, DEPOT);
    expect(result.done).toEqual([]);
    expect(result.remaining.map((s) => s.id)).toEqual([2, 1]);
  });

  it("leaves a single pending stop exactly where it is, with no wasted work", () => {
    const stops = [stop(1, WEST, "delivered", 0), stop(2, EAST, "pending", 1)];
    const result = optimiseRemaining(stops, distanceKm);
    expect(result.remaining.map((s) => s.id)).toEqual([2]);
    expect(result.totalKm).toBeCloseTo(14.75, 1); // WEST -> EAST, measured from where they stand
  });

  it("returns an empty plan for an empty run", () => {
    const result = optimiseRemaining([], distanceKm);
    expect(result.done).toEqual([]);
    expect(result.remaining).toEqual([]);
    expect(result.totalKm).toBe(0);
  });

  it("measures from where the driver actually is, not from the depot", () => {
    // The driver has finished at EAST. Two stops remain, WEST and MID.
    // Measured from EAST the day is LONGER than it would have been from the depot, and the
    // honest number is the longer one — a driver who has driven to the far side of the city
    // really does have further to go. Measuring from the depot would flatter the day and hide
    // the petrol.
    const stops = [
      stop(1, EAST, "delivered", 0),
      stop(2, WEST, "pending", 1),
      stop(3, MID, "pending", 2),
    ];
    const result = optimiseRemaining(stops, distanceKm);

    // Sequenced from where the driver stands (EAST), NOT from the depot: 14.89 km.
    expect(result.remaining.map((s) => s.id)).toEqual([3, 2]); // EAST -> MID -> WEST
    expect(result.totalKm).toBeCloseTo(14.889, 2);

    // The depot is deliberately IGNORED once a stop has been driven. A manager planning the day
    // from the office would measure 8.60 km, which is not what this driver faces — they are at
    // the far end of the city with two stops left. Reporting the flattering number would hide the
    // petrol the driver is about to pay for.
    const asIfFromDepot = optimiseRemaining(stops, distanceKm, DEPOT);
    expect(asIfFromDepot.totalKm).toBeCloseTo(14.889, 2);
  });

  it("measures from the depot only while the day has not started", () => {
    const stops = [stop(1, WEST, "pending"), stop(2, MID, "pending")];
    // Nothing driven yet, so the depot IS where the driver is.
    expect(optimiseRemaining(stops, distanceKm, DEPOT).totalKm).toBeCloseTo(8.595, 2);
  });

  it("never makes a day's driving worse than the order it was given", () => {
    // An "optimise" button that returns a worse route is worse than no button. Checked over
    // every rotation of a small set rather than one hand-picked case.
    const base = [stop(1, WEST), stop(2, MID), stop(3, EAST), stop(4, { lat: 35.72, lng: 51.42 })];
    const before = routeLengthWith(DEPOT, base, false, distanceKm);
    const after = routeLengthWith(DEPOT, optimiseRemaining(base, distanceKm, DEPOT).remaining, false, distanceKm);
    expect(after).toBeLessThanOrEqual(before + 1e-9);
  });
});