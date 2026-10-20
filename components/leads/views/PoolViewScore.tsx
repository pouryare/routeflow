"use client";

import { averageScore, LEAD_CRITERIA, scoreOf } from "@/lib/leadScore";
import type { PoolViewItem } from "./PoolViewWrapper";
import { type NavAppId } from "@/lib/navApps";
import { faNum } from "@/lib/format";

const CRITERION_COLORS: Record<string, string> = {
  potential: "bg-blue-500",
  volume: "bg-green-500",
  ease: "bg-amber-500",
};

const CRITERION_LABELS: Record<string, string> = {
  potential: "احتمال خرید",
  volume: "حجم سفارش",
  ease: "سهولت همکاری",
};

interface PoolViewScoreProps {
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

export default function PoolViewScore({
  items, selectedMapId, onSelect, priorityHigh,
}: PoolViewScoreProps) {
  // Sort by average score descending
  const sorted = [...items].sort((a, b) => {
    const sa = averageScore(a.location) ?? -1;
    const sb = averageScore(b.location) ?? -1;
    return sb - sa;
  });

  return (
    <div className="flex flex-col gap-2">
      {sorted.map(({ location: loc }) => {
        const avg = averageScore(loc);
        const scorePercent = avg !== null ? (avg / 5) * 100 : 0;
        const isSelected = loc.id === selectedMapId;

        return (
          <div
            key={loc.id}
            onClick={() => onSelect(loc.id)}
            className={`cursor-pointer rounded-[var(--radius-md)] border bg-surface p-3 hover:border-border-strong transition-colors ${
              priorityHigh ? "border-accent shadow-sm" : ""
            } ${isSelected ? "border-accent" : ""}`}
          >
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                loc.status === "contacted" ? "bg-green-500" : loc.status === "visited" ? "bg-blue-500" : loc.status === "no_answer" ? "bg-red-500" : loc.status === "declined" ? "bg-gray-500" : "bg-gray-400"
              }`} />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-[length:var(--text-sm)] text-text">{loc.name}</span>
                {loc.address && (
                  <p className="truncate text-[length:var(--text-xs)] text-text-faint">{loc.address}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Score bar */}
                <div className="w-24 h-2 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-[var(--dur-base)]"
                    style={{ width: `${scorePercent}%` }}
                  />
                </div>
                {avg !== null && (
                  <span className="text-[length:var(--text-xs)] font-mono text-accent">{faNum(avg)}</span>
                )}
              </div>
            </div>
            {/* Criterion bars */}
            <div className="mt-2 flex flex-col gap-1">
              {LEAD_CRITERIA.map((criterion) => {
                const value = scoreOf(loc, criterion.key);
                if (value === null) return null;
                const percent = (value / 5) * 100;
                return (
                  <div key={criterion.key} className="flex items-center gap-2">
                    <span className="w-20 text-[length:var(--text-xs)] text-text-faint truncate">{CRITERION_LABELS[criterion.key]}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className={`h-full rounded-full ${CRITERION_COLORS[criterion.key]}`}
                        style={{ width: `${percent}%`, opacity: 0.7 }}
                      />
                    </div>
                    <span className="w-6 text-[length:var(--text-xs)] text-text-muted font-mono text-center">{value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
