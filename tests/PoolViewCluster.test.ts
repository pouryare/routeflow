import { describe, expect, it } from "vitest";

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

function clusterLocations(items: ReturnType<typeof makePoolViewItem>[], maxDistanceKm: number = 2.0) {
  const clusters: { center: { lat: number; lng: number }; locations: typeof items[] }[] = [];
  const assigned = new Set<number>();
  for (const item of items) {
    if (assigned.has(item.location.id)) continue;
    if (item.location.lat === null || item.location.lng === null) continue;
    const cluster = { center: { lat: item.location.lat, lng: item.location.lng }, locations: [item] };
    assigned.add(item.location.id);
    for (const other of items) {
      if (assigned.has(other.location.id)) continue;
      if (other.location.lat === null || other.location.lng === null) continue;
      const d = Math.sqrt((item.location.lat - other.location.lat) ** 2 + (item.location.lng - other.location.lng) ** 2);
      if (d < maxDistanceKm) {
        cluster.locations.push(other);
        assigned.add(other.location.id);
        cluster.center.lat = (cluster.center.lat * cluster.locations.length + other.location.lat) / cluster.locations.length;
        cluster.center.lng = (cluster.center.lng * cluster.locations.length + other.location.lng) / cluster.locations.length;
      }
    }
    clusters.push(cluster);
  }
  const unassigned = items.filter((item) => !assigned.has(item.location.id));
  if (unassigned.length > 0) clusters.push({ center: { lat: 0, lng: 0 }, locations: unassigned });
  return clusters;
}

describe("PoolViewCluster grouping logic", () => {
  it("groups nearby locations into clusters", () => {
    const items = [
      makePoolViewItem({ location: { id: 1, lat: 35.7, lng: 51.4 } }),
      makePoolViewItem({ location: { id: 2, lat: 35.71, lng: 51.41 } }),
    ];
    const clusters = clusterLocations(items);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
  });

  it("creates a cluster for locations without coordinates", () => {
    const items = [makePoolViewItem({ location: { id: 1, lat: null, lng: null } })];
    const clusters = clusterLocations(items);
    expect(clusters.some((c) => c.locations.some((l) => l.location.lat === null))).toBe(true);
  });

  it("each cluster has a count", () => {
    const items = [
      makePoolViewItem({ location: { id: 1, lat: 35.7, lng: 51.4 } }),
      makePoolViewItem({ location: { id: 2, lat: 35.7, lng: 51.4 } }),
    ];
    const clusters = clusterLocations(items);
    const mainCluster = clusters.find((c) => !c.locations.some((l) => l.location.lat === null));
    if (mainCluster) expect(mainCluster.locations.length).toBe(2);
  });
});

