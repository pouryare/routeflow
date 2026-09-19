"use client";

import { RunPanel, type RunStop } from "@/components/leads/RunPanel";
import DayGroupCard from "@/components/leads/DayGroupCard";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { useToast } from "@/components/ToastProvider";

export interface DayGroup {
  title: string;
  stops: RunStop[];
  totalKm: number | null;
  completed: number;
  total: number;
}

export interface RouteSectionProps {
  run: number[];
  runStops: RunStop[];
  totalKm: number | null;
  navAppId: any;
  routeHref: string | null;
  navigateHref: (stop: RunStop) => string;
  onMove: (id: number, dir: -1 | 1) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
  onOptimise: () => void;
  optimiseGain: number | null;
  busy: boolean;
  proposedDays: DayGroup[] | null;
  onAddDayToRun: (dayIndex: number) => void;
  onCreateListFromDay: (title: string, ids: number[]) => void;
}

export default function RouteSection({
  run,
  runStops,
  totalKm,
  navAppId,
  routeHref,
  navigateHref,
  onMove,
  onRemove,
  onClear,
  onOptimise,
  optimiseGain,
  busy,
  proposedDays,
  onAddDayToRun,
  onCreateListFromDay,
}: RouteSectionProps) {
  const toast = useToast();

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="sechead__title">
          {run.length > 0 ? `مسیر فعلی (${faNum(run.length)})` : "مسیر فعلی"}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Next stop banner for driver view */}
          {run.length > 0 && runStops.length > 0 && (
            <span className="shrink-0 rounded bg-good/15 px-2 py-1 text-[length:var(--text-xs)] text-good font-mono">
              <Icon name="flag" size="sm" /> بعدی: {runStops[0]?.name ?? "—"}
            </span>
          )}
        </div>
      </div>

      {run.length === 0 ? (
        <div className="text-center py-6">
          <Icon name="compass" size="lg" className="mx-auto text-text-faint mb-2" />
          <p className="text-[length:var(--text-sm)] text-text-muted">مسیری انتخاب نشده</p>
          <p className="text-[length:var(--text-xs)] text-text-faint mt-1">
            از فهرست بالا هر مکانی را بزنید تا به مسیر اضافه شود
          </p>
        </div>
      ) : (
        <RunPanel
          stops={runStops}
          totalKm={totalKm}
          navAppId={navAppId}
          routeHref={routeHref}
          navigateHref={navigateHref}
          onMove={onMove}
          onRemove={onRemove}
          onClear={onClear}
          onOptimise={onOptimise}
          optimiseGain={optimiseGain}
          busy={busy}
        />
      )}

      {/* ---- proposed day groups --------------------------------------------- */}
      {proposedDays && proposedDays.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          <h3 className="text-[length:var(--text-xs)] font-medium text-text-faint uppercase tracking-wider">
            پیشنهادات روز
          </h3>
          <div className="flex flex-col gap-3">
            {proposedDays.map((day, i) => (
              <div key={i}>
                <DayGroupCard day={day} onTapFlow={(stopId) => toast(`stop ${stopId}`, "info")} />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <button
                    onClick={() => onAddDayToRun(i)}
                    className="rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent hover:bg-accent hover:text-accent-ink"
                  >
                    بردن به مسیر
                  </button>
                  <button
                    onClick={() => onCreateListFromDay(`روز ${i + 1}`, day.stops.map((s) => s.id))}
                    disabled={busy}
                    className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    ذخیره به‌عنوان فهرست
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
