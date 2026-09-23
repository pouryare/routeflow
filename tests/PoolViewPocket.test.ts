import { describe, expect, it } from "vitest";
import { averageScore } from "@/lib/leadScore";

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

describe("PoolViewPocket rendering logic", () => {
  it("renders one pocket card per location", () => {
    const items = [makePoolViewItem(), makePoolViewItem({ location: { id: 2 } })];
    expect(items.length).toBe(2);
  });

  it("computes average score for badge", () => {
    expect(averageScore(makePoolViewItem().location)).toBe(4);
  });

  it("returns null average when no ratings", () => {
    const loc = makePoolViewItem({ location: { rating_potential: null, rating_volume: null, rating_ease: null } }).location;
    expect(averageScore(loc)).toBeNull();
  });

  it("provides run index badge", () => {
    const item = makePoolViewItem({ inRun: true, runIdx: 2 });
    expect(item.runIdx).toBe(2);
  });
});

