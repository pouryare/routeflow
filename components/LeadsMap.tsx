"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useLatest } from "@/lib/useLatest";
import { useHydrated } from "@/lib/useHydrated";
import { MapContainer, Marker, Polyline, Popup, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet-routing-machine";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import FullscreenControl from "./FullscreenControl";
import LocateControl from "./LocateControl";
import MyLocationMarker from "./MyLocationMarker";
import { useMyPosition } from "./MyPositionProvider";
import { faFixed, faNum } from "@/lib/format";
import { formatDistanceKm } from "@/lib/geo";
import { NEAREST_COUNTS, RADII_KM, nearestN, withinRadius } from "@/lib/mapSelect";
import type { RoutesFoundEvent, WithRouting } from "@/types/leafletRouting";
import { guardedOsrmRouter } from "@/lib/guardedRouter";
import QuietTileLayer from "@/components/map/QuietTileLayer";

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

interface RouteSummary {
  distanceKm: number;
  minutes: number;
}

const iconCache = new Map<string, L.DivIcon>();

function leadIcon(runIndex: number | null, selected: boolean): L.DivIcon {
  const key = `${runIndex ?? "-"}|${selected}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  // A lead in the run carries its stop number, which is the whole point of the run
  // being ordered: the map and the list say the same thing in the same order.
  const inRun = runIndex !== null;
  const icon = L.divIcon({
    className: "",
    html: `<div class="lead-marker${inRun ? " lead-marker--in-run" : ""}${selected ? " lead-marker--selected" : ""}">${
      inRun ? runIndex : ""
    }</div>`,
    iconSize: inRun ? [24, 24] : [14, 14],
    iconAnchor: inRun ? [12, 12] : [7, 7],
  });
  iconCache.set(key, icon);
  return icon;
}

/** Road route through the run, when there are at least two points to join.
 *
 *  Same OSRM control the planner map uses. Its own markers are suppressed -- this map
 *  already draws every lead, and a second set of pins on top of them would double
 *  everything in the run. */
function RunRoute({ points, onSummary }: { points: [number, number][]; onSummary: (s: RouteSummary | null) => void }) {
  const map = useMap();
  const key = useMemo(() => points.map((p) => p.join(",")).join("|"), [points]);

  /* The control is rebuilt only when the map or the route itself changes (`key`). What it
     reads is always the newest: the points through a ref, and the callback, which the parent
     recreates every render, through another. Listing the callback as a dependency would
     rebuild the control on every render. */
  const pointsRef = useLatest(points);
  const onSummaryRef = useLatest(onSummary);

  useEffect(() => {
    const pts = pointsRef.current;
    if (pts.length < 2) {
      onSummaryRef.current(null);
      return;
    }
    const guarded = guardedOsrmRouter(L as unknown as WithRouting);
    const control = (L as unknown as WithRouting).Routing.control({
      router: guarded.router,
      waypoints: pts.map(([lat, lng]) => L.latLng(lat, lng)),
      routeWhileDragging: false,
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: false,
      show: false,
      lineOptions: {
        styles: [{ color: "#2DE0E6", weight: 4, opacity: 0.8 }],
        extendToWaypoints: true,
        missingRouteTolerance: 0,
      },
      createMarker: () => null,
    });
    control.on("routesfound", (e: RoutesFoundEvent) => {
      const r = e.routes?.[0];
      if (r) onSummaryRef.current({ distanceKm: r.summary.totalDistance / 1000, minutes: Math.round(r.summary.totalTime / 60) });
    });
    control.on("routingerror", () => onSummaryRef.current(null));
    control.addTo(map);
    return () => {
      guarded.dispose();
      control.remove();
    };
  }, [map, key, pointsRef, onSummaryRef]);

  return null;
}

/** In circle mode, the next tap on the map (not on a pin) sets the centre. */
function CentrePicker({ active, onPick }: { active: boolean; onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (active) onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Keeps the map pointed at something useful without stealing it back afterwards.
 *
 *  Fits once, to whatever there is to see. Re-fitting on every change would yank the
 *  view out from under someone who has just panned somewhere deliberately. */
function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
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
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const { position, status } = useMyPosition();
  /* Whether this has left the server render. Read through useSyncExternalStore rather than a
   * `mounted` state an effect flips: there is nothing external to subscribe to here, and the
   * bump would be a second render pass on every mount that the server render already decided.
   * This map is loaded with `ssr: false`, so in practice the client snapshot is true from the
   * first render and the placeholder below never flashes. */
  const hydrated = useHydrated();

  /* Bumped on every mount, and used to key the map container so it always gets a DOM node
   * Leaflet has never seen.
   *
   * react-leaflet v5 cleans up with `useEffect(() => () => context?.map.remove(), [context])`,
   * and `context` is set by a `setState` inside the map's own ref callback. If the effect's
   * cleanup runs before that state has flushed -- which is what a Fast Refresh remount does --
   * `context` is null, `context?.map` short-circuits, and the map is never removed. The
   * container div keeps the `_leaflet_id` Leaflet stamps on it, so the next mount trips
   * Leaflet's own guard -- "Map container is being reused by another instance" -- and the
   * layers then fail on the corpse with `appendChild` and `_removePath` errors.
   *
   * A key cannot fix that on its own: `useState(() => Date.now())` is *preserved* across a
   * Fast Refresh, so the key never changed and the same poisoned div came back. Effects are
   * re-run by Fast Refresh even when state is kept, so an epoch they advance does change --
   * and changing it makes React discard the old div, which is what finally takes
   * `_leaflet_id` with it.
   *
   * The bump is scheduled on a microtask rather than run inline, which is the same deferral
   * lib/useRunAfterMount exists for: nothing is set during the effect body, so there is no
   * synchronous cascade to guard against. The cascade is still wanted -- React has to discard
   * the old container -- it just does not have to happen before the browser has painted. */
  const [mapEpoch, setMapEpoch] = useState(0);

  useEffect(() => {
    void Promise.resolve().then(() => setMapEpoch((n) => n + 1));
  }, []);

  // Must be called unconditionally — hooks cannot be conditional.
  const allPoints = useMemo<[number, number][]>(() => leads.map((l) => [l.lat, l.lng]), [leads]);

  /* Gated on the epoch having settled as well as on hydration, so a real first load still
   * builds exactly one map: the map is not created until the key it will be created with is
   * already its final value, and so cannot be torn down and rebuilt one microtask later. */
  if (!hydrated || mapEpoch === 0) {
    return <div className="h-80 w-full rounded-[var(--radius-lg)] border border-border" />;
  }

  // Somewhere to start when there are no leads at all and no fix yet. Tehran, which is
  // where this business operates -- an empty map centred on the null island is a bug
  // report waiting to happen.
  const fallbackCentre: [number, number] = [35.7, 51.4];

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="h-80 w-full">
        <MapContainer
          key={mapEpoch}
          center={position ? [position.lat, position.lng] : fallbackCentre}
          zoom={12}
          className="h-full w-full"
        >
          <QuietTileLayer />

          <FitOnce points={allPoints} />
          <CentrePicker
            active={pickingCentre}
            onPick={(lat, lng) => {
              setCircle({ lat, lng, km: 3 });
              setPickingCentre(false);
            }}
          />
          {circle && <Circle center={[circle.lat, circle.lng]} radius={circle.km * 1000} interactive={false} pathOptions={{ color: "#2DE0E6", weight: 2, fillOpacity: 0.08 }} />}
          <RunRoute points={runPoints} onSummary={setSummary} />

          {leads.map((l) => (
            <Marker
              key={l.id}
              position={[l.lat, l.lng]}
              title={l.name}
              icon={leadIcon(l.runIndex, l.id === selectedId)}
              zIndexOffset={l.runIndex !== null ? 700 : 500}
              eventHandlers={{
                click: () => {
                  if (selecting) {
                    if (l.runIndex === null) onAddToRun(l.id);
                    else onRemoveFromRun(l.id);
                  } else onSelect(l.id);
                },
                popupclose: () => onSelect(null),
              }}
            >
              {!selecting && <Popup>
                <div dir="rtl" className="min-w-44 text-[length:var(--text-sm)] leading-6">
                  <p className="font-medium text-text">{l.name}</p>
                  {l.address && <p className="mt-0.5 text-[length:var(--text-xs)] text-text-muted">{l.address}</p>}

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[length:var(--text-xs)] text-text-faint">
                    {l.km !== null && <span>{formatDistanceKm(l.km)} — خط مستقیم</span>}
                    {l.statusLabel && <span className="text-text-muted">{l.statusLabel}</span>}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a
                      href={navigateHref(l)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-accent px-5 py-1.5 text-[length:var(--text-sm)] font-medium text-accent"
                    >
                      <Icon name="navigation" size="sm" />
                      مسیریابی به مکان
                    </a>
                    {l.runIndex === null ? (
                      <button
                        onClick={() => onAddToRun(l.id)}
                        className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted"
                      >
                        <Icon name="plus" size="sm" />
                        افزودن به مسیر
                      </button>
                    ) : (
                      <button
                        onClick={() => onRemoveFromRun(l.id)}
                        className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-crit"
                      >
                        <Icon name="minus" size="sm" />
                        حذف از مسیر (مقصد {faNum(l.runIndex)})
                      </button>
                    )}
                  </div>
                </div>
              </Popup>}
            </Marker>
          ))}

          {/* Straight-line fallback so the run is always legible as an order, even when
              OSRM is unreachable or still thinking. Drawn under the road route, which
              covers it once it arrives. */}
          {runPoints.length > 1 && summary === null && (
            <Polyline
              positions={runPoints}
              interactive={false}
              pathOptions={{ color: "#2DE0E6", weight: 2, opacity: 0.5, dashArray: "6 6" }}
            />
          )}

          <MyLocationMarker />
          <LocateControl />
          <FullscreenControl />
        </MapContainer>
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
            {faFixed(summary.distanceKm, 1)} کیلومتر · {faNum(summary.minutes)} دقیقه روی جاده
          </span>
        ) : runPoints.length > 1 ? (
          <span className="text-text-faint">مسیر خط‌چین — فاصله جاده‌ای هنوز محاسبه نشده</span>
        ) : null}
      </div>
    </div>
  );
}
