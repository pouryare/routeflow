"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { Layer, Marker, Popup, Source, useMap } from "@vis.gl/react-maplibre";
import FullscreenControl from "./FullscreenControl";
import LocateControl from "./LocateControl";
import MyLocationMarker from "./MyLocationMarker";
import { useMyPosition } from "./MyPositionProvider";
import { faFixed, faNum } from "@/lib/format";
import { formatDistanceKm } from "@/lib/geo";
import { NEAREST_COUNTS, RADII_KM, nearestN, withinRadius } from "@/lib/mapSelect";
import type { DrivingRoute } from "@/lib/osrm";
import AppMap from "@/components/map/AppMap";
import RouteLine from "@/components/map/RouteLine";
import { geoCircle } from "@/components/map/geoCircle";

export interface LeadPoint {
  id: number;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** Position in the run, 1-based. Null when this lead is not in it. */
  runIndex: number | null;
  /** Straight-line distance from the user, when known. */
  km: number | null;
  statusLabel: string | null;
}

/** Keeps the map pointed at something useful without stealing it back afterwards.
 *
 *  Fits once, to whatever there is to see. Re-fitting on every change would yank the
 *  view out from under someone who has just panned somewhere deliberately. */
function FitOnce({ points }: { points: [number, number][] }) {
  const { current: map } = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (!map || done.current || points.length === 0) return;
    done.current = true;
    if (points.length === 1) map.jumpTo({ center: [points[0][1], points[0][0]], zoom: 15 });
    else {
      const lats = points.map((p) => p[0]), lngs = points.map((p) => p[1]);
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 40, maxZoom: 15, duration: 0 });
    }
  }, [points, map]);
  return null;
}

/**
 *  The map under the leads list.
 *
 *  Three things it does that the shared planner map could not. It shows *every* lead,
 *  not only the ones in the current run -- the map is how you spot the two you had not
 *  thought of on the way. Its markers open a card with the lead's own actions, so
 *  looking something up does not mean scrolling back to find its row. And it draws the
 *  live position, which is the reference point every other pin on it is judged against.
 */
