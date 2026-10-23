import { describe, expect, it, vi, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { isRealIsoDate } from "@/lib/isoDate";
import { clamp, round2 } from "@/lib/math";
import { jalaliMonthKey, jalaliYmd } from "@/lib/jalali";
import { withRunningBalance } from "@/lib/runningBalance";
import { withEntityLabels } from "@/lib/repo/entityLabels";
import { sqliteDb } from "@/lib/database/client";
import { compareTaskCards } from "@/lib/repo/taskCard";
import { routeLength, straightLine } from "@/lib/routing/distance";
import { reorderGain } from "@/lib/routing/reorderGain";
import { fetchOsrmJson } from "@/lib/routing/osrmFetch";
import { fromMatrix } from "@/lib/routing/distance";

describe("isRealIsoDate", () => {
  it("rejects dates that Date.parse alone would roll over", () => {
    // The commission-tiers route used `Date.parse`, which accepts 2026-02-30 as 2 March.
    expect(Number.isNaN(Date.parse("2026-02-30"))).toBe(false);
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("2026-04-31")).toBe(false);
    expect(isRealIsoDate("2026-13-01")).toBe(false);
  });
  it("accepts real dates, including a leap day, and rejects non-dates", () => {
    expect(isRealIsoDate("2026-06-15")).toBe(true);
    expect(isRealIsoDate("2028-02-29")).toBe(true);
    expect(isRealIsoDate("2026-02-29")).toBe(false);
    expect(isRealIsoDate("26-6-15")).toBe(false);
    expect(isRealIsoDate(20260615)).toBe(false);
    expect(isRealIsoDate(null)).toBe(false);
  });
});

