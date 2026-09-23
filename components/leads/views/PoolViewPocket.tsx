"use client";

import Pocketed from "@/components/meridian/Pocketed";
import { averageScore } from "@/lib/leadScore";
import { faNum } from "@/lib/format";
import { STATUS_META } from "@/app/(shell)/leads/hooks/useLeads";
import type { PoolViewItem } from "./PoolViewWrapper";
import { type NavAppId } from "@/lib/navApps";

const STATUS_TONE: Record<string, "good" | "warn" | "crit" | "info"> = {
  contacted: "good",
  visited: "info",
  no_answer: "warn",
  declined: "crit",
};

interface PoolViewPocketProps {
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
  sortAnchor: { lat: number; lng: number } | null;
  sortMode: string;
  priorityHigh: boolean;
}

export default function PoolViewPocket({
  items, navAppId, run, selectedMapId, onSelect, onToggleRun, onPin,
  onTogglePriority, onAddToPlan, onNotesChange, sortAnchor, sortMode, priorityHigh,
}: PoolViewPocketProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map(({ location: loc, inRun, runIdx }, idx) => {
        const avg = averageScore(loc);
        const tone = loc.status ? STATUS_TONE[loc.status] ?? "info" : "info";
        const statusLabel = loc.status ? STATUS_META[loc.status] : "بدون وضعیت";
        const isSelected = loc.id === selectedMapId;

        return (
          <Pocketed
            key={loc.id ?? `pocket-${idx}`}
            papers={2}
            tone={tone}
            fan={true}
            className={`pool-pocket cursor-pointer h-full ${
              priorityHigh ? "border-accent shadow-sm" : ""
            } ${isSelected ? "border-accent" : ""}`}
          >
            <div
              onClick={() => onSelect(loc.id)}
              className="rounded-[var(--radius-md)] border border-border bg-surface p-3 hover:border-border-strong transition-colors h-full"
            >
              <div className="flex items-start gap-3">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" title={statusLabel}
                  style={{ background: `var(--${tone})` }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[length:var(--text-sm)] text-text">{loc.name}</span>
                    {inRun && (
                      <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[length:var(--text-xs)] text-accent">در مسیر</span>
                    )}
                    {loc.lat === null && (
                      <span className="shrink-0 rounded bg-border px-1.5 py-0.5 text-[length:var(--text-xs)] text-text-faint">بدون مخصرات</span>
                    )}
                  </div>
                  {loc.address && (
                    <p className="truncate text-[length:var(--text-xs)] text-text-faint mt-0.5">{loc.address}</p>
                  )}
                </div>
              </div>

              {avg !== null && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-[var(--dur-base)]"
                      style={{ width: `${(avg / 5) * 100}%` }}
                    />
                  </div>
                  <span className="text-[length:var(--text-xs)] text-text-muted font-mono">{faNum(avg)}</span>
                </div>
              )}

              <div className="mt-2 flex items-center gap-1.5">
                {onToggleRun && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleRun(loc.id); }}
                    disabled={loc.lat === null || loc.lng === null}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border font-mono text-[length:var(--text-xs)] transition-colors disabled:opacity-30 ${
                      inRun ? "border-accent bg-accent text-accent-ink" : "border-border text-text-muted hover:border-accent hover:text-accent"
                    }`}
                  >
                    {runIdx != null ? <span className="font-mono">{runIdx}</span> : "+"}
                  </button>
                )}
                {loc.lat != null && loc.lng != null && (
                  <a
                    href={`/leads?l=${loc.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-accent transition-colors hover:border-accent"
                  >
                    مسیریابی
                  </a>
                )}
              </div>
            </div>
          </Pocketed>
        );
      })}
    </div>
  );
}
