"use client";

import { useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Icon } from "@/components/meridian/Icon";
import LocateControl from "./LocateControl";
import MyLocationMarker from "./MyLocationMarker";
import { faNum } from "@/lib/format";
import { QUIET_TILES } from "@/lib/mapLayers";
import { NEAREST_COUNTS, nearestN, toggle } from "@/lib/mapSelect";

export interface PickCandidate {
  /** "c12" for a customer, "l5" for a saved lead place (the same keys VisitPlanFlow uses). */
  key: string;
  name: string;
  lat: number;
  lng: number;
}

const iconCache = new Map<string, L.DivIcon>();
function pin(order: number | null): L.DivIcon {
  const k = String(order);
  let i = iconCache.get(k);
  if (!i) {
    i = L.divIcon({
      className: "",
      html: `<div class="lead-marker${order !== null ? " lead-marker--in-run" : ""}">${order ?? ""}</div>`,
      iconSize: order !== null ? [24, 24] : [14, 14],
      iconAnchor: order !== null ? [12, 12] : [7, 7],
    });
    iconCache.set(k, i);
  }
  return i;
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
        <MapContainer center={centre} zoom={12} className="h-full w-full">
          <TileLayer url={QUIET_TILES.url} attribution={QUIET_TILES.attribution} className="tiles-quiet" maxZoom={QUIET_TILES.maxZoom} />
          {candidates.map((c) => {
            const order = pickedSet.has(c.key) ? picked.indexOf(c.key) + 1 : null;
            return (
              <Marker key={c.key} position={[c.lat, c.lng]} title={c.name} icon={pin(order)} zIndexOffset={order ? 700 : 500} eventHandlers={{ click: () => flip(c.key) }} />
            );
          })}
          <MyLocationMarker />
          <LocateControl />
        </MapContainer>
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
          <Icon name="plus" size="md" />
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
