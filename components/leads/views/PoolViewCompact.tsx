"use client";

import LocationCard from "@/components/leads/LocationCard";
import type { PoolViewItem } from "./PoolViewWrapper";
import { type NavAppId } from "@/lib/navApps";

interface PoolViewCompactProps {
  items: PoolViewItem[];
  linkedId: number | null;
  linkedRef: React.RefObject<HTMLLIElement | null>;
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

export default function PoolViewCompact({
  items, linkedId, linkedRef, navAppId, onSelect, onToggleRun, onPin,
  onTogglePriority, onAddToPlan, onNotesChange, onNameChange, priorityHigh,
}: PoolViewCompactProps) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map(({ location: loc, inRun, runIdx, km, assignedTo }, idx) => {
        const isLinked = loc.id === linkedId;
        return (
          <li
            key={loc.id ?? `compact-${idx}`}
            ref={isLinked ? linkedRef : null}
            onClick={() => onSelect(loc.id)}
            className="cursor-pointer"
          >
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
          </li>
        );
      })}
    </ul>
  );
}
