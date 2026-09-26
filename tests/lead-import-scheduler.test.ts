import { describe, it, expect } from "vitest";
import {
  nextItem,
  plannedOrder,
  remainingByTier,
  currentMethod,
  type SchedulableItem,
} from "@/lib/leadImport/scheduler";
import type { LocationResolution } from "@/lib/db";

/** A URL that already carries coordinates, so predictTier calls it cheap.
 *  Without this the fixture would be unrealistic: a real pending item has whatever
 *  the paste contained, and the runner orders on that, not on a stored resolution. */
const EASY = "https://maps.google.com/maps/place/x/@35.7,51.4,14z";
const HARD = "https://maps.app.goo.gl/abc123";

function item(ordinal: number, resolution: LocationResolution, url = HARD): SchedulableItem {
  return { id: ordinal + 1, ordinal, resolution, maps_url: url };
}

describe("nextItem -- cheapest tier first", () => {
  // The central claim of the feature: a link a plain fetch can settle must never
  // wait behind one that needs a Chromium page, however long that page takes.
  it("prefers a direct hit over a browser item sitting earlier in the list", () => {
    const pending = [item(0, "browser"), item(1, "direct"), item(2, "nominatim")];
    expect(nextItem(pending)?.resolution).toBe("direct");
  });

  it("prefers a Plus Code hit over a browser item", () => {
    const pending = [item(0, "browser"), item(1, "pluscode")];
    expect(nextItem(pending)?.resolution).toBe("pluscode");
  });

  it("prefers the browser over the rate-limited geocoder", () => {
    const pending = [item(0, "nominatim"), item(1, "browser")];
    expect(nextItem(pending)?.resolution).toBe("browser");
  });

  it("keeps paste order within a single tier, so the list fills predictably", () => {
    const pending = [item(7, "direct"), item(3, "direct"), item(5, "direct")];
    expect(nextItem(pending)?.ordinal).toBe(3);
  });

  it("returns undefined when nothing is pending", () => {
    expect(nextItem([])).toBeUndefined();
  });

  it("does not mutate the input list", () => {
    const pending = [item(0, "browser"), item(1, "direct")];
    const copy = [...pending];
    nextItem(pending);
    expect(pending).toEqual(copy);
  });
});

describe("plannedOrder", () => {
  // A whole-batch assertion: drain the queue in this order and every fetch-settleable
  // link is done before the first browser page is ever opened.
  it("drains every fetch-settleable item before touching the browser", () => {
    const pending = [
      item(0, "nominatim"),
      item(1, "browser"),
      item(2, "direct"),
      item(3, "pluscode"),
      item(4, "browser"),
      item(5, "direct"),
    ];
    const order = plannedOrder(pending).map((i) => i.resolution);
    // direct and pluscode share a tier -- both settle with a plain fetch -- so they
    // interleave by paste ordinal (2, 3, 5) rather than grouping by label.
    expect(order).toEqual(["direct", "pluscode", "direct", "browser", "browser", "nominatim"]);

    const firstBrowser = order.indexOf("browser");
    const lastCheap = order.lastIndexOf("direct");
    expect(lastCheap).toBeLessThan(firstBrowser);
  });

  it("groups the geocoder last, since it is the slowest per item", () => {
    const order = plannedOrder([item(0, "nominatim"), item(1, "direct"), item(2, "nominatim")]);
    expect(order[order.length - 1].resolution).toBe("nominatim");
  });
});

describe("remainingByTier", () => {
  it("counts what is still outstanding per method, for the headline sentence", () => {
    const counts = remainingByTier([
      item(0, "direct"),
      item(1, "browser"),
      item(2, "browser"),
      item(3, "nominatim"),
    ]);
    expect(counts.direct).toBe(1);
    expect(counts.browser).toBe(2);
    expect(counts.nominatim).toBe(1);
  });

  it("returns all zeroes for an empty queue", () => {
    expect(remainingByTier([])).toEqual({
      direct: 0,
      pluscode: 0,
      browser: 0,
      nominatim: 0,
      manual: 0,
      unresolved: 0,
    });
  });
});

describe("currentMethod", () => {
  it("names the most expensive thing still outstanding", () => {
    // If anything still needs a browser, saying "a browser is opening" is the truth;
    // reporting the cheap majority would hide the reason the bar is crawling.
    expect(currentMethod([item(0, "direct"), item(1, "browser")])).toBe("browser");
  });

  it("reports the geocoder once only the geocoder remains", () => {
    expect(currentMethod([item(0, "nominatim")])).toBe("nominatim");
  });

  it("is null when the run is over", () => {
    expect(currentMethod([])).toBeNull();
  });
});

describe("progress accounting", () => {
  // Counters drive the bar, so they must never be able to exceed the batch size --
  // a bar that reads 112% is worse than no bar.
  it("never exceeds the number of items in the batch", () => {
    const pending = [item(0, "direct"), item(1, "pluscode"), item(2, "browser")];
    const counts = remainingByTier(pending);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(pending.length);
  });
});
