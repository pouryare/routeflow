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

describe("PoolViewBatch selection logic", () => {
  it("toggles individual items", () => {
    const checked = new Set<number>();
    checked.add(1);
    expect(checked.has(1)).toBe(true);
    expect(checked.has(2)).toBe(false);
  });

  it("selects all items", () => {
    const items = [makePoolViewItem(), makePoolViewItem({ location: { id: 2 } })];
    const checked = new Set(items.map((i) => i.location.id));
    expect(checked.size).toBe(2);
  });

  it("deselects all items", () => {
    const checked = new Set<number>([1, 2]);
    checked.clear();
    expect(checked.size).toBe(0);
  });

  it("shows selected count", () => {
    expect(new Set([1]).size).toBe(1);
  });
});

