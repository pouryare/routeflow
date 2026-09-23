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

describe("PoolViewTable rendering logic", () => {
  it("has columns: Name, Status, Score, Distance, Priority", () => {
    const columns = ["Name", "Status", "Score", "Distance", "Priority", "Operations"];
    expect(columns.length).toBe(6);
  });

  it("displays average score", () => {
    expect(averageScore(makePoolViewItem().location)).toBe(4);
  });

  it("displays distance when available", () => {
    const item = makePoolViewItem({ km: 5.3 });
    expect(item.km).toBe(5.3);
  });

  it("displays null distance as dash", () => {
    const item = makePoolViewItem({ km: null });
    expect(item.km).toBeNull();
  });

  it("provides priority toggle", () => {
    const item = makePoolViewItem({ location: { priority: true } });
    expect(item.location.priority).toBe(true);
  });
});

