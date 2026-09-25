"use client";

import { STATUS_META } from "@/app/(shell)/leads/hooks/useLeads";
import SectionHead from "@/components/meridian/SectionHead";
import LocationCard from "@/components/leads/LocationCard";
import type { PoolViewItem } from "./PoolViewWrapper";
import { type NavAppId } from "@/lib/navApps";
import { averageScore } from "@/lib/leadScore";

const STATUS_COLUMNS = ["contacted", "visited", "no_answer", "declined"] as const;
const STATUS_LABELS: Record<string, string> = {
  contacted: "تماس گرفته شد",
  visited: "بازدید شد",
  no_answer: "پاسخ نداد",
  declined: "رد کرد",
};
const STATUS_COLORS: Record<string, string> = {
  contacted: "border-green-500 bg-green-500/10",
  visited: "border-blue-500 bg-blue-500/10",
  no_answer: "border-red-500 bg-red-500/10",
  declined: "border-gray-500 bg-gray-500/10",
};
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

interface PoolViewKanbanProps {
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

function MinimalNameCard({
  loc,
  onSelect,
}: {
  loc: PoolViewItem["location"];
  onSelect: (id: number) => void;
}) {
  return (
    <div
      onClick={() => onSelect(loc.id)}
      className="cursor-pointer rounded-[var(--radius-md)] border border-border bg-surface p-2 hover:border-border-strong transition-colors"
    >
      <span className="text-[length:var(--text-sm)] font-medium text-text">{loc.name}</span>
    </div>
  );
}

export default function PoolViewKanban({
  items, navAppId, run, selectedMapId, onSelect, onToggleRun, onPin,
  onTogglePriority, onAddToPlan, onNotesChange, onNameChange,
  sortAnchor, sortMode, priorityHigh,
}: PoolViewKanbanProps) {
  const grouped: Record<string, PoolViewItem[]> = {};
  for (const status of STATUS_COLUMNS) {
    grouped[status] = items.filter(({ location: loc }) => loc.status === status);
  }
  // Recently added leads with no status go in the "new" column
  const now = Date.now();
  const newLeads = items.filter(({ location: loc }) =>
    loc.status === null && loc.created_at && (now - new Date(loc.created_at).getTime()) < SEVEN_DAYS
  );
  // Remaining null-status leads (older) go in the default column
  const ungrouped = items.filter(({ location: loc }) =>
    loc.status === null && !newLeads.some((n) => n.location.id === loc.id)
  );

  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {["جدید", ...STATUS_COLUMNS, ...(ungrouped.length > 0 ? ["—"] as const : [])].map((col) => {
        const colItems = col === "جدید" ? newLeads : col === "—" ? ungrouped : grouped[col] ?? [];
        const isDefault = col === "—";
        const isNew = col === "جدید";
        return (
          <div key={col} className={`min-w-[260px] rounded-[var(--radius-lg)] border p-2 ${isDefault ? "border-border bg-surface" : isNew ? "border-accent bg-accent/5" : STATUS_COLORS[col] ?? "border-border bg-surface"}`}>
            <div className="mb-2 flex items-center justify-between">
              <SectionHead
                as="h3"
                className="text-[length:var(--text-sm)] font-semibold text-text"
                title={isDefault ? "بدون وضعیت" : isNew ? "جدید" : STATUS_LABELS[col] ?? col}
              />
              <span className="rounded-full bg-border px-2 py-0.5 text-[length:var(--text-xs)] text-text-muted font-mono">
                {colItems.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {colItems.map(({ location: loc, inRun, runIdx, km }) => {
                if (isNew) {
                  return (
                    <MinimalNameCard
                      key={loc.id}
                      loc={loc}
                      onSelect={onSelect}
                    />
                  );
                }
                return (
                  <div key={loc.id} onClick={() => onSelect(loc.id)} className="cursor-pointer">
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
                );
              })}
              {colItems.length === 0 && (
                <p className="py-2 text-center text-[length:var(--text-xs)] text-text-faint">بدون آیتم</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
