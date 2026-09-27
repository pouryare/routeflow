"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState, useMemo } from "react";
import { useLeads } from "./hooks/useLeads";
import { useRouteMatrix } from "./hooks/useRouteMatrix";
import { distanceKm } from "@/lib/geo";
import { faNum } from "@/lib/format";
import { useNavApp } from "@/components/NavAppSetting";
import { navigateUrl } from "@/lib/navApps";
import LeadImportPanel from "@/components/LeadImportPanel";
import { SkeletonRows } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import RunPanel from "@/components/leads/RunPanel";
import LocationTapFlow from "@/components/leads/LocationTapFlow";
import RouteSection, { type DayGroup } from "@/components/leads/RouteSection";
import PoolViewToggle from "@/components/leads/PoolViewToggle";
import DriverRunView from "@/components/leads/DriverRunView";
import LeadRunPlannerTabFlow from "@/components/leads/LeadRunPlannerTabFlow";
import PoolViewWrapper from "@/components/leads/views/PoolViewWrapper";
import { readViewMode } from "@/lib/leadViews";
import type { LeadViewMode } from "@/lib/leadViews";
import { Icon } from "@/components/meridian/Icon";
import type { SortMode } from "./hooks/useLeads";
const LeadsMap = dynamic(() => import("@/components/LeadsMap"), { ssr: false });
const LocationPinPicker = dynamic(() => import("@/components/LocationPinPicker"), { ssr: false });
import CollapsibleSection from "@/components/CollapsibleSection";
import NavAppSetting from "@/components/NavAppSetting";
import { STATUS_META } from "./hooks/useLeads";
import { averageScore } from "@/lib/leadScore";
import { clusterIntoDays, daysNeeded } from "@/lib/clusterDays";

export { STATUS_META };
// Re-exported from the hook rather than declared here: `SavedLocation` is defined in
// useLeads, and a bare `export type { SavedLocation }` with no source is a name this file
// never bound -- which is exactly what tsc said.
export type { SavedLocation } from "./hooks/useLeads";

