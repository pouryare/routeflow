"use client";

import LocationCard from "@/components/leads/LocationCard";
import type { PoolViewItem } from "./PoolViewWrapper";
import { type NavAppId } from "@/lib/navApps";

interface PoolViewGridProps {
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

export default function PoolViewGrid({
  items, navAppId, run, selectedMapId, onSelect, onToggleRun, onPin,
  onTogglePriority, onAddToPlan, onNotesChange, onNameChange, sortAnchor, sortMode, priorityHigh,
}: PoolViewGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map(({ location: loc, inRun, runIdx, km }) => (
        <div
          key={loc.id}
          onClick={() => onSelect(loc.id)}
          className="cursor-pointer"
        >
          <LocationCard
            location={loc}
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
  );
}
