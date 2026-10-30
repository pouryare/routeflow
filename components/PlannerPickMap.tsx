"use client";

import { useMemo, useState } from "react";
import { Marker } from "@vis.gl/react-maplibre";
import { Icon } from "@/components/meridian/Icon";
import LocateControl from "./LocateControl";
import MyLocationMarker from "./MyLocationMarker";
import { faNum } from "@/lib/format";
import { NEAREST_COUNTS, nearestN, toggle } from "@/lib/mapSelect";
import AppMap from "@/components/map/AppMap";

export interface PickCandidate {
  /** "c12" for a customer, "l5" for a saved lead place (the same keys VisitPlanFlow uses). */
  key: string;
  name: string;
  lat: number;
  lng: number;
}

/** Choose the day's visits on a map: every place not yet planned is a pin, a tap picks or drops it
 *  (picked pins carry their order), «نزدیک‌ترین N» picks the closest to `origin`, and one button
 *  adds them all to the planner's day. The planner's own map shows the day's ROUTE; this one shows
 *  what could still be added to it. */
export default function PlannerPickMap({
  candidates,
  origin,
  dayLabel,
  onAdd,
}: {
  candidates: PickCandidate[];
  origin: { lat: number; lng: number } | null;
  dayLabel: string;
  /** Adds the picked keys to the day; resolves when done. */
  onAdd: (keys: string[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const byKey = useMemo(() => new Map(candidates.map((c) => [c.key, c])), [candidates]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const points = useMemo(() => candidates.map((c, i) => ({ id: i, lat: c.lat, lng: c.lng })), [candidates]);
  const centre: [number, number] = origin ? [origin.lat, origin.lng] : candidates[0] ? [candidates[0].lat, candidates[0].lng] : [35.7, 51.4];

  const flip = (key: string) => setPicked((p) => (toggle(new Set(p), key).has(key) ? [...p, key] : p.filter((k) => k !== key)));
  const addNearest = (n: number) => {
    if (!origin) return;
    const keys = nearestN(points, origin, n).map((i) => candidates[i].key);
    setPicked((p) => [...p, ...keys.filter((k) => !p.includes(k))]);
  };
  async function add() {
    setBusy(true);
    try {
      await onAdd(picked);
      setPicked([]);
    } finally {
      setBusy(false);
    }
  }

  if (candidates.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="h-72 w-full">
        <AppMap initialViewState={{ latitude: centre[0], longitude: centre[1], zoom: 12 }}>
          {candidates.map((c) => {
            const order = pickedSet.has(c.key) ? picked.indexOf(c.key) + 1 : null;
            return (
              <Marker key={c.key} longitude={c.lng} latitude={c.lat} style={{ zIndex: order ? 2 : 1 }}
                onClick={(e) => { e.originalEvent.stopPropagation(); flip(c.key); }}>
                <button type="button" className={`lead-marker${order !== null ? " lead-marker--in-run" : ""}`}
                  aria-label={order !== null ? `${c.name}، شمارهٔ ${faNum(order)} — برداشتن` : `${c.name} — انتخاب`} title={c.name}>
                  {/* No icon: this button is the map pin itself, a dot or its stop number. */}
                  {order !== null ? faNum(order) : ""}
                </button>
              </Marker>
            );
          })}
          <MyLocationMarker />
          <LocateControl />
        </AppMap>
      </div>
      <div className="flex flex-col gap-2 border-t border-border bg-surface px-3 py-2">
        <p className="m-0 text-[length:var(--text-xs)] text-text-muted">
          برای انتخاب روی هر نقطه بزنید؛ {faNum(candidates.length)} مکان برای افزودن به برنامهٔ {dayLabel} هست.
        </p>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="انتخاب سریع">
          {NEAREST_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              disabled={!origin}
              onClick={() => addNearest(n)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border px-4 text-[length:var(--text-sm)] text-text disabled:opacity-40"
            >
              <Icon name="map-pin" size="sm" />
              {`نزدیک‌ترین ${faNum(n)} مکان`}
            </button>
          ))}
          {picked.length > 0 && (
            <button type="button" onClick={() => setPicked([])} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border px-4 text-[length:var(--text-sm)] text-crit">
              <Icon name="x" size="sm" />
              پاک کردن انتخاب
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={picked.length === 0 || busy}
          onClick={() => void add()}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-md)] border border-accent bg-accent px-4 text-[length:var(--text-sm)] font-medium text-accent-ink disabled:opacity-40"
        >
          <Icon name="calendar-plus" size="md" />
          {picked.length > 0 ? `افزودن ${faNum(picked.length)} مکان به برنامه` : "افزودن به برنامه"}
        </button>
        {picked.length > 0 && (
          <p className="m-0 text-[length:var(--text-xs)] text-text-muted" aria-live="polite">
            {picked.map((k) => byKey.get(k)?.name).filter(Boolean).slice(0, 4).join("، ")}
            {picked.length > 4 ? "…" : ""}
          </p>
        )}
      </div>
    </div>
  );
}
