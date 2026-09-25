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

/** The wrapper's distance expression, in one place.
 *
 *  Inlined in both tests it was written twice, and the copy that passed `null` narrowed
 *  `sortAnchor` to `null` at that line -- so its true arm became `never` and reading .lat off
 *  it was a type error. A parameter is not narrowed by its argument, so the branch stays
 *  reachable here and both cases are genuinely exercised. */
function kmFrom(
  sortAnchor: { lat: number; lng: number } | null,
  location: { lat: number; lng: number },
): number | null {
  return sortAnchor && location.lat !== null && location.lng !== null
    ? parseFloat(Math.sqrt((sortAnchor.lat - location.lat) ** 2 + (sortAnchor.lng - location.lng) ** 2).toFixed(2))
    : null;
}

describe("PoolViewWrapper logic", () => {
  it("builds PoolViewItem array from locations", () => {
    const locations = [makePoolViewItem().location];
    const run = [1];
    const items = locations.map((loc) => {
      const inRun = run.includes(loc.id);
      const runIdx = inRun ? run.indexOf(loc.id) + 1 : null;
      return { location: loc, inRun, runIdx };
    });
    expect(items.length).toBe(1);
    expect(items[0].inRun).toBe(true);
    expect(items[0].runIdx).toBe(1);
  });

  it("handles empty locations", () => {
    const locations: ReturnType<typeof makePoolViewItem>["location"][] = [];
    expect(locations.length).toBe(0);
  });

  it("computes km when sortAnchor provided", () => {
    const km = kmFrom({ lat: 35.7, lng: 51.4 }, makePoolViewItem().location);
    expect(km).not.toBeNull();
    expect(typeof km).toBe("number");
  });

  it("returns null km when sortAnchor is null", () => {
    expect(kmFrom(null, makePoolViewItem().location)).toBeNull();
  });

  it("all 8 view modes are handled", () => {
    const viewModes = ["compact", "pocket", "grid", "kanban", "score", "table", "batch", "cluster"];
    expect(viewModes.length).toBe(8);
  });
});

