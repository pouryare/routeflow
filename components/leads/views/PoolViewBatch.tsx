"use client";

import { Icon } from "@/components/meridian/Icon";
import { useState } from "react";
import LocationCard from "@/components/leads/LocationCard";
import type { PoolViewItem } from "./PoolViewWrapper";
import { type NavAppId } from "@/lib/navApps";
import { faNum } from "@/lib/format";

interface PoolViewBatchProps {
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

export default function PoolViewBatch({
  items, navAppId, run, selectedMapId, onSelect, onToggleRun, onPin,
  onTogglePriority, onAddToPlan, onNotesChange, onNameChange, priorityHigh,
}: PoolViewBatchProps) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  const toggleAll = () => {
    if (selectAll) {
      setChecked(new Set());
      setSelectAll(false);
    } else {
      setChecked(new Set(items.map(({ location: loc }) => loc.id)));
      setSelectAll(true);
    }
  };

  const toggleItem = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedCount = checked.size;

  return (
    <div>
      {selectedCount > 0 && (
        <div className="mb-2 flex items-center gap-3 rounded-[var(--radius-md)] border border-accent bg-accent/10 px-4 py-2">
          <span className="text-[length:var(--text-sm)] text-accent font-mono">{selectedCount} انتخاب شده</span>
          <button
            type="button"
            onClick={() => {
              items.filter(({ location: loc }) => checked.has(loc.id))
                .forEach(({ location: loc }) => onToggleRun(loc.id));
            }}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-accent text-accent hover:bg-accent hover:text-accent-ink transition-colors"
          >
            افزودن به مسیر
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setChecked(new Set()); setSelectAll(false); }}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-border text-text-faint hover:border-accent hover:text-accent transition-colors"
          >
            پاک کردن
          </button>
        </div>
      )}

      <ul className="flex flex-col gap-1">
        <li className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
          <button type="button" onClick={toggleAll} className="h-5 w-5 shrink-0 rounded border border-border hover:border-accent text-[length:var(--text-xs)]">
            {selectAll ? <Icon name="check" size="sm" /> : null}
          </button>
          <span className="text-[length:var(--text-xs)] text-text-muted">انتخاب همه</span>
        </li>

        {items.map(({ location: loc, inRun, runIdx, km, assignedTo }) => {
          const isChecked = checked.has(loc.id);
          return (
            <li
              key={loc.id}
              onClick={() => onSelect(loc.id)}
              className={`cursor-pointer rounded-[var(--radius-md)] border transition-colors ${
                isChecked ? "border-accent bg-accent/5" : "border-border bg-surface hover:border-border-strong"
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={(e) => toggleItem(e, loc.id)}
                  className="h-5 w-5 shrink-0 rounded border border-border hover:border-accent text-[length:var(--text-xs)]"
                >
                  {isChecked ? <Icon name="check" size="sm" /> : null}
                </button>
                <div className="flex-1 min-w-0">
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
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
