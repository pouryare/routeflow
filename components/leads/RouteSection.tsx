"use client";

import { useCardDrag } from "@/components/board/useCardDrag";
import SectionHead from "@/components/meridian/SectionHead";
import RunPanel, { type RunStop } from "@/components/leads/RunPanel";
import DayGroupCard from "@/components/leads/DayGroupCard";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import CollapsibleSection from "@/components/CollapsibleSection";
import { routeLengthKm, formatDistanceKm } from "@/lib/geo";
import { daysNeeded } from "@/lib/clusterDays";

type RoutableLocation = any;

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
  onTapFlow?: (stopId: number) => void;
  /** Manager-only: opens the "سپردن مسیر" flow from inside the current-route actions. */
  onAssignRoute?: () => void;
  /* ---- automatic day split (manager only) ------------------------------- */
  isManager: boolean;
  stopsPerDay: number;
  setStopsPerDay: (v: number) => void;
  proposeDays: () => void;
  routableLength: number;
  runOrigin: { lat: number; lng: number } | null;
  setProposedDays: (v: RoutableLocation[][] | null) => void;
  updateRun: (ids: number[]) => void;
  createList: (name: string, ids: number[]) => void;
  addToDayGroup: (dayIdx: number, location: RoutableLocation) => void;
  removeFromDayGroup: (dayIdx: number, locationId: number) => void;
  unassignedLocations: RoutableLocation[];
  repropose: () => void;
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
  onTapFlow,
  onAssignRoute,
  isManager,
  stopsPerDay,
  setStopsPerDay,
  proposeDays,
  routableLength,
  runOrigin,
  setProposedDays,
  updateRun,
  createList,
  addToDayGroup,
  removeFromDayGroup,
  unassignedLocations,
  repropose,
}: RouteSectionProps) {
  const drag = useCardDrag<RoutableLocation>({
    resolveLane: (x, y) =>
      (document.elementFromPoint(x, y) as HTMLElement | null)
        ?.closest<HTMLElement>("[data-day-index]")?.dataset.dayIndex ?? null,
    onDrop: (loc, fromLane, toLane) => {
      if (fromLane === toLane) return;
      removeFromDayGroup(Number(fromLane), loc.id);
      addToDayGroup(Number(toLane), loc);
    },
  });

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
      {/* ---- automatic day split (manager only) -------------------------------- */}
      {isManager && (
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4 mb-4">
          <CollapsibleSection
            title="تقسیم خودکار بین روزها" icon="folders"
            storageKey="leads_split"
            keywords="خوشه‌بندی روز مسیر تقسیم"
          >
            <p className="mb-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
              مکان‌ها را بر اساس نزدیکی جغرافیایی به روزها تقسیم می‌کند — نه فقط برش زدن یک فهرست مرتب‌شده.
              نتیجه یک پیشنهاد است؛ هر روزی را که پسندیدید می‌توانید به مسیر یا به یک فهرست تازه ببرید.
            </p>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-text-muted">
                تعداد مقصد در هر روز:
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={stopsPerDay}
                  onChange={(e) => setStopsPerDay(Math.max(2, Number(e.target.value) || 2))}
                  className="w-16 rounded-[var(--radius-sm)] border border-border bg-bg px-1.5 py-1 text-center text-text outline-none focus:border-accent"
                />
              </label>
              <button
                onClick={proposeDays}
                className="rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent hover:bg-accent hover:text-accent-ink"
              >
                پیشنهاد بده ({faNum(daysNeeded(routableLength, stopsPerDay))} روز)
              </button>
              {proposedDays && (
                <button
                  onClick={() => setProposedDays(null)}
                  className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-crit hover:text-crit"
                >
                  بستن پیشنهاد
                </button>
              )}
            </div>

            {proposedDays && (
              <div className="flex flex-col gap-2">
                {proposedDays.map((day, i) => {
                  const dayKm = runOrigin ? routeLengthKm(runOrigin, day.stops, false) : null;
                  return (
                    <div key={i} className="rounded-[var(--radius-md)] border border-border bg-surface p-2.5">
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[length:var(--text-sm)] text-text">
                          روز {faNum(i + 1)} — {faNum(day.stops.length)} مقصد
                          {dayKm !== null && (
                            <span className="ms-2 font-mono text-[length:var(--text-xs)] text-text-faint">
                              {formatDistanceKm(dayKm)} خط مستقیم
                            </span>
                          )}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => updateRun(day.stops.map((d) => d.id))}
                            className="rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent hover:bg-accent hover:text-accent-ink"
                          >
                            بردن به مسیر
                          </button>
                          <button
                            onClick={() => createList(`روز ${i + 1}`, day.stops.map((d) => d.id))}
                            disabled={busy}
                            className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                          >
                            ذخیره به‌عنوان فهرست
                          </button>
                        </div>
                      </div>
                      <p className="truncate text-[length:var(--text-xs)] text-text-faint">
                        {day.stops.map((d) => d.name).join(" ← ")}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CollapsibleSection>
        </section>
      )}

      {/* ---- proposed day groups (editable) -------------------------------- */}
      {proposedDays && proposedDays.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          <SectionHead
            as="h3"
            title="پیشنهادات روز"
            className="text-[length:var(--text-xs)] font-medium text-text-faint uppercase tracking-wider"
          />
          <div className="flex flex-col gap-3">
            {proposedDays.map((day, i) => (
              <div key={i} data-day-index={i} className="rounded-[var(--radius-md)] border border-border bg-surface p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[length:var(--text-sm)] text-text">
                    روز {faNum(i + 1)} — {faNum(day.stops.length)} مقصد
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={repropose}
                      className="rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent hover:bg-accent hover:text-accent-ink"
                    >
                      پیشنهاد مجدد
                    </button>
                    <button
                      onClick={() => setProposedDays(null)}
                      className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-crit hover:text-crit"
                    >
                      بستن پیشنهاد
                    </button>
                  </div>
                </div>
                {day.stops.map((stop) => (
                  <div
                    key={stop.id}
                    {...drag.bind(stop, String(i))}
                    className="flex items-center gap-2 py-1 cursor-grab active:cursor-grabbing"
                  >
                    <Icon name="grip-vertical" size="sm" className="text-text-faint shrink-0" />
                    <span className="flex-1 text-[length:var(--text-xs)] text-text">{stop.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromDayGroup(i, stop.id);
                      }}
                      className="shrink-0 text-text-faint hover:text-crit text-[length:var(--text-xs)]"
                      aria-label={`حذف ${stop.name} از روز ${i + 1}`}
                    >
                      <Icon name="x" size="sm" />
                    </button>
                  </div>
                ))}
                {unassignedLocations.length > 0 && (
                  <select
                    onChange={(e) => {
                      const locId = Number(e.target.value);
                      const loc = unassignedLocations.find((l) => l.id === locId);
                      if (loc) addToDayGroup(i, loc);
                      e.target.value = "";
                    }}
                    defaultValue=""
                    className="mt-2 w-full rounded border border-border bg-bg px-2 py-1.5 text-[length:var(--text-xs)] text-text-muted outline-none focus:border-accent"
                  >
                    <option value="" disabled>افزودن مکان به این روز…</option>
                    {unassignedLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="sechead__title">
          {run.length > 0 ? `مسیر فعلی (${faNum(run.length)})` : "مسیر فعلی"}
        </h2>
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
          onTapFlow={onTapFlow}
          onAssignRoute={onAssignRoute}
        />
      )}
    </section>
  );
}
