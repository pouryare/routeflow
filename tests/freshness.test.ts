import { describe, expect, it } from "vitest";
import { daysSince, freshnessTier, newestSync } from "@/lib/freshness";

const now = new Date("2026-08-23T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe("daysSince", () => {
  it("counts whole days", () => {
    expect(daysSince(daysAgo(3), now)).toBe(3);
    expect(daysSince(daysAgo(0), now)).toBe(0);
  });

  it("treats a future timestamp as current rather than negative", () => {
    // Reachable whenever the browser's clock disagrees with the server's, and "-1 days
    // old" in the UI reads as a bug rather than as a clock skew.
    expect(daysSince(new Date(now.getTime() + 86_400_000).toISOString(), now)).toBe(0);
  });

  it("returns null for absent or unparseable input", () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("not a date", now)).toBeNull();
  });
});

describe("freshnessTier", () => {
  it("is fresh inside a week", () => {
    expect(freshnessTier(daysAgo(0), now)).toBe("fresh");
    expect(freshnessTier(daysAgo(6), now)).toBe("fresh");
  });

  it("turns at exactly a week and again at a fortnight", () => {
    expect(freshnessTier(daysAgo(7), now)).toBe("ageing");
    expect(freshnessTier(daysAgo(13), now)).toBe("ageing");
    expect(freshnessTier(daysAgo(14), now)).toBe("stale");
  });

  it("is unknown rather than fresh when there is no timestamp", () => {
    // The distinction matters: "never imported" must not read as "imported just now".
    expect(freshnessTier(null, now)).toBe("unknown");
  });
});

describe("newestSync", () => {
  it("takes the most recent, ignoring rows that have none", () => {
    expect(
      newestSync([
        { synced_at: daysAgo(9) },
        { synced_at: null },
        { synced_at: daysAgo(2) },
        { synced_at: daysAgo(30) },
      ])
    ).toBe(daysAgo(2));
  });

  it("returns null when nothing has ever synced", () => {
    expect(newestSync([{ synced_at: null }])).toBeNull();
    expect(newestSync([])).toBeNull();
  });
});
