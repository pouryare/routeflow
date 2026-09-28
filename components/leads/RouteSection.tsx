"use client";

import { useCardDrag } from "@/components/board/useCardDrag";
import RunPanel, { type RunStop } from "@/components/leads/RunPanel";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import CollapsibleSection from "@/components/CollapsibleSection";
import { routeLengthKm, formatDistanceKm } from "@/lib/geo";
import { daysNeeded } from "@/lib/clusterDays";
import { faJalaliDate } from "@/lib/jalali";
import type { NavAppId } from "@/lib/navApps";
import type { RoutableLocation, DayStop, LastAssigned } from "@/app/(shell)/leads/hooks/useLeads";

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
  navAppId: NavAppId;
  routeHref: string | null;
  navigateHref: (stop: RunStop) => string;
  onMove: (id: number, dir: -1 | 1) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
  onOptimise: () => void;
  optimiseGain: number | null;
  busy: boolean;
  proposedDays: DayGroup[] | null;
  onTapFlow?: (stopId: number) => void;
  /** Refuses a lead that is on a driver's live route. Reached by dragging one into a day,
   *  which is the only way an assigned lead can be picked up now that the pool hides it. */
  refuseAssigned?: (id: number) => boolean;
  /** Manager-only: opens the "سپردن مسیر" flow from inside the current-route actions. */
  onAssignRoute?: () => void;
  /* ---- automatic day split (manager only) ------------------------------- */
  isManager: boolean;
  stopsPerDay: number;
  setStopsPerDay: (v: number) => void;
  proposeDays: () => void;
  routableLength: number;
  runOrigin: { lat: number; lng: number } | null;
  setProposedDays: (v: DayStop[][] | null) => void;
  updateRun: (ids: number[]) => void;
  createList: (name: string, ids: number[]) => void;
  addToDayGroup: (dayIdx: number, location: DayStop) => void;
  removeFromDayGroup: (dayIdx: number, locationId: number) => void;
  unassignedLocations: RoutableLocation[];
  /** The most recent successful hand-over, so an emptied pool is not an empty silence. */
  lastAssigned?: LastAssigned | null;
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
  onTapFlow,
  refuseAssigned,
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
  lastAssigned,
}: RouteSectionProps) {
  const drag = useCardDrag<DayStop>({
    resolveLane: (x, y) =>
      (document.elementFromPoint(x, y) as HTMLElement | null)
        ?.closest<HTMLElement>("[data-day-index]")?.dataset.dayIndex ?? null,
    onDrop: (loc, fromLane, toLane) => {
      if (fromLane === toLane) return;
      // The card snaps back untouched: nothing is removed before the refusal is known.
      if (refuseAssigned?.(loc.id)) return;
      removeFromDayGroup(Number(fromLane), loc.id);
      addToDayGroup(Number(toLane), loc);
    },
  });

  /* The automatic split's own cards already offered both of these. The editable day groups
   * below are the same proposal after a manager has dragged stops between them, and they had
   * no way to act on the result at all -- so a hand-tuned split was something you could look
   * at and nothing else. `updateRun` and `createList` are the same two handlers, not copies;
   * the `onAddDayToRun` / `onCreateListFromDay` props that duplicated them were never
   * rendered and are gone. */
  const dayActions = (i: number, day: DayGroup) => (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={() => updateRun(day.stops.map((d) => d.id))}
        className="rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent hover:bg-accent hover:text-accent-ink"
      >
        بردن به مسیر
      </button>
      <button
        onClick={() => createList(`روز ${i + 1}`, day.stops.map((d) => d.id))}
        disabled={busy || day.stops.length === 0}
        title={day.stops.length === 0 ? "این روز مکانی ندارد" : undefined}
        className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent disabled:opacity-50"
      >
        ذخیره به‌عنوان فهرست
      </button>
    </div>
  );

  /* Shown only while the pool is empty, so it never competes with the route the manager is
   * currently building. */
  const receiptLine = (() => {
    if (run.length > 0 || !lastAssigned) return null;
    // `faJalaliDate` rather than formatting it here: a hand-rolled version of this got the
    // year in Persian digits and the month and day in Latin ones, which reads as a typo and
    // which `no-gregorian-dates.test.ts` cannot see because the digits are not Gregorian.
    const day = faJalaliDate(lastAssigned.runDate);
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[length:var(--text-xs)] text-good">
        <Icon name="check" size="sm" className="shrink-0" />
        <span>
          آخرین سپرده‌شده: {lastAssigned.driverName} · {day} · {faNum(lastAssigned.stopCount)} توقف
        </span>
      </p>
    );
  })();

  /* A fragment, not a box. The day split and the current route are two separate surfaces
   * that happen to belong to the same page region: nesting one inside the other drew a
   * card in a card, and the day split's own `.sect` was a third surface inside both. */
  return (
    <>
      {/* ---- automatic day split (manager only) -------------------------------- */}
      {isManager && (
          <CollapsibleSection
            title="تقسیم خودکار بین روزها" icon="folders"
            storageKey="leads_split"
            keywords="خوشه‌بندی روز مسیر تقسیم"
            count={proposedDays?.length}
            /* `true` or `undefined`, never `false`. The prop is a three-state insist: true
               means open, false means shut, and undefined means "no opinion, use the
               remembered state". Passing `proposedDays !== null` made it false whenever
               there was no proposal yet -- and `false ?? open` is false, not open, so the
               section was pinned shut and could never be opened to press پیشنهاد بده. */
            /* Length, not plain truthiness: `[]` is truthy, so a proposal that had every
               day removed would have pinned the section open around nothing. */
            forceOpen={proposedDays && proposedDays.length > 0 ? true : undefined}
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
                onClick={() => proposeDays()}
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

            {/* One place for a day split, not two. The lanes below and the cards that used
                to sit beside them drew the same `proposedDays`, and the read-only cards
                were the only thing the lanes lacked -- the straight-line distance, now on
                each lane header. */}
      {proposedDays && proposedDays.length > 0 && (
        <div className="flex flex-col gap-3">
          {proposedDays.map((day, i) => {
            const dayKm = runOrigin ? routeLengthKm(runOrigin, day.stops, false) : null;
            return (
              <div key={i} data-day-index={i} className="rounded-[var(--radius-md)] border border-border bg-surface p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[length:var(--text-sm)] text-text">
                    روز {faNum(i + 1)} — {faNum(day.stops.length)} مقصد
                    {dayKm !== null && (
                      <span className="ms-2 font-mono text-[length:var(--text-xs)] text-text-faint">
                        {formatDistanceKm(dayKm)} خط مستقیم
                      </span>
                    )}
                  </span>
                  {dayActions(i, day)}
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
            );
          })}
          </div>
      )}
          </CollapsibleSection>
      )}

      {/* The route is its own card, a sibling of the split rather than its parent. */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">

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
            از فهرست مکان‌ها بالا هر مکانی را بزنید تا به مسیر اضافه شود
          </p>
          {receiptLine}
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
    </>
  );
}
