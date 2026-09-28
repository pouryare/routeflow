"use client";

import { SavedLocation } from "@/app/(shell)/leads/hooks/useLeads";
import { faJalaliDate } from "@/lib/jalali";
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
  /** The pool's phone book, so a card can say whose lead this is. Absent on the driver's
   *  side and in any test that does not care; the chip simply does not render. */
  assignedBy?: Map<number, { driverName: string | null; runDate: string }>;
}

// Enriched item passed to each view component
export interface PoolViewItem {
  location: SavedLocation;
  inRun: boolean;
  runIdx: number | null;
  km: number | null;
  /** Set when this lead is on a driver's unfinished route. */
  assignedTo: { driverName: string | null; runDate: string } | null;
}

export default function PoolViewWrapper(props: PoolViewWrapperProps) {
  const { viewMode, locations, loading, run, sortAnchor } = props;

  if (loading) {
    return <SkeletonRows />;
  }

  if (locations.length === 0) {
    return (
      <EmptyState icon="search" title="سرنخی یافت نشد" hint="سرنخی با این فیلتری یافت نشد" />
    );
  }

  const items: PoolViewItem[] = locations.map((loc) => {
    const inRun = run.includes(loc.id);
    const runIdx = inRun ? run.indexOf(loc.id) + 1 : null;
    const km = sortAnchor && loc.lat !== null && loc.lng !== null
      ? parseFloat(distanceKm(sortAnchor, { lat: loc.lat, lng: loc.lng }).toFixed(2))
      : null;
    const held = props.assignedBy?.get(loc.id);
    return {
      location: loc,
      inRun,
      runIdx,
      km,
      assignedTo: held ? { driverName: held.driverName, runDate: faJalaliDate(held.runDate) } : null,
    };
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
