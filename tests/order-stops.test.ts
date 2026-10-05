import { describe, it, expect, afterEach } from "vitest";
import { orderStops, type OrderableStop } from "@/lib/routing/orderStops";
import { straightLine } from "@/lib/routing/distance";

const DEPOT = { lat: 35.7, lng: 51.4 };
/** Three well-separated towns. Deliberately NOT one of them at the depot's coordinates: a
 *  stop at zero distance always sorts first, which would hide the ordering entirely. */
const NEAR = { lat: 35.71, lng: 51.41 };
const MID = { lat: 35.75, lng: 51.45 };
const FAR = { lat: 35.8, lng: 51.5 };

const STOPS: OrderableStop[] = [
  { id: "far", ...FAR },
  { id: "near", ...NEAR },
  { id: "mid", ...MID },
];

afterEach(() => {
  delete process.env.VROOM_URL;
});

describe("orderStops", () => {
  it("degrades to the fallback and says so", async () => {
    // This is the branch that runs today: VROOM_URL is unset in development.
    delete process.env.VROOM_URL;
    const r = await orderStops(STOPS, DEPOT, { distanceFn: straightLine });
    expect(r.order[0].id).toBe("near");
    expect(r.quality).toBe("fallback");
  });

  it("names the measure it used", async () => {
    const r = await orderStops(STOPS, DEPOT, { distanceFn: straightLine });
    expect(r.distance).toBe("straight-line");
  });

  it("reports roads when given a road distance", async () => {
    const r = await orderStops(STOPS, DEPOT, {
      distanceFn: (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng) * 7,
    });
    expect(r.distance).toBe("roads");
  });

  it("returns every stop exactly once", async () => {
    const r = await orderStops(STOPS, DEPOT, { distanceFn: straightLine });
    expect(r.order.map((s) => s.id).sort()).toEqual(["far", "mid", "near"]);
  });

  it("handles an empty list and a single stop without a solver", async () => {
    expect((await orderStops([], DEPOT)).order).toEqual([]);
    const one = await orderStops([{ id: "a", ...NEAR }], DEPOT);
    expect(one.order).toHaveLength(1);
  });

  it("keeps the caller's own ids, whatever their type", async () => {
    // The solver numbers jobs 1..n internally; a string id must survive the round trip.
    const mixed = [
      { id: 7, ...FAR },
      { id: "seven", ...NEAR },
      { id: 9, ...MID },
    ];
    const r = await orderStops(mixed, DEPOT, { distanceFn: straightLine });
    expect(r.order.map((s) => s.id).sort()).toEqual([7, "seven", 9].sort());
  });
});