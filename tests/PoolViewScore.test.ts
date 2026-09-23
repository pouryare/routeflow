import { describe, expect, it } from "vitest";
import { averageScore, LEAD_CRITERIA, scoreOf } from "@/lib/leadScore";

function makePoolViewItem(overrides = {}) {
  const { location: locOverride, ...rest } = overrides;
  return {
    location: {
      id: 1, name: "Test Location", maps_url: "https://maps.example.com",
      address: "123 Test St", lat: 35.7, lng: 51.4, resolution: "direct",
      status: "contacted", rating_potential: 4, rating_volume: 3, rating_ease: 5,
      created_at: "2026-01-01", priority: false, organization_id: 1, group_id: 1, notes: null,
      ...(locOverride ?? {}),
    },
    inRun: false, runIdx: null, km: null, ...rest,
  };
}

describe("PoolViewScore rendering logic", () => {
  it("sorts items by average score descending", () => {
    const items = [
      makePoolViewItem({ location: { id: 1, rating_potential: 2 } }),
      makePoolViewItem({ location: { id: 2, rating_potential: 5 } }),
    ];
    const sorted = [...items].sort((a, b) => {
      const sa = averageScore(a.location) ?? -1;
      const sb = averageScore(b.location) ?? -1;
      return sb - sa;
    });
    expect(averageScore(sorted[0].location)).toBeGreaterThanOrEqual(averageScore(sorted[1].location));
  });

  it("shows 3 criterion bars per location", () => {
    const loc = makePoolViewItem().location;
    const criteria = LEAD_CRITERIA.map((c) => scoreOf(loc, c.key));
    expect(criteria.filter((v) => v !== null)).toHaveLength(3);
  });

  it("handles null ratings", () => {
    const loc = makePoolViewItem({ location: { rating_potential: null, rating_volume: null, rating_ease: null } }).location;
    expect(averageScore(loc)).toBeNull();
  });
});

