"use client";

import { SavedLocation } from "@/app/(shell)/leads/hooks/useLeads";
import { type NavAppId } from "@/lib/navApps";
import { distanceKm } from "@/lib/geo";
import PoolViewCompact from "./PoolViewCompact";
import PoolViewPocket from "./PoolViewPocket";
import PoolViewGrid from "./PoolViewGrid";
import PoolViewKanban from "./PoolViewKanban";
import PoolViewScore from "./PoolViewScore";
import PoolViewTable from "./PoolViewTable";
import PoolViewBatch from "./PoolViewBatch";
import PoolViewCluster from "./PoolViewCluster";
import EmptyState from "@/components/EmptyState";
import { SkeletonRows } from "@/components/Skeleton";
import { type LeadViewMode } from "@/lib/leadViews";

interface PoolViewWrapperProps {
  viewMode: LeadViewMode;
  locations: SavedLocation[];
  loading: boolean;
  navAppId: NavAppId;
  run: number[];
  selectedMapId: number | null;
  linkedId: number | null;
  linkedRef: React.RefObject<HTMLLIElement | null>;
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

// Enriched item passed to each view component
export interface PoolViewItem {
  location: SavedLocation;
  inRun: boolean;
  runIdx: number | null;
  km: number | null;
}

export default function PoolViewWrapper(props: PoolViewWrapperProps) {
  const { viewMode, locations, loading, run, sortAnchor } = props;

  if (loading) {
    return <SkeletonRows />;
  }

  if (locations.length === 0) {
    return (
      <EmptyState icon="search" title="لیدی یافت نشد" hint="لیدی با این فیلتری یافت نشد" />
    );
  }

  const items: PoolViewItem[] = locations.map((loc) => {
    const inRun = run.includes(loc.id);
    const runIdx = inRun ? run.indexOf(loc.id) + 1 : null;
    const km = sortAnchor && loc.lat !== null && loc.lng !== null
      ? parseFloat(distanceKm(sortAnchor, { lat: loc.lat, lng: loc.lng }).toFixed(2))
      : null;
    return { location: loc, inRun, runIdx, km };
  });

  const shared = {
    items,
    linkedId: props.linkedId,
    linkedRef: props.linkedRef,
    navAppId: props.navAppId,
    run: props.run,
    selectedMapId: props.selectedMapId,
    onSelect: props.onSelect,
    onToggleRun: props.onToggleRun,
    onPin: props.onPin,
    onTogglePriority: props.onTogglePriority,
    onAddToPlan: props.onAddToPlan,
    onNotesChange: props.onNotesChange,
    onNameChange: props.onNameChange,
    sortAnchor: props.sortAnchor,
    sortMode: props.sortMode,
    priorityHigh: props.priorityHigh,
  };

  switch (viewMode) {
    case "compact":
      return <PoolViewCompact {...shared} />;
    case "pocket":
      return <PoolViewPocket {...shared} />;
    case "grid":
      return <PoolViewGrid {...shared} />;
    case "kanban":
      return <PoolViewKanban {...shared} />;
    case "score":
      return <PoolViewScore {...shared} />;
    case "table":
      return <PoolViewTable {...shared} />;
    case "batch":
      return <PoolViewBatch {...shared} />;
    case "cluster":
      return <PoolViewCluster {...shared} />;
    default:
      return <PoolViewCompact {...shared} />;
  }
}