export default function LeadsPage() {
  const {
    locations, lists, activeListId, run, loading, busy, query, sortMode,
    pinningId, setPinningId, converting, tapFlowId, setTapFlowId, stopsPerDay, proposedDaysRaw, newListName,
    selectedMapId, setSelectedMapId, isManager, sessionLoading,
    position, posStatus, posError, retryPosition, showManualPos, setShowManualPos,
    linkedId, linkedRef, sortAnchor, setSortAnchor,
    setLocations, setLists, setActiveListId, setRun, setQuery, setSortMode,
    setNewListName, setProposedDays, setStopsPerDay,
    load, createList, renameList, deleteList, openList, updateRun, addToRun,
    removeFromRun, moveInRun, optimiseRun, clearRun, proposeDays, togglePriority,
    addToDayGroup, removeFromDayGroup, remove, savePin, updateLocationName, convertToCustomer,
    runLocations, runStops, runTotalKm, optimiseGain,
    routable, visible, mapLeads, runPoints, runHref, activeList, byId,
  } = useLeads();

  const { matrix } = useRouteMatrix(routable as { lat: number; lng: number }[]);
  const [navAppId] = useNavApp();
  const [activeView, setActiveView] = useState<LeadViewMode>(readViewMode());
  const [leadRunPlannerOpen, setLeadRunPlannerOpen] = useState(false);

  const handleSelectAll = () => {
    const ids = visible.filter(({ loc }) => loc.lat !== null && loc.lng !== null).map(({ loc }) => loc.id);
    const newIds = ids.filter((id) => !run.includes(id));
    if (newIds.length === 0) return;
    updateRun([...run, ...newIds]);
  };

  // Build DayGroup[] for RouteSection from proposedDaysRaw
  const dayGroups: DayGroup[] | null = useMemo(() =>
    proposedDaysRaw ? proposedDaysRaw.map((day, i) => ({
      title: `روز ${i + 1}`,
      stops: day.map((d) => ({ id: d.id, name: d.name, lat: d.lat ?? 0, lng: d.lng ?? 0, legKm: null })),
      totalKm: null, completed: 0, total: day.length,
    })) : null, [proposedDaysRaw]
  );

  // Enhanced proposeDays that uses OSRM matrix when available
  const enhancedProposeDays = useMemo(() => {
    if (!matrix || !sortAnchor) return proposeDays;
    return () => {
      const k = daysNeeded(routable.length, stopsPerDay);
      if (k === 0) { /* handled by proposeDays */ return; }
      const idx = new Map(routable.map((l, i) => [`${l.lat},${l.lng}`, i]));
      const distanceFn = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
        const ai = idx.get(`${a.lat},${a.lng}`); const bi = idx.get(`${b.lat},${b.lng}`);
        if (ai === undefined || bi === undefined) return distanceKm(a, b);
        return matrix[ai][bi] ?? distanceKm(a, b);
      };
      const prioritySeeds = routable.filter((l) => l.priority);
      setProposedDays(
        clusterIntoDays(routable, k, sortAnchor, distanceFn, prioritySeeds.length > 0 ? prioritySeeds : undefined)
          .map((d) => d.stops).sort((a, b) => b.length - a.length)
      );
    };
  }, [matrix, sortAnchor, routable, proposeDays, setProposedDays, stopsPerDay]);

  return (
    <>
      <div dir="rtl" className="pagewrap">
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">Prospect Locations</div>
              <h1 className="text-[length:var(--text-xl)] font-bold text-text">فهرست مکان‌های پیشنهادی</h1>
            </div>
            <Link href="/map" className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors hover:border-accent hover:text-accent">بازگشت به نقشه ←</Link>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-xs)]">
            {posStatus === "active" && position ? (
              <span className="text-good">موقعیت شما زنده است — فهرست با حرکت شما به‌روز می‌شود (دقت {faNum(Math.round(position.accuracy))} متر)</span>
            ) : posStatus === "denied" ? (
              <><span className="text-crit">{posError ?? "دسترسی به موقعیت داده نشده"}</span><span className="text-text-faint">— بدون آن، ترتیب «نزدیک‌ترین» ممکن نیست.</span><button onClick={retryPosition} className="rounded-[var(--radius-sm)] border border-border px-2 py-0.5 text-text-muted hover:border-accent hover:text-accent">تلاش دوباره</button></>
            ) : <span className="text-text-muted">در حال یافتن موقعیت شما…</span>}
          </div>

          {/* The pool, the import panel and the planner are the manager's. A driver opening
              /leads gets their route and nothing else -- no search, no sorting, no way to
              add a pin. Gating each block on isManager rather than branching the whole page
              keeps the manager path byte-identical. */}
          {isManager && (
            <>
              <LeadImportPanel onAdded={load} />

              <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4 flex flex-col gap-4">

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <h2 className="sechead__title truncate">
                  همه مکان‌ها ({faNum(locations.length)})
                </h2>
                <div className="relative shrink-0">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="جستجوی نام مکان..."
                    className="w-48 rounded-[var(--radius-sm)] border border-border bg-bg px-3 py-1.5 pl-7 text-[length:var(--text-xs)] text-text placeholder:text-text-faint outline-none transition-colors focus:border-accent"
                    aria-label="جستجوی مکان"
                  />
                  {/* One icon, one side, swapped by emptiness: a magnifier while the field is
                      empty, a clear button the moment there is something to clear. Both sit
                      on the left, the end side in RTL, because that is the side the input
                      already reserves (pl-7) -- so Persian text, which grows from the right
                      towards the left, can never slide underneath whichever icon is showing. */}
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
                      aria-label="پاک کردن جستجو"
                    >
                      <Icon name="x" size="sm" />
                    </button>
                  ) : (
                    <Icon name="search" size="sm" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    const ids = visible.filter(({ loc }) => loc.lat !== null && loc.lng !== null).map(({ loc }) => loc.id);
                    const newIds = ids.filter((id) => !run.includes(id));
                    if (newIds.length === 0) return;
                    updateRun([...run, ...newIds]);
                  }}
                  className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-accent text-accent hover:bg-accent hover:text-accent-ink transition-colors flex items-center gap-1"
                >
                  <Icon name="check" size="sm" /> انتخاب همه
                </button>
                {sortAnchor ? (
                  <span className="text-[length:var(--text-xs)] text-text-muted">نزدیک‌ترین</span>
                ) : (
                  <button
                    onClick={() => setShowManualPos(true)}
                    className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-border text-text-muted hover:border-accent hover:text-accent transition-colors flex items-center gap-1"
                  >
                    <Icon name="locate" size="sm" /> تعیین موقعیت
                  </button>
                )}
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="rounded-[var(--radius-sm)] border border-border bg-bg px-1.5 py-1 text-[length:var(--text-xs)] text-text-muted outline-none focus:border-accent"
                  aria-label="ترتیب"
                >
                  <option value="nearest">نزدیک‌ترین</option>
                  <option value="score">امتیاز</option>
                  <option value="name">نام</option>
                  <option value="newest">تازه‌ترین</option>
                  <option value="status">وضعیت</option>
                  <option value="route">ترتیب مسیر</option>
                  <option value="priority">اولویت</option>
                </select>
              </div>
            </div>

            {loading ? <SkeletonRows /> : visible.length === 0 ? <EmptyState icon="search" title="سرنخی یافت نشد" hint="سرنخی با این فیلتری یافت نشد" /> : (
              <>
                <PoolViewToggle activeView={activeView} onChange={setActiveView} />
                <PoolViewWrapper
                  viewMode={activeView}
                  locations={visible.map((v) => v.loc)}
                  loading={loading}
                  navAppId={navAppId}
                  run={run}
                  selectedMapId={selectedMapId}
                  linkedId={linkedId ?? null}
                  linkedRef={linkedRef}
                  onSelect={setSelectedMapId}
                  onToggleRun={(id) => { if (run.includes(id)) removeFromRun(id); else addToRun(id); }}
                  onPin={setPinningId}
                  onTogglePriority={togglePriority}
                  onAddToPlan={() => {}}
                  onNotesChange={() => {}}
                  onNameChange={(id, name) => updateLocationName(id, name)}
                  sortAnchor={sortAnchor}
                  sortMode={sortMode}
                  priorityHigh={false}
                />
              </>
            )}
              </section>
            </>
          )}

          {/* A driver sees their day, and the manager's tools are simply not rendered. */}
          {!isManager && (
            <DriverRunView onRecord={setTapFlowId} navAppId={navAppId} />
          )}

          {/* The pool is a manager's scratch run until it is assigned here: a driver sees
              none of it. So the "سپردن مسیر" button lives inside RouteSection, on the
              current-route action row, rather than floating over the page. */}
          {isManager && (
            <RouteSection
              run={run} runStops={runStops} totalKm={runTotalKm} navAppId={navAppId} routeHref={runHref}
              navigateHref={(s) => navigateUrl(navAppId, { lat: s.lat, lng: s.lng }, s.name)}
              onMove={moveInRun} onRemove={removeFromRun} onClear={clearRun} onOptimise={optimiseRun} optimiseGain={optimiseGain} busy={busy}
              proposedDays={dayGroups}
              onAddDayToRun={(dayIdx) => updateRun((proposedDaysRaw ?? [])[dayIdx].map((d) => d.id))}
              onCreateListFromDay={(title, ids) => createList(title, ids)}
              onTapFlow={(stopId) => {}}
              onAssignRoute={() => setLeadRunPlannerOpen(true)}
              isManager={isManager} stopsPerDay={stopsPerDay} setStopsPerDay={setStopsPerDay}
              proposeDays={enhancedProposeDays} routableLength={routable.length} runOrigin={sortAnchor}
              setProposedDays={setProposedDays} updateRun={updateRun} createList={createList}
              addToDayGroup={addToDayGroup} removeFromDayGroup={removeFromDayGroup}
              unassignedLocations={routable.filter((l) => !new Set(proposedDaysRaw?.flat()?.map((d: any) => d.id) ?? []).has(l.id))}
              repropose={enhancedProposeDays}
            />
          )}

          <LeadsMap leads={mapLeads} runPoints={runPoints} onAddToRun={addToRun} onRemoveFromRun={removeFromRun} navigateHref={(l) => navigateUrl(navAppId, { lat: l.lat, lng: l.lng }, l.name)} selectedId={selectedMapId} onSelect={setSelectedMapId} />

          <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
            <CollapsibleSection title="تنظیمات" icon="settings" storageKey="leads_settings" keywords="مسیریابی برنامه گوگل نشان بلد ویز"><NavAppSetting /></CollapsibleSection>
          </section>
        </div>
      </div>

      <LocationTapFlow open={tapFlowId !== null} locationId={tapFlowId!} locationName={tapFlowId !== null ? (byId.get(tapFlowId)?.name ?? "") : ""} locationLat={tapFlowId !== null ? byId.get(tapFlowId)?.lat ?? null : null} locationLng={tapFlowId !== null ? byId.get(tapFlowId)?.lng ?? null : null} navAppId={navAppId} onNavigate={(url) => window.open(url, "_blank")} onClose={() => setTapFlowId(null)} />

      {/* Remounted per open, so the hand-over flow starts from its first step every time
          and the last one's picks are not still sitting there. */}
      <LeadRunPlannerTabFlow
        key={leadRunPlannerOpen ? "assign-open" : "assign-closed"}
        open={leadRunPlannerOpen}
        locationIds={run}
        onAssigned={(assigned) => setRun(assigned.stops.map((s) => s.location_id))}
        onClose={() => setLeadRunPlannerOpen(false)}
      />
    </>
  );
}
