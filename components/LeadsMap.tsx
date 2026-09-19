"use client";

import { Icon } from "@/components/meridian/Icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLatest } from "@/lib/useLatest";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
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
import { QUIET_TILES } from "@/lib/mapLayers";
import type { RoutesFoundEvent, WithRouting } from "@/types/leafletRouting";

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
    const control = (L as unknown as WithRouting).Routing.control({
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
      control.remove();
    };
  }, [map, key, pointsRef, onSummaryRef]);

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
}: {
  leads: LeadPoint[];
  /** The run in order, as [lat, lng] -- the origin first when there is a position. */
  runPoints: [number, number][];
  onAddToRun: (id: number) => void;
  onRemoveFromRun: (id: number) => void;
  navigateHref: (lead: LeadPoint) => string;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const { position, status } = useMyPosition();

  const allPoints = useMemo<[number, number][]>(() => leads.map((l) => [l.lat, l.lng]), [leads]);

  // Somewhere to start when there are no leads at all and no fix yet. Tehran, which is
  // where this business operates -- an empty map centred on the null island is a bug
  // report waiting to happen.
  const fallbackCentre: [number, number] = [35.7, 51.4];

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="h-80 w-full">
        <MapContainer
          center={position ? [position.lat, position.lng] : fallbackCentre}
          zoom={12}
          className="h-full w-full"
        >
          <TileLayer
            url={QUIET_TILES.url}
            attribution={QUIET_TILES.attribution}
            className="tiles-quiet"
            maxZoom={QUIET_TILES.maxZoom}
          />

          <FitOnce points={allPoints} />
          <RunRoute points={runPoints} onSummary={setSummary} />

          {leads.map((l) => (
            <Marker
              key={l.id}
              position={[l.lat, l.lng]}
              icon={leadIcon(l.runIndex, l.id === selectedId)}
              zIndexOffset={l.runIndex !== null ? 700 : 500}
              eventHandlers={{
                click: () => onSelect(l.id),
                popupclose: () => onSelect(null),
              }}
            >
              <Popup>
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
                      className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-3 rounded-[var(--radius-sm)] border border-accent px-5 py-1.5 text-[length:var(--text-sm)] font-medium text-accent"
                    >
                      مسیریابی <Icon name="external-link" size="sm" />
                    </a>
                    {l.runIndex === null ? (
                      <button
                        onClick={() => onAddToRun(l.id)}
                        className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted"
                      >
                        + افزودن به مسیر
                      </button>
                    ) : (
                      <button
                        onClick={() => onRemoveFromRun(l.id)}
                        className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-crit"
                      >
                        حذف از مسیر (توقف {faNum(l.runIndex)})
                      </button>
                    )}
                  </div>
                </div>
              </Popup>
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