export default function LeadsMap({
  leads,
  runPoints,
  onAddToRun,
  onRemoveFromRun,
  navigateHref,
  selectedId,
  onSelect,
  onAddMany,
  onClear,
}: {
  leads: LeadPoint[];
  /** The run in order, as [lat, lng] -- the origin first when there is a position. */
  runPoints: [number, number][];
  onAddToRun: (id: number) => void;
  onRemoveFromRun: (id: number) => void;
  navigateHref: (lead: LeadPoint) => string;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Adds places to the run in one go; returns how many were new. Enables the selection tray. */
  onAddMany?: (ids: number[]) => number;
  /** Empties the run (the page offers its own undo). */
  onClear?: () => void;
}) {
  /* Selection mode: tapping a pin adds or removes it from the run instead of opening its card,
     and the tray offers «nearest N» and «inside a circle». The run IS the selection, so the
     numbered badges on the pins show the order things were picked in. */
  const [selecting, setSelecting] = useState(false);
  const [circle, setCircle] = useState<{ lat: number; lng: number; km: number } | null>(null);
  const [pickingCentre, setPickingCentre] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<DrivingRoute | null>(null);
  const { position, status } = useMyPosition();
  // Must be called unconditionally — hooks cannot be conditional.
  const allPoints = useMemo<[number, number][]>(() => leads.map((l) => [l.lat, l.lng]), [leads]);

  const circleShape = useMemo(() => (circle ? geoCircle(circle.lat, circle.lng, circle.km * 1000) : null), [circle]);
  const runStops = useMemo(() => runPoints.map(([lat, lng]) => ({ lat, lng })), [runPoints]);
  const onRoute = useCallback((r: DrivingRoute | null) => setSummary(r), []);
  const selected = selecting ? null : leads.find((l) => l.id === selectedId) ?? null;

  // Somewhere to start when there are no leads at all and no fix yet. Tehran, which is
  // where this business operates -- an empty map centred on the null island is a bug
  // report waiting to happen.
  const fallbackCentre: [number, number] = [35.7, 51.4];

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="h-80 w-full">
        <AppMap
          initialViewState={{
            latitude: position ? position.lat : fallbackCentre[0],
            longitude: position ? position.lng : fallbackCentre[1],
            zoom: 12,
          }}
          // In circle mode, the next tap on the map (not on a pin) sets the centre.
          onClick={(e) => {
            if (!pickingCentre) return;
            setCircle({ lat: e.lngLat.lat, lng: e.lngLat.lng, km: 3 });
            setPickingCentre(false);
          }}
        >
          <FitOnce points={allPoints} />
          {circleShape && (
            <Source id="lead-circle" type="geojson" data={circleShape}>
              <Layer id="lead-circle-fill" type="fill" paint={{ "fill-color": "#2DE0E6", "fill-opacity": 0.08 }} />
              <Layer id="lead-circle-line" type="line" paint={{ "line-color": "#2DE0E6", "line-width": 2 }} />
            </Source>
          )}
          {/* Road route through the run; dashed straight lines until OSRM answers, so the
              run is always legible as an order. This map draws its own pins, so the route
              brings none. */}
          <RouteLine stops={runStops} onRoute={onRoute} lineOnly />

          {leads.map((l) => {
            // A lead in the run carries its stop number, which is the whole point of the
            // run being ordered: the map and the list say the same thing in the same order.
            const inRun = l.runIndex !== null;
            return (
              <Marker
                key={l.id}
                longitude={l.lng}
                latitude={l.lat}
                style={{ zIndex: inRun ? 2 : 1 }}
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  if (selecting) {
                    if (l.runIndex === null) onAddToRun(l.id);
                    else onRemoveFromRun(l.id);
                  } else onSelect(l.id);
                }}
              >
                <button
                  type="button"
                  title={l.name}
                  aria-label={inRun ? `${l.name}، مقصد ${faNum(l.runIndex!)}` : l.name}
                  className={`lead-marker${inRun ? " lead-marker--in-run" : ""}${l.id === selectedId ? " lead-marker--selected" : ""}`}
                >
                  {/* No icon: this button is the map pin itself, a dot or its stop number. */}
                  {inRun ? faNum(l.runIndex!) : ""}
                </button>
              </Marker>
            );
          })}

          {selected && (
            <Popup longitude={selected.lng} latitude={selected.lat} offset={14} closeOnClick={false} onClose={() => onSelect(null)} maxWidth="280px">
              <div dir="rtl" className="min-w-44 text-[length:var(--text-sm)] leading-6">
                <p className="font-medium text-text">{selected.name}</p>
                {selected.address && <p className="mt-0.5 text-[length:var(--text-xs)] text-text-muted">{selected.address}</p>}

                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[length:var(--text-xs)] text-text-faint">
                  {selected.km !== null && <span>{formatDistanceKm(selected.km)} — خط مستقیم</span>}
                  {selected.statusLabel && <span className="text-text-muted">{selected.statusLabel}</span>}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a
                    href={navigateHref(selected)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-accent px-5 py-1.5 text-[length:var(--text-sm)] font-medium text-accent"
                  >
                    <Icon name="navigation" size="sm" />
                    مسیریابی به مکان
                  </a>
                  {selected.runIndex === null ? (
                    <button
                      onClick={() => onAddToRun(selected.id)}
                      className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted"
                    >
                      <Icon name="plus" size="sm" />
                      افزودن به مسیر
                    </button>
                  ) : (
                    <button
                      onClick={() => onRemoveFromRun(selected.id)}
                      className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-crit"
                    >
                      <Icon name="minus" size="sm" />
                      حذف از مسیر (مقصد {faNum(selected.runIndex)})
                    </button>
                  )}
                </div>
              </div>
            </Popup>
          )}

          <MyLocationMarker />
          <LocateControl />
          <FullscreenControl />
        </AppMap>
      </div>

      {onAddMany && (
        <div className="flex flex-col gap-2 border-t border-border bg-surface px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={selecting}
              onClick={() => {
                setSelecting((v) => !v);
                setPickingCentre(false);
                setNote(null);
              }}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-[length:var(--text-sm)] ${selecting ? "border-accent bg-accent text-accent-ink" : "border-border text-text"}`}
            >
              <Icon name={selecting ? "check" : "map-pin"} size="sm" />
              {selecting ? "انتخاب با لمس روشن است" : "انتخاب مکان‌ها روی نقشه"}
            </button>
            {selecting && (
              <span className="text-[length:var(--text-xs)] text-text-muted">
                {faNum(runPoints.length - (position ? 1 : 0) > 0 ? runPoints.length - (position ? 1 : 0) : 0)} مکان در مسیر
              </span>
            )}
          </div>
          {selecting && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="ابزار انتخاب">
              {NEAREST_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={!position}
                  onClick={() => {
                    if (!position) return;
                    const added = onAddMany(nearestN(leads, { lat: position.lat, lng: position.lng }, n));
                    setNote(added > 0 ? `${faNum(added)} مکان به مسیر اضافه شد` : "همه‌شان از قبل در مسیر بودند");
                  }}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border px-4 text-[length:var(--text-sm)] text-text disabled:opacity-40"
                >
                  <Icon name="map-pin" size="sm" />
                  {`نزدیک‌ترین ${faNum(n)} مکان`}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={pickingCentre}
                onClick={() => {
                  setPickingCentre((v) => !v);
                  setNote(null);
                }}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-[length:var(--text-sm)] ${pickingCentre ? "border-accent text-accent" : "border-border text-text"}`}
              >
                <Icon name="target" size="sm" />
                {pickingCentre ? "مرکز دایره را روی نقشه لمس کنید" : "انتخاب داخل دایره"}
              </button>
              {onClear && (
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    setCircle(null);
                    setNote(null);
                  }}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border px-4 text-[length:var(--text-sm)] text-crit"
                >
                  <Icon name="x" size="sm" />
                  پاک کردن انتخاب
                </button>
              )}
            </div>
          )}
          {selecting && circle && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="شعاع دایره">
              {RADII_KM.map((km) => (
                <button
                  key={km}
                  type="button"
                  aria-pressed={circle.km === km}
                  onClick={() => setCircle({ ...circle, km })}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-[length:var(--text-sm)] ${circle.km === km ? "border-accent bg-accent text-accent-ink" : "border-border text-text"}`}
                >
                  <Icon name={circle.km === km ? "check" : "target"} size="sm" />
                  {`${faNum(km)} کیلومتر`}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const ids = withinRadius(leads, circle, circle.km);
                  const added = onAddMany(ids);
                  setNote(ids.length === 0 ? "مکانی داخل دایره نیست" : added > 0 ? `${faNum(added)} مکان به مسیر اضافه شد` : "همه‌شان از قبل در مسیر بودند");
                }}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-accent bg-accent px-4 text-[length:var(--text-sm)] text-accent-ink"
              >
                <Icon name="plus" size="sm" />
                {`افزودن مکان‌های داخل دایره`}
              </button>
            </div>
          )}
          {note && (
            <p className="m-0 text-[length:var(--text-xs)] text-text-muted" role="status">
              {note}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border bg-surface px-3 py-2 font-mono text-[length:var(--text-xs)] text-text-muted">
        <span>
          {status === "denied"
            ? "موقعیت شما در دسترس نیست — دسترسی داده نشده"
            : position
              ? `موقعیت شما زنده است (دقت ${faNum(Math.round(position.accuracy))} متر)`
              : "در حال یافتن موقعیت شما…"}
        </span>
        {summary ? (
          <span className="text-text">
            {faFixed(summary.km, 1)} کیلومتر · {faNum(summary.minutes)} دقیقه روی جاده
          </span>
        ) : runPoints.length > 1 ? (
          <span className="text-text-faint">مسیر خط‌چین — فاصله جاده‌ای هنوز محاسبه نشده</span>
        ) : null}
      </div>
    </div>
  );
}
