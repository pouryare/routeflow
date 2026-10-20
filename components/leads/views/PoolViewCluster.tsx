"use client";

import { useMemo } from "react";
import SectionHead from "@/components/meridian/SectionHead";
import LocationCard from "@/components/leads/LocationCard";
import type { PoolViewItem } from "./PoolViewWrapper";
import { type NavAppId } from "@/lib/navApps";

/** Group locations into geographic clusters using simple distance threshold. */
function clusterLocations(
  items: PoolViewItem[],
  maxDistanceKm: number = 2.0
): { center: { lat: number; lng: number }; locations: PoolViewItem[] }[] {
  const clusters: { center: { lat: number; lng: number }; locations: PoolViewItem[] }[] = [];
  const assigned = new Set<number>();

  for (const item of items) {
    if (assigned.has(item.location.id)) continue;
    if (item.location.lat === null || item.location.lng === null) continue;

    const cluster = { center: { lat: item.location.lat, lng: item.location.lng }, locations: [item] };
    assigned.add(item.location.id);

    for (const other of items) {
      if (assigned.has(other.location.id)) continue;
      if (other.location.lat === null || other.location.lng === null) continue;
      const d = Math.sqrt(
        (item.location.lat - other.location.lat) ** 2 +
        (item.location.lng - other.location.lng) ** 2
      );
      if (d < maxDistanceKm) {
        cluster.locations.push(other);
        assigned.add(other.location.id);
        cluster.center.lat = (cluster.center.lat * cluster.locations.length + other.location.lat) / cluster.locations.length;
        cluster.center.lng = (cluster.center.lng * cluster.locations.length + other.location.lng) / cluster.locations.length;
      }
    }
    clusters.push(cluster);
  }

  // Add unassigned items (no coordinates) to a single cluster
  const unassigned = items.filter((item) => !assigned.has(item.location.id));
  if (unassigned.length > 0) {
    clusters.push({ center: { lat: 0, lng: 0 }, locations: unassigned });
  }

  return clusters;
}

interface PoolViewClusterProps {
  items: PoolViewItem[];
  navAppId: NavAppId;
  run: number[];
  selectedMapId: number | null;
  onSelect: (id: number) => void;
  onToggleRun: (id: number) => void;
  onPin: (id: number) => void;
  onTogglePriority: (id: number) => void;
  onAddToPlan: (id: number) => void;
  onNotesChange: (id: number, notes: string) => void;
  onNameChange?: (id: number, name: string) => void;
  sortAnchor: { lat: number; lng: number } | null;
  sortMode: string;
  priorityHigh: boolean;
}

export default function PoolViewCluster({
  items, navAppId, onSelect, onToggleRun, onPin,
  onTogglePriority, onAddToPlan, onNotesChange, onNameChange, priorityHigh,
}: PoolViewClusterProps) {
  const clusters = useMemo(() => clusterLocations(items), [items]);

  if (clusters.length === 0) {
    return <p className="py-4 text-center text-[length:var(--text-xs)] text-text-faint">مکانی برای نمایش وجود ندارد</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {clusters.map((cluster, idx) => {
        const isDefault = cluster.locations.some((item) => item.location.lat === null);
        return (
          <section key={idx} className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
            <SectionHead
              as="h3"
              className="mb-2 text-[length:var(--text-sm)] font-semibold text-text"
              title={isDefault ? "بدون مختصات" : `منطقه ${idx + 1} (${cluster.locations.length})`}
            />
            <div className="flex flex-col gap-2">
              {cluster.locations.map(({ location: loc, inRun, runIdx, km, assignedTo }) => (
                <div key={loc.id} onClick={() => onSelect(loc.id)} className="cursor-pointer">
                  <LocationCard
                    location={loc}
                    assignedTo={assignedTo}
                    inRun={inRun}
                    navAppId={navAppId}
                    onPin={() => onPin(loc.id)}
                    onNameChange={(name) => onNameChange?.(loc.id, name)}
                    runIdx={runIdx}
                    onToggleRun={() => onToggleRun(loc.id)}
                    priorityHigh={priorityHigh}
                    km={km}
                    onTogglePriority={() => onTogglePriority(loc.id)}
                    onAddToPlan={() => onAddToPlan(loc.id)}
                    notes={loc.notes}
                    onNotesChange={(notes) => onNotesChange(loc.id, notes)}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
