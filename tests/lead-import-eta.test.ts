import { describe, it, expect } from "vitest";
import { estimateEtaSeconds, formatEta, TIER_COST_MS } from "@/lib/leadImport/eta";
import type { LocationResolution } from "@/lib/db";

function remaining(overrides: Partial<Record<LocationResolution, number>> = {}) {
  return {
    direct: 0,
    pluscode: 0,
    browser: 0,
    nominatim: 0,
    manual: 0,
    unresolved: 0,
    ...overrides,
  } as Record<LocationResolution, number>;
}

describe("estimateEtaSeconds", () => {
  it("is zero only when nothing is left", () => {
    expect(estimateEtaSeconds({ remaining: remaining(), elapsedMs: 5000, completed: 10 })).toBe(0);
  });

  // The spec's first invariant. "۰:۰۰" beside a bar that is still moving reads as a bug,
  // and is worse than showing no estimate at all.
  it("never reports zero while links remain", () => {
    const eta = estimateEtaSeconds({ remaining: remaining({ direct: 1 }), elapsedMs: 0, completed: 0 });
    expect(eta).toBeGreaterThan(0);
  });

  it("stays positive when a run has done plenty of work very fast", () => {
    const eta = estimateEtaSeconds({
      remaining: remaining({ nominatim: 1 }),
      elapsedMs: 100,
      completed: 500,
    });
    expect(eta).toBeGreaterThan(0);
  });

  // The spec's defining behaviour: the number is ALLOWED TO GROW. As the cheap tier
  // drains, each remaining link costs more, so the per-link estimate rises. An ETA that
  // only ever shrinks is a bar lying to make itself feel better.
  // Compared per outstanding link, not on absolute seconds: 1000 cheap links are more
  // total work than 100 slow ones, and pretending otherwise would prove nothing.
  it("raises the per-link estimate as the batch turns over to slower methods", () => {
    const cheap = estimateEtaSeconds({
      remaining: remaining({ direct: 1000 }),
      elapsedMs: 0,
      completed: 0,
    }) / 1000;
    const slow = estimateEtaSeconds({
      remaining: remaining({ browser: 1000 }),
      elapsedMs: 0,
      completed: 0,
    }) / 1000;
    expect(slow).toBeGreaterThan(cheap);
  });

  it("lets the total estimate grow when a big cheap batch gives way to a slow tail", () => {
    // Same remaining count, worse mix: the honest number goes up rather than down.
    const beforeTail = estimateEtaSeconds({
      remaining: remaining({ direct: 100, browser: 100 }),
      elapsedMs: 0,
      completed: 0,
    });
    const afterCheapTierDrains = estimateEtaSeconds({
      remaining: remaining({ browser: 200 }),
      elapsedMs: 0,
      completed: 0,
    });
    expect(afterCheapTierDrains).toBeGreaterThan(beforeTail);
  });

  it("models a browser page as far slower than a URL coordinate hit", () => {
    const viaBrowser = estimateEtaSeconds({
      remaining: remaining({ browser: 10 }),
      elapsedMs: 0,
      completed: 0,
    });
    const viaDirect = estimateEtaSeconds({
      remaining: remaining({ direct: 10 }),
      elapsedMs: 0,
      completed: 0,
    });
    expect(viaBrowser).toBeGreaterThan(viaDirect);
  });

  it("trusts a genuinely fast observed rate over the modelled guess", () => {
    // 1000 links in 2s is a real signal: ~2ms per link, so 500 more is about a second.
    // The model assumes 400ms per direct hit and would say ~50s. Big enough a gap that
    // the one-second floor cannot mask the difference.
    const fast = estimateEtaSeconds({
      remaining: remaining({ direct: 500 }),
      elapsedMs: 2000,
      completed: 1000,
    });
    const modelled = estimateEtaSeconds({
      remaining: remaining({ direct: 500 }),
      elapsedMs: 0,
      completed: 0,
    });
    expect(fast).toBeLessThan(modelled);
  });

  // Too few samples and any rate is noise -- one fast link does not mean the rest are fast.
  it("ignores an observed rate built from fewer than three links", () => {
    const oneSample = estimateEtaSeconds({
      remaining: remaining({ direct: 50 }),
      elapsedMs: 1,
      completed: 1,
    });
    const noSamples = estimateEtaSeconds({
      remaining: remaining({ direct: 50 }),
      elapsedMs: 0,
      completed: 0,
    });
    expect(oneSample).toBe(noSamples);
  });

  it("scales with the number of links left", () => {
    const few = estimateEtaSeconds({ remaining: remaining({ direct: 5 }), elapsedMs: 0, completed: 0 });
    const many = estimateEtaSeconds({ remaining: remaining({ direct: 500 }), elapsedMs: 0, completed: 0 });
    expect(many).toBeGreaterThan(few);
  });

  // A thousand links is the case the whole feature exists for; it must stay sane.
  it("keeps a 1000-link worst case in a believable range, not hours", () => {
    const eta = estimateEtaSeconds({
      remaining: remaining({ browser: 500, nominatim: 500 }),
      elapsedMs: 0,
      completed: 0,
    });
    expect(eta).toBeGreaterThan(60);
    expect(eta).toBeLessThan(60 * 60);
  });

  it("does not count terminal outcomes as outstanding work", () => {
    const withTerminals = estimateEtaSeconds({
      remaining: remaining({ direct: 10, unresolved: 500, manual: 500 }),
      elapsedMs: 0,
      completed: 0,
    });
    const clean = estimateEtaSeconds({ remaining: remaining({ direct: 10 }), elapsedMs: 0, completed: 0 });
    expect(withTerminals).toBe(clean);
  });

  it("treats manual and unresolved as costing nothing further", () => {
    expect(TIER_COST_MS.unresolved).toBe(0);
    expect(TIER_COST_MS.manual).toBe(0);
  });
});

describe("formatEta", () => {
  it("says nothing when the job is done", () => {
    expect(formatEta(0)).toBe("");
  });

  it("uses seconds under a minute and minutes above", () => {
    expect(formatEta(45)).toContain("ثانیه");
    expect(formatEta(240)).toContain("دقیقه");
  });

  it("is always marked approximate, because it is an estimate", () => {
    expect(formatEta(120).startsWith("~")).toBe(true);
  });
});
