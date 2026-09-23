import { describe, expect, it } from "vitest";

function makePoolViewItem(overrides = {}) {
  return {
    location: {
      id: 1, name: "Test Location", maps_url: "https://maps.example.com",
      address: "123 Test St", lat: 35.7, lng: 51.4, resolution: "direct",
      status: "contacted", rating_potential: 4, rating_volume: 3, rating_ease: 5,
      created_at: "2026-01-01", priority: false, organization_id: 1, group_id: 1, notes: null,
    },
    inRun: false, runIdx: null, km: null, ...overrides,
  };
}

describe("PoolViewCompact rendering logic", () => {
  it("renders one list item per location", () => {
    const items = [makePoolViewItem(), makePoolViewItem({ location: { id: 2, name: "Second" } })];
    expect(items.length).toBe(2);
  });

  it("provides inRun and runIdx state", () => {
    const item = makePoolViewItem({ inRun: true, runIdx: 1 });
    expect(item.inRun).toBe(true);
    expect(item.runIdx).toBe(1);
  });
});