describe("math", () => {
  it("clamps into [lo, hi]", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
  it("rounds to two places", () => {
    expect(round2(1.005 * 1000)).toBe(1005);
    expect(round2(35.123456)).toBe(35.12);
  });
});

describe("jalali keys", () => {
  it("puts two days of one Gregorian month in different Persian months", () => {
    // 2026-08-20 and 2026-08-25 straddle 1 Shahrivar.
    expect(jalaliMonthKey("2026-08-20")).not.toBe(jalaliMonthKey("2026-08-25"));
    expect(jalaliYmd("2026-08-26T21:00:00Z")).toBe("1405-06-05");
  });
  it("falls back to the ISO prefix for a non-date", () => {
    expect(jalaliMonthKey("not-a-date")).toBe("not-a-d");
    expect(jalaliYmd("not-a-date")).toBe("not-a-date");
  });
});

describe("withRunningBalance", () => {
  const rows = [
    { side: "C", amountToman: 100 },
    { side: "D", amountToman: 30 },
    { side: "C", amountToman: 5 },
  ];
  it("adds the increasing side, subtracts the other, and reports the closing balance", () => {
    const { lines, closingToman } = withRunningBalance(rows, "C");
    expect(lines.map((l) => l.balanceToman)).toEqual([100, 70, 75]);
    expect(closingToman).toBe(75);
  });
  it("starts from an opening balance and flips with the normal side", () => {
    const { lines, closingToman } = withRunningBalance(rows, "D", 10);
    expect(lines.map((l) => l.balanceToman)).toEqual([-90, -60, -65]);
    expect(closingToman).toBe(-65);
  });
  it("returns the opening balance for an empty statement", () => {
    expect(withRunningBalance([], "D", 42)).toEqual({ lines: [], closingToman: 42 });
  });
});

describe("withEntityLabels", () => {
  const raw = new DatabaseSync(":memory:");
  const db = sqliteDb(() => raw);
  raw.exec(`CREATE TABLE customers (id INTEGER PRIMARY KEY, business_name TEXT);
           CREATE TABLE districts (id INTEGER PRIMARY KEY, name TEXT);
           INSERT INTO customers VALUES (5, 'کافه الف'); INSERT INTO districts VALUES (5, 'منطقه ۵');`);
  it("labels by type, so customer 5 and district 5 do not collide", async () => {
    const out = await withEntityLabels(db, [
      { entity_type: "customer", entity_id: 5 },
      { entity_type: "district", entity_id: 5 },
    ]);
    expect(out.map((r) => r.label)).toEqual(["کافه الف", "منطقه ۵"]);
  });
  it("names a deleted target rather than leaving a blank", async () => {
    const out = await withEntityLabels(db, [
      { entity_type: "customer", entity_id: 99 },
      { entity_type: "district", entity_id: 99 },
    ]);
    expect(out.map((r) => r.label)).toEqual(["مشتری حذف‌شده", "منطقه حذف‌شده"]);
  });
  it("handles no rows, and keeps the row's own fields", async () => {
    expect(await withEntityLabels(db, [])).toEqual([]);
    expect((await withEntityLabels(db, [{ entity_type: "customer", entity_id: 5, extra: 1 }]))[0].extra).toBe(1);
  });
});

describe("compareTaskCards", () => {
  it("orders by priority, then soonest due, undated last", () => {
    const cards = [
      { id: "low", priority: "LOW", due_at: "2026-01-01" },
      { id: "undated", priority: "HIGH", due_at: null },
      { id: "soon", priority: "HIGH", due_at: "2026-01-02" },
      { id: "crit", priority: "CRITICAL", due_at: "2026-09-09" },
      { id: "unknown", priority: "WHATEVER", due_at: "2026-01-01" },
    ];
    expect([...cards].sort(compareTaskCards).map((c) => c.id)).toEqual([
      "crit", "soon", "undated", "unknown", "low",
    ]);
  });
});

describe("routeLength / reorderGain", () => {
  const origin = { lat: 35.7, lng: 51.4 };
  // Deliberately zig-zag: far, near, far, near. A good order walks them in a line.
  const stops = [
    { id: 1, lat: 35.7, lng: 51.9 },
    { id: 2, lat: 35.7, lng: 51.5 },
    { id: 3, lat: 35.7, lng: 51.8 },
    { id: 4, lat: 35.7, lng: 51.6 },
  ];
  it("sums origin -> stops, optionally back home", () => {
    const out = routeLength(straightLine, origin, stops.slice(0, 1), false);
    expect(routeLength(straightLine, origin, stops.slice(0, 1), true)).toBeCloseTo(out * 2, 6);
    expect(routeLength(straightLine, origin, [], true)).toBe(0);
  });
  it("reports a positive saving that matches the lengths it compared", () => {
    const g = reorderGain(origin, stops, false, straightLine);
    const before = routeLength(straightLine, origin, stops, false);
    const after = routeLength(straightLine, origin, g.improved, false);
    expect(g.savedKm).toBeCloseTo(before - after, 6);
    expect(g.savedKm).toBeGreaterThan(0);
    expect(g.savedPct).toBeCloseTo((g.savedKm / before) * 100, 6);
    expect(g.improved.map((s) => s.id).sort()).toEqual([1, 2, 3, 4]);
  });
  it("finds nothing to save on an already-straight day, and tolerates a zero-length one", () => {
    const sorted = [...stops].sort((a, b) => a.lng - b.lng);
    expect(reorderGain(origin, sorted, false, straightLine).savedPct).toBe(0);
    expect(reorderGain(origin, [{ id: 1, ...origin }, { id: 2, ...origin }], false, straightLine).savedPct).toBe(0);
  });
});

describe("fromMatrix indexing", () => {
  it("answers about the points the table was fetched for, wherever the caller's subset sits", () => {
    // The leads page used to index a table fetched for ALL routable points with the shorter
    // `available` list, so position 1 meant a different stop in each.
    const routable = [
      { lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 },
    ];
    const km = [[0, 10, 20], [10, 0, 5], [20, 5, 0]];
    const fn = fromMatrix(routable, km);
    // available = routable minus the first stop: (2,2) <-> (3,3) must read the 5, not the 10.
    expect(fn(routable[1], routable[2])).toBe(5);
    expect(fn(routable[0], routable[2])).toBe(20);
  });
});

describe("fetchOsrmJson", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("returns the parsed body on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ code: "Ok" }) })));
    expect(await fetchOsrmJson("https://x/")).toEqual({ code: "Ok" });
  });
  it("is null for a non-2xx, a throw, and an unparseable body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await fetchOsrmJson("https://x/")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchOsrmJson("https://x/")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => { throw new Error("bad json"); } })));
    expect(await fetchOsrmJson("https://x/")).toBeNull();
  });
  it("is null when the caller aborts", async () => {
    const c = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: { signal: AbortSignal }) =>
      new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))));
    const p = fetchOsrmJson("https://x/", c.signal);
    c.abort();
    expect(await p).toBeNull();
  });
});
