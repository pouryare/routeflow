"use client";

import { useMemo, useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import dynamic from "next/dynamic";
import NextStopBanner from "@/components/driver/NextStopBanner";
import { useDriverRun, pendingStops, type DriverRun, type DriverStop } from "@/components/driver/useDriverRun";
import { navigateUrl, type NavAppId } from "@/lib/navApps";
import { useMyPosition } from "@/components/MyPositionProvider";
import { distanceKm } from "@/lib/geo";
import { faNum } from "@/lib/format";
import { Icon } from "@/components/meridian/Icon";
import EmptyState from "@/components/EmptyState";
import FacilityStopCards from "@/components/driver/FacilityStopCards";
import UnloadTapFlow from "@/components/driver/UnloadTapFlow";
import type { RunFacilityStop } from "@/lib/delivery";
import type { Disposition } from "@/lib/unloadDispositions";
import { SkeletonRows } from "@/components/Skeleton";
import WidgetBoundary from "@/components/WidgetBoundary";

const LeadsMap = dynamic(() => import("@/components/LeadsMap"), { ssr: false });

/** The driver's prospect visits: where next, then the rest of the day.
 *
 *  This is the second section of /driver, under the deliveries. It used to be the whole
 *  of a driver's page, on /leads, behind a role branch.
 *
 *  The order within the section is deliberate. The next stop is above the fold because it
 *  is the only thing that has to be read before getting out of the van; everything else
 *  sits behind a disclosure, so a long day does not push the answer off the screen.
 *
 *  A visited stop stays in the list, struck through, rather than vanishing. Same
 *  reasoning as a handed-off lead staying visible: a list that silently shrinks reads as
 *  a broken app, and a driver who cannot see why a stop disappeared will assume the
 *  worst. */
export default function DriverRunView({
  initialRun,
  onRecord,
  navAppId,
}: {
  /** The server's read of today's run, handed in by /driver.
   *
   *  Without it the view client-fetches /api/lead-runs and renders a skeleton. On
   *  /driver that meant the delivery section above was already painted and the page
   *  visibly filled in twice. It is the FIRST PAINT, not a cache: the hook still
   *  re-fetches on mount and after every reorder or recorded visit, so this view must
   *  not be trusted to stay fresh — and it is not. */
  initialRun?: DriverRun | null;
  onRecord: (locationId: number) => void;
  navAppId: NavAppId;
}) {
  const { run, stops, loading, error, reload, move } = useDriverRun(initialRun);
  const { position } = useMyPosition();
  const [showAll, setShowAll] = useState(false);
  /* Which unload card is open, and the state of that sheet. `unloadError` holds the server's
   * refusal VERBATIM — it names the gap by number, and paraphrasing it here would throw away
   * the only part the driver needs. */
  const [unloadFor, setUnloadFor] = useState<RunFacilityStop | null>(null);
  const [unloadBusy, setUnloadBusy] = useState(false);
  const [unloadError, setUnloadError] = useState<string | null>(null);

  async function submitUnload(
    lines: { productId: number; disposition: Disposition; qty: number }[]
  ) {
    if (!unloadFor || !run) return;
    setUnloadBusy(true);
    setUnloadError(null);
    try {
      const res = await fetch(`/api/driver/run/${run.id}/unload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setUnloadError(friendlyError(data.error, "تخلیه ثبت نشد؛ دوباره تلاش کنید"));
        return;
      }
      setUnloadFor(null);
      await reload();
    } catch {
      setUnloadError("تخلیه ثبت نشد؛ دوباره تلاش کنید");
    } finally {
      setUnloadBusy(false);
    }
  }

  const pending = useMemo(() => pendingStops(stops), [stops]);
  const next = pending[0] ?? null;
  const done = useMemo(() => stops.filter((s) => !pendingStops([s]).length), [stops]);

  const nextKm = useMemo(() => {
    if (!next || !position || next.lat === null || next.lng === null) return null;
    return distanceKm(position, { lat: next.lat, lng: next.lng });
  }, [next, position]);

  if (loading) return <SkeletonRows />;

  if (error) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
        <p className="text-[length:var(--text-sm)] text-crit">{error}</p>
        <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost mt-2" onClick={() => void reload()}>
          <Icon name="undo" size="md" />
          تلاش دوباره
        </button>
      </section>
    );
  }

  if (!run) {
    return (
      <EmptyState
        icon="route"
        title="برای امروز مسیری ثبت نشده"
        hint="مدیر باید برای شما مسیر این روز را تعیین کند."
      />
    );
  }

  const mapLeads = stops
    .filter((s): s is DriverStop & { lat: number; lng: number } => s.lat !== null && s.lng !== null)
    .map((s) => ({
      id: s.location_id,
      name: s.name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      runIndex: s.sort_order + 1,
      km: position ? distanceKm(position, { lat: s.lat, lng: s.lng }) : null,
      statusLabel: s.outcome_label,
    }));

  return (
    <div className="flex flex-col gap-5">
      {/* The load and the unload, ABOVE the numbered stops and outside their sequence.
          A divider below them says "these are not stops in an order" rather than just
          "here is a section". */}
      <FacilityStopCards
        facilities={run.facilities ?? []}
        navAppId={navAppId}
        onOpenUnload={setUnloadFor}
      />

      {/* Pre-filled from the ledger. The driver taps a disposition and confirms; he never
          computes. The sheet shows the server's refusal verbatim rather than paraphrasing
          it, because the number in that message IS the answer. */}
      <UnloadTapFlow
        open={unloadFor !== null}
        presets={[]}
        busy={unloadBusy}
        error={unloadError}
        onSubmit={submitUnload}
        onClose={() => {
          setUnloadFor(null);
          setUnloadError(null);
        }}
      />

      <NextStopBanner
        stop={next}
        index={next ? stops.indexOf(next) + 1 : stops.length}
        total={stops.length}
        runDate={run.run_date}
        km={nextKm}
        onRecord={onRecord}
      />

      <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
        <button
          type="button"
          className="inline-flex items-center justify-center gap-[var(--space-2)] flex w-full items-center justify-between gap-2"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
        >
          <span className="flex items-center gap-2 text-[length:var(--text-sm)] font-medium text-text">
            <Icon name="route" size="md" className="text-accent" />
            بقیهٔ امروز — {faNum(pending.length)} توقف
          </span>
          <Icon name={showAll ? "arrow-up" : "chevron-down"} size="md" className="text-text-faint" />
        </button>

        {showAll ? (
          <ul className="mt-3 flex flex-col gap-2">
            {[...pending.slice(1), ...done].map((s) => {
              const visited = done.includes(s);
              return (
                <li key={s.location_id} className="flex items-start justify-between gap-2 border-t border-border pt-2">
                  <div className="min-w-0">
                    <p className={`truncate text-[length:var(--text-sm)] ${visited ? "text-text-faint line-through" : "text-text"}`}>
                      {faNum(s.sort_order + 1)}. {s.name}
                    </p>
                    {s.visit_outcome ? (
                      <p className="text-[length:var(--text-xs)] text-text-faint">{s.outcome_label}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {s.lat !== null && s.lng !== null ? (
                      <a
                        className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)]"
                        href={navigateUrl(navAppId, { lat: s.lat, lng: s.lng }, s.name)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        مسیریابی
                      </a>
                    ) : null}
                    {!visited ? (
                      <>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)]"
                          onClick={() => void move(s.location_id, -1)}
                          aria-label="بالا"
                        >
                          <Icon name="arrow-up" size="sm" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)]"
                          onClick={() => void move(s.location_id, 1)}
                          aria-label="پایین"
                        >
                          <Icon name="arrow-down" size="sm" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <WidgetBoundary label="نقشهٔ ایستگاه‌های امروز">
        <LeadsMap
          leads={mapLeads}
          runPoints={mapLeads.map((l) => [l.lat, l.lng] as [number, number])}
          navigateHref={(l) => navigateUrl(navAppId, { lat: l.lat, lng: l.lng }, l.name)}
          selectedId={next?.location_id ?? null}
          onSelect={() => {}}
          /* A driver does not build a route on the map: the run is already decided, and the
             two callbacks are required props. No-ops rather than nulls so the component keeps
             its own contract instead of growing a "sometimes read-only" mode. */
          onAddToRun={() => {}}
          onRemoveFromRun={() => {}}
        />
      </WidgetBoundary>
    </div>
  );
}
