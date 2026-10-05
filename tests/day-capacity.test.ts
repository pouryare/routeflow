import { describe, expect, it } from "vitest";
import { fits, headroom, planDaySplit, remainingCapacity, type SplitOrder } from "@/lib/dayCapacity";
import { clusterIntoDays } from "@/lib/clusterDays";
import { straightLine, isApproximate, type DistanceFn } from "@/lib/routing/distance";

/** Three well-separated towns, five stops each — the same geography clusterDays already
 *  recovers correctly, reused so these tests are about CAPACITY and PINNING, not clustering. */
const PARDIS = { lat: 35.74, lng: 51.82 };
const KARAJ = { lat: 35.84, lng: 50.94 };
const VARAMIN = { lat: 35.32, lng: 51.65 };
const HOME = { lat: 35.7, lng: 51.4 };

function around(centre: { lat: number; lng: number }, n: number, tag: string): SplitOrder[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${tag}${i}`,
    lat: centre.lat + (i - n / 2) * 0.004,
    lng: centre.lng + (i % 3) * 0.004,
    weightKg: 0,
    volumeM3: 0,
  }));
}

/** An order already promised to a specific day — the one thing the split must never move. */
function pinned(id: string, day: string, where: { lat: number; lng: number }): SplitOrder {
  return { id, lat: where.lat, lng: where.lng, requestedDay: day, weightKg: 0, volumeM3: 0 };
}

describe("remainingCapacity", () => {
  it("counts only the headroom, never below zero", () => {
    expect(remainingCapacity(4, 10)).toBe(6);
    expect(remainingCapacity(10, 10)).toBe(0);
    // An over-full day is already over its limit. Reporting negative headroom would make a
    // caller spin looking for space that does not exist.
    expect(remainingCapacity(14, 10)).toBe(0);
  });

  it("treats an unset limit as unbounded, not as zero", () => {
    // A manager who typed no cap must not get "this day is full" from a limit that was never set.
    expect(remainingCapacity(3, null)).toBe(Infinity);
    expect(remainingCapacity(3, 0)).toBe(Infinity);
  });

  it("is bounded by whichever of the three limits is tightest", () => {
    const usage = { stops: 4, weightKg: 0, volumeM3: 1 };
    // Set alone, each limit is the only one that can bind — the other two are unbounded.
    expect(headroom(usage, { stops: 10 })).toBe(6);
    expect(headroom(usage, { weightKg: 10 })).toBe(10);
    // Volume is the binding constraint here: 1 of 2 m3 used leaves 1, whatever the other two say.
    expect(headroom(usage, { stops: 100, weightKg: 100, volumeM3: 2 })).toBe(1);
  });

  it("lets a day reach its limit exactly, and refuses the one that exceeds it", () => {
    // "Does it fit" must mean "does not go OVER". Checking for headroom afterwards would cap
    // every day at limit-1, so a van allowed 8 boxes would quietly be given 7.
    const noGoods = (id: string) => ({ id, lat: PARDIS.lat, lng: PARDIS.lng });
    expect(fits(noGoods("a"), { stops: 7, weightKg: 0, volumeM3: 0 }, { stops: 8 })).toBe(true);
    expect(fits(noGoods("b"), { stops: 8, weightKg: 0, volumeM3: 0 }, { stops: 8 })).toBe(false);
  });
});

describe("planDaySplit — capacity", () => {
  it("fills the remaining room in a day that already has work before proposing a new day", () => {
    // The whole point of Step 3: the 5th already holds 6 of its 8 places, and exactly 2 orders
    // are unplaced. Those 2 belong in the free seats — proposing a day for them instead would
    // send a two-stop route out on its own.
    const existing = [{ day: "2026-10-05", count: 6, limit: { stops: 8 } }];
    const plan = planDaySplit({
      free: around(PARDIS, 2, "p"),
      pinned: [],
      existingDays: existing,
      limit: { stops: 8 },
    });

    expect(plan.newDays).toHaveLength(0);
    expect(plan.fill).toHaveLength(1);
    expect(plan.fill[0].day).toBe("2026-10-05");
    expect(plan.fill[0].orderIds).toHaveLength(2);
  });

  it("still proposes a new day once the existing ones are full", () => {
    // The companion case: 8 unplaced orders against 2 free seats cannot all fit, so the 6 that
    // do not fit have to go somewhere new rather than being quietly dropped.
    const existing = [{ day: "2026-10-05", count: 6, limit: { stops: 8 } }];
    const plan = planDaySplit({
      free: around(PARDIS, 8, "p"),
      pinned: [],
      existingDays: existing,
      limit: { stops: 8 },
    });

    expect(plan.fill[0].orderIds).toHaveLength(2);
    expect(plan.newDays).toHaveLength(1);
    expect(plan.newDays[0].orderIds).toHaveLength(6);
  });

  it("proposes a new day only once every existing one is full", () => {
    const existing = [
      { day: "2026-10-05", count: 8, limit: { stops: 8 } },
      { day: "2026-10-06", count: 3, limit: { stops: 8 } },
    ];
    const plan = planDaySplit({
      free: around(KARAJ, 10, "k"),
      pinned: [],
      existingDays: existing,
      limit: { stops: 8 },
    });

    // 5 seats left on the 6th, so 5 go there and the other 5 need a day of their own.
    expect(plan.fill[0].orderIds).toHaveLength(5);
    expect(plan.newDays).toHaveLength(1);
    expect(plan.newDays[0].orderIds).toHaveLength(5);
  });

  it("counts a pinned order as capacity already consumed", () => {
    // Room for 8 on the 6th. One seat is already spoken for by a pinned order, so only 7 of the
    // unplaced ones can join it — a promise must not read as free space.
    const existing = [{ day: "2026-10-06", count: 0, limit: { stops: 8 } }];
    const plan = planDaySplit({
      free: around(PARDIS, 8, "p"),
      pinned: [pinned("pin-1", "2026-10-06", PARDIS)],
      existingDays: existing,
      limit: { stops: 8 },
    });

    expect(plan.fill[0].orderIds).toHaveLength(7);
    expect(plan.fill[0].orderIds).not.toContain("pin-1");
  });
describe("planDaySplit — pinned orders", () => {
  it("NEVER moves an order that was promised to a day", () => {
    // This is the contract the audit found clusterIntoDays does not provide. Its `seeds` only
    // bias centroids and sort order; assign() still sees every stop and rebalanceToSizes can
    // relocate one. So pinned stops are held outside the clustered set entirely.
    const free = [...around(PARDIS, 5, "p"), ...around(KARAJ, 5, "k")];
    const plan = planDaySplit({
      free,
      pinned: [pinned("pin-k", "2026-10-06", KARAJ)],
      existingDays: [],
      limit: { stops: 5 },
    });

    // Every proposed day is drawn from `free` alone — the pin cannot appear in any of them.
    const clustered = plan.newDays.flatMap((d) => d.orderIds);
    expect(clustered).not.toContain("pin-k");
    expect(clustered).toHaveLength(10);
  });

  it("still lets a pinned order's location pull its day first", () => {
    // Seeding is what seeds ARE good at: the day holding promised work leads.
    const plan = planDaySplit({
      free: [...around(VARAMIN, 5, "v"), ...around(PARDIS, 5, "p")],
      pinned: [pinned("pin-p", "2026-10-05", PARDIS)],
      existingDays: [],
      limit: { stops: 5 },
    });

    expect(new Set(plan.newDays[0].orderIds.map((id) => id[0]))).toEqual(new Set(["p"]));
  });

  it("reports the pinned order on its own day even when that day has no run yet", () => {
    const plan = planDaySplit({
      free: around(PARDIS, 3, "p"),
      pinned: [pinned("pin-x", "2026-10-09", VARAMIN)],
      existingDays: [],
      limit: { stops: 8 },
    });

    expect(plan.pinnedByDay).toEqual([{ day: "2026-10-09", orderIds: ["pin-x"] }]);
  });
});

describe("planDaySplit — orders with no location", () => {
  it("refuses to split and names the order, rather than dropping it", () => {
    // customers.lat/lng can be NULL. Clustering needs a position, so an order without one has
    // to be placed by hand. Silently leaving it out is how work disappears without a trace.
    const plan = planDaySplit({
      free: [
        ...around(PARDIS, 3, "p"),
        { id: "order-99", lat: null, lng: null, weightKg: 5, volumeM3: 0.1 },
      ],
      pinned: [],
      existingDays: [],
      limit: { stops: 8 },
    });

    expect(plan.blocked).toEqual(["order-99"]);
    expect(plan.newDays).toHaveLength(0);
    expect(plan.fill).toHaveLength(0);
  });

  it("splits normally once every order has a location", () => {
    const plan = planDaySplit({ free: around(PARDIS, 6, "p"), pinned: [], existingDays: [], limit: { stops: 3 } });
    expect(plan.blocked).toEqual([]);
    expect(plan.newDays).toHaveLength(2);
  });
});

describe("planDaySplit — the guarantee is structural, not incidental", () => {
  it("a seeded stop is a HINT: clusterIntoDays still relocates one", () => {
    // The measurement that justifies the partition. Sweeping the seeds of small two-town
    // splits, 106 of 1,575 seeded stops landed in a day dominated by the OTHER town — seeding
    // biases the clustering, it does not hold a stop in place. Here the minimal case: three
    // stops, two days of at most 2, seeding the lone KARAJ stop still yields "k0+p1 | p0".
    const stops = [
      { id: "p0", ...PARDIS },
      { id: "p1", lat: PARDIS.lat + 0.002, lng: PARDIS.lng },
      { id: "k0", ...KARAJ },
    ];
    const days = clusterIntoDays(stops, 2, null, undefined, [stops[2]], 2);

    expect(days[0].stops.map((s) => s.id)).toContain("k0");
    // It shares its day with a PARDIS stop, so the seed did not get a day of its own.
    expect(days[0].stops.map((s) => s.id)).toEqual(["k0", "p1"]);
  });

  it("a seed that is not itself a stop is never invented", () => {
    // The other half: seeds supply CENTROIDS, never rows. Passing a location that is not in
    // `stops` contributes its position and nothing else — it cannot smuggle a stop in.
    const stops = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, lat: PARDIS.lat + i * 0.002, lng: PARDIS.lng }));
    const days = clusterIntoDays(stops, 2, null, undefined, [{ id: "ghost", ...KARAJ }], 2);

    expect(days.flatMap((d) => d.stops.map((s) => s.id))).not.toContain("ghost");
    expect(days.flatMap((d) => d.stops)).toHaveLength(4);
  });

  it("so planDaySplit holds a promised order by never handing it to the clusterer", () => {
    // Same geography as the moving seed above — but promised to a day, so it is partitioned
    // out instead of seeded. The guarantee comes from exclusion, not from a stronger seed.
    const free = [
      { id: "p0", ...PARDIS },
      { id: "p1", lat: PARDIS.lat + 0.002, lng: PARDIS.lng },
      { id: "k0", ...KARAJ },
    ];
    const plan = planDaySplit({
      free,
      pinned: [{ id: "k0", ...KARAJ, requestedDay: "2026-10-05" }],
      existingDays: [],
      limit: { stops: 2 },
    });

    expect(plan.newDays.flatMap((d) => d.orderIds)).toEqual(["p0", "p1"]);
    expect(plan.pinnedByDay).toEqual([{ day: "2026-10-05", orderIds: ["k0"] }]);
  });

  it("holds a promised order even if the caller passes it in BOTH lists", () => {
    // The guarantee must not depend on the caller partitioning correctly. An order that is both
    // free and pinned is pinned — the promise wins, because that is the whole contract.
    const plan = planDaySplit({
      free: [
        { id: "o0", ...PARDIS },
        { id: "o1", ...KARAJ },
        { id: "o2", lat: VARAMIN.lat, lng: VARAMIN.lng },
      ],
      pinned: [{ id: "o1", ...KARAJ, requestedDay: "2026-10-05" }],
      existingDays: [],
      limit: { stops: 8 },
    });

    expect(plan.newDays.flatMap((d) => d.orderIds)).toEqual(["o0", "o2"]);
    expect(plan.pinnedByDay).toEqual([{ day: "2026-10-05", orderIds: ["o1"] }]);
  });
});

describe("planDaySplit — swept over many shapes", () => {
  /** Deterministic PRNG: a failure must be reproducible from the seed alone, and a test that
   *  only passes on the run it was written on proves nothing. */
  function makeRnd(seedValue: number): () => number {
    let s = seedValue;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  }

  it("accounts for every order exactly once, and never clusters a promised one", () => {
    // The property that matters most and that no single hand-written case can establish: over
    // 500 random plans, nothing is lost, nothing is duplicated, and nothing promised is moved.
    // This is what caught the missing-order bug — a hand-picked example had hidden it.
    const rnd = makeRnd(12345);

    for (let trial = 0; trial < 500; trial++) {
      const n = 1 + Math.floor(rnd() * 14);
      const free = Array.from({ length: n }, (_, i) => ({
        id: `o${i}`,
        lat: 35.3 + rnd() * 0.6,
        lng: 51.3 + rnd() * 0.6,
        weightKg: rnd() * 20,
        volumeM3: rnd() * 1,
      }));
      // Pin ids that are deliberately ALSO in `free`, the sloppy-caller case.
      const nPin = Math.floor(rnd() * 4);
      const pinned = Array.from({ length: nPin }, (_, i) => ({
        id: `o${i}`,
        lat: 35.3 + rnd() * 0.6,
        lng: 51.3 + rnd() * 0.6,
        requestedDay: `2026-10-0${1 + (i % 5)}`,
        weightKg: rnd() * 20,
        volumeM3: rnd() * 1,
      }));
      const cap = 2 + Math.floor(rnd() * 6);
      const existing = Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => ({
        day: `2026-10-1${i}`,
        count: Math.floor(rnd() * cap),
        limit: { stops: cap },
      }));

      const plan = planDaySplit({ free, pinned, existingDays: existing, limit: { stops: cap } });
      const pinIds = new Set(pinned.map((p) => p.id));

      // A promised order is reported under pinnedByDay, never under fill or newDays.
      const clustered = [...plan.fill.flatMap((d) => d.orderIds), ...plan.newDays.flatMap((d) => d.orderIds)];
      for (const p of pinIds) expect(clustered, `trial ${trial}`).not.toContain(p);

      // Every order ends up in exactly one bucket, and no order is invented.
      const all = [...clustered, ...plan.pinnedByDay.flatMap((d) => d.orderIds)];
      const wanted = new Set(free.filter((o) => !pinIds.has(o.id)).map((o) => o.id));
      for (const id of wanted) expect(all, `trial ${trial}`).toContain(id);
      expect(new Set(all).size, `trial ${trial}`).toBe(all.length);
    }
  });

  it("never puts a fill over the limit it was given", () => {
    const rnd = makeRnd(999);
    for (let trial = 0; trial < 200; trial++) {
      const cap = 1 + Math.floor(rnd() * 5);
      const used = Math.floor(rnd() * cap);
      const free = Array.from({ length: 10 }, (_, i) => ({
        id: `o${i}`,
        lat: 35.5 + rnd(),
        lng: 51.5 + rnd(),
        weightKg: 0,
        volumeM3: 0,
      }));
      const plan = planDaySplit({
        free,
        pinned: [],
        existingDays: [{ day: "2026-10-05", count: used, limit: { stops: cap } }],
        limit: { stops: cap },
      });

      const onDay = plan.fill.find((d) => d.day === "2026-10-05");
      expect((onDay?.orderIds.length ?? 0) + used, `trial ${trial}`).toBeLessThanOrEqual(cap);
    }
  });
});

describe("planDaySplit — which distance it measures with", () => {
  const DEPOT = { lat: 35.7, lng: 51.4 };

  function order(id: string, lat: number | null, lng: number | null): SplitOrder {
    return { id, lat, lng, weightKg: 10, volumeM3: 0.1 };
  }

  it("does not rank the pool by raw degrees", () => {
    /* The two orders are a fraction of a degree apart, so under Math.hypot on degrees A beats
       B by a hair. The road function below says the opposite -- it stands in for the only way
       between them crossing a pass.
       A test that passes under BOTH measures proves nothing, which is exactly how the degrees
       bug survived two audits. This one cannot.

       Matched on COORDINATES, not object identity: the sort hands the measure function freshly
       built { lat, lng } literals, so `p === A` would never be true and the fixture would
       quietly measure straight lines -- passing for the wrong reason. */
    const A = order("A", 35.705, 51.405);
    const B = order("B", 35.706, 51.406);
    const isA = (p: { lat: number; lng: number }) => p.lat === A.lat && p.lng === A.lng;

    const roads: DistanceFn = (p, q) => {
      const straight = Math.hypot(p.lat - q.lat, p.lng - q.lng);
      return isA(p) || isA(q) ? straight * 400 : straight * 100;
    };

    const plan = planDaySplit({
      free: [A, B],
      existingDays: [
        { day: "2026-10-14", count: 0 },
        { day: "2026-10-15", count: 0 },
      ],
      limit: { stops: 1 },
      origin: DEPOT,
      distanceFn: roads,
    });

    // Nearest-first is the whole point of this sort: the first day fills with the nearest
    // order. Under byOrigin, A goes first no matter what function the caller supplied.
    expect(plan.fill[0].orderIds).toEqual(["B"]);
  });

  it("refuses the whole plan when an order has no location, and names it", () => {
    /* Not a sort problem after all. An unlocatable order BLOCKS the plan before any ordering
       happens, because a partial plan is worse than none -- a missing order would look placed.
       So the question is not "where does it sort" but "does the user learn which order is the
       problem", and `blocked` is the answer.
       (It also means byOrigin's 0-for-unmeasurable branch was unreachable: the guard above
       already refused. The MAX_SAFE_INTEGER in `rank` is belt-and-braces, not the fix.) */
    const plan = planDaySplit({
      free: [order("Z", null, null), order("A", 35.71, 51.41)],
      existingDays: [{ day: "2026-10-14", count: 0 }],
      limit: { stops: 1 },
      origin: DEPOT,
      distanceFn: straightLine,
    });
    expect(plan.blocked).toEqual(["Z"]);
    expect(plan.fill).toEqual([]);
  });

  it("labels the straight-line fallback as approximate", () => {
    expect(isApproximate(straightLine)).toBe(true);
  });
});
});