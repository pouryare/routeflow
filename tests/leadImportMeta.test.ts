import { describe, it, expect } from "vitest";
import { RESOLUTION_META, RESOLUTION_TIER, isAutoAddable } from "@/lib/leadImportMeta";
import type { LocationResolution } from "@/lib/db";

/** Every value the database's CHECK constraint and `LocationResolution` allow. */
const ALL_RESOLUTIONS: LocationResolution[] = [
  "direct",
  "pluscode",
  "browser",
  "nominatim",
  "manual",
  "unresolved",
];

describe("RESOLUTION_META", () => {
  // The bug this guards: RESOLUTION_META had no "browser" key, so a link resolved
  // through Playwright threw on `meta.icon` when the panel rendered it. tsc could not
  // catch it because the panel declared its own narrower union of resolutions.
  it("has an entry for every resolution the resolver can return", () => {
    for (const r of ALL_RESOLUTIONS) {
      expect(RESOLUTION_META[r], `missing meta for "${r}"`).toBeDefined();
    }
  });

  it("marks the Playwright path as an outcome a user can trust", () => {
    expect(RESOLUTION_META.browser.exact).toBe(true);
    expect(RESOLUTION_META.browser.label).not.toBe(RESOLUTION_META.unresolved.label);
  });

  it("does not treat a Nominatim area match as an exact pin", () => {
    expect(RESOLUTION_META.nominatim.exact).toBe(false);
  });
});

describe("isAutoAddable", () => {
  // Auto-add writes a row nobody looked at, so a weak match must not qualify.
  it.each([
    ["direct", true],
    ["pluscode", true],
    ["browser", true],
    ["manual", true],
    ["nominatim", false],
    ["unresolved", false],
  ] as const)("%s -> %s", (resolution, expected) => {
    expect(isAutoAddable(resolution)).toBe(expected);
  });
});

describe("RESOLUTION_TIER", () => {
  // The runner spends cheap attempts first, so a URL that a plain fetch can settle
  // must never wait behind one that needs a real browser page.
  it("ranks the fetch-only resolutions ahead of the browser", () => {
    expect(RESOLUTION_TIER.direct).toBeLessThan(RESOLUTION_TIER.browser);
    expect(RESOLUTION_TIER.pluscode).toBeLessThan(RESOLUTION_TIER.browser);
  });

  it("ranks the browser ahead of the rate-limited geocoder", () => {
    expect(RESOLUTION_TIER.browser).toBeLessThan(RESOLUTION_TIER.nominatim);
  });

  it("ranks the terminal outcomes last, so nothing waits behind them", () => {
    expect(RESOLUTION_TIER.unresolved).toBeGreaterThan(RESOLUTION_TIER.nominatim);
    expect(RESOLUTION_TIER.manual).toBeGreaterThan(RESOLUTION_TIER.nominatim);
  });
});
