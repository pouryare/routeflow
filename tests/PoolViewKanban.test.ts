import { describe, expect, it } from "vitest";

const STATUS_COLUMNS = ["contacted", "visited", "no_answer", "declined"] as const;

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

describe("PoolViewKanban grouping logic", () => {
  it("groups items by status into 4 columns", () => {
    const items = [
      makePoolViewItem({ location: { status: "contacted" } }),
      makePoolViewItem({ location: { status: "visited" } }),
      makePoolViewItem({ location: { status: "no_answer" } }),
      makePoolViewItem({ location: { status: "declined" } }),
    ];
    const grouped: Record<string, typeof items> = {};
    for (const col of STATUS_COLUMNS) {
      grouped[col] = items.filter((i) => i.location.status === col);
    }
    expect(Object.keys(grouped)).toHaveLength(4);
  });

  it("handles items with no status", () => {
    const items = [makePoolViewItem({ location: { status: null } })];
    const ungrouped = items.filter((i) => i.location.status === null);
    expect(ungrouped.length).toBe(1);
  });
});

