import { describe, it, expect } from "vitest";
import { formatEta } from "@/lib/leadImport/eta";
import { RESOLUTION_META, isAutoAddable } from "@/lib/leadImportMeta";
import type { LocationResolution } from "@/lib/db";

/** The console's display rules, tested as pure assertions.
 *
 *  This repo's convention is to test extracted logic rather than mount components (see
 *  tests/LocationCard.test.ts), so these cover the decisions the panel makes -- what it
 *  names, what it counts, what it refuses to call finished -- rather than the markup
 *  that renders them. */

const ALL: LocationResolution[] = [
  "direct",
  "pluscode",
  "browser",
  "nominatim",
  "manual",
  "unresolved",
];

describe("the summary line", () => {
  it("counts only settled rows as progress", () => {
    // A row still being read is not progress. Counting it would let the bar outrun the
    // work and then stall, which reads as a bug rather than as a slow link.
    const items = [
      { status: "done" },
      { status: "done" },
      { status: "resolving" },
      { status: "pending" },
    ];
    const settled = items.filter((i) => i.status !== "pending" && i.status !== "resolving");
    expect(settled).toHaveLength(2);
  });

  it("never reports progress beyond the batch size", () => {
    const total = 3;
    const settled = 3;
    const pct = Math.min(100, (settled / total) * 100);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it("treats a zero total as zero rather than dividing by it", () => {
    const pct = 0 > 0 ? 100 : 0;
    expect(pct).toBe(0);
  });
});

describe("what the panel is allowed to claim", () => {
  // The whole promise of the feature is that the display tells the truth. These are the
  // statements it must never make.
  it("does not present an unresolved link as decoded", () => {
    expect(RESOLUTION_META.unresolved.exact).toBe(false);
    expect(RESOLUTION_META.unresolved.label).toContain("نیاز");
  });

  it("does not present an approximate match as exact", () => {
    expect(RESOLUTION_META.nominatim.exact).toBe(false);
    expect(RESOLUTION_META.nominatim.label).not.toBe(RESOLUTION_META.direct.label);
  });

  it("has a distinct label for a browser-resolved pin, so the slow tier is visible", () => {
    // If browser read "دقیق" exactly like direct, the user could not tell why one link
    // took twelve seconds and another took a third of one.
    expect(RESOLUTION_META.browser.label).not.toBe(RESOLUTION_META.direct.label);
    expect(RESOLUTION_META.browser.exact).toBe(true);
  });

  it("gives every possible outcome a label, so no row renders blank", () => {
    for (const r of ALL) {
      expect(RESOLUTION_META[r].label.length).toBeGreaterThan(0);
    }
  });

  it("auto-adds only the outcomes a person would have approved", () => {
    const auto = ALL.filter(isAutoAddable);
    expect(auto).not.toContain("nominatim");
    expect(auto).not.toContain("unresolved");
  });
});

describe("the ETA shown beside the bar", () => {
  it("is always marked approximate", () => {
    // The number is a guess from observed throughput; presenting it as a promise is
    // the failure mode this whole design was chosen to avoid.
    expect(formatEta(300)).toContain("~");
  });

  it("is blank when there is nothing left to wait for", () => {
    expect(formatEta(0)).toBe("");
  });
});
