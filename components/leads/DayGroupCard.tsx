"use client";

import { RunStop } from "@/components/leads/RunPanel";
import { Icon } from "@/components/meridian/Icon";
import { formatDistanceKm } from "@/lib/geo";
import { faNum } from "@/lib/format";

export interface DayGroup {
  title: string;
  stops: RunStop[];
  totalKm: number | null;
  completed: number;
  total: number;
}

interface DayGroupCardProps {
  day: DayGroup;
  onTapFlow: (stopId: number) => void;
}

export default function DayGroupCard({ day, onTapFlow }: DayGroupCardProps) {
  const progress = day.total > 0 ? day.completed / day.total : 0;

  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-raised border-b border-border">
        <h3 className="font-medium text-text text-[length:var(--text-sm)]">{day.title}</h3>
        <span className="font-mono text-[length:var(--text-xs)] text-text-faint">
          {day.totalKm !== null ? `${formatDistanceKm(day.totalKm)} خط مستقیم` : `${day.stops.length} توقف`}
        </span>
      </div>
      <div className="px-4 py-2">
        <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-all duration-[var(--dur-base)]" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="text-[length:var(--text-xs)] text-text-faint mt-1">
          {day.completed}/{day.total} توقف تمام شد
        </p>
      </div>
      <ol className="divide-y divide-border">
        {day.stops.map((stop, i) => (
          <li
            key={stop.id}
            className="flex items-center gap-2 px-4 py-2.5 hover:bg-surface-raised cursor-pointer transition-colors"
            onClick={() => onTapFlow(stop.id)}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[length:var(--text-xs)] text-accent">
              {faNum(i + 1)}
            </span>
            <span className="flex-1 text-text text-[length:var(--text-sm)]">{stop.name}</span>
            {stop.legKm !== null && (
              <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-text-faint">
                {formatDistanceKm(stop.legKm)}
              </span>
            )}
            <button
              type="button"
              className="shrink-0 text-text-faint hover:text-accent"
              aria-label={`مسیریابی به ${stop.name}`}
            >
              <Icon name="external-link" size="sm" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
