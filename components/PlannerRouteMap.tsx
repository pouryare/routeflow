"use client";

import { useEffect, useMemo, useState } from "react";
import { useLatest } from "@/lib/useLatest";
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-routing-machine";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import FullscreenControl from "./FullscreenControl";
import LocateControl from "./LocateControl";
import MyLocationMarker from "./MyLocationMarker";
import { facilityIcon } from "./facilityIcon";
import type { FacilityRow } from "@/lib/facilityTypes";
import { isPlaced } from "@/lib/facilityTypes";
import { faFixed, faNum } from "@/lib/format";
import { QUIET_TILES } from "@/lib/mapLayers";
import type { RoutesFoundEvent, WithRouting } from "@/types/leafletRouting";

export interface RouteStop {
  lat: number;
  lng: number;
  label: string;
}

interface RouteSummary {
  distanceKm: number;
  minutes: number;
}

function RoutingLayer({
  stops,
  onSummary,
}: {
  stops: RouteStop[];
  onSummary: (s: RouteSummary | null) => void;
}) {
  const map = useMap();
  const key = useMemo(() => stops.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|"), [stops]);

  /* The control is rebuilt only when the map or the route itself changes (`key`). What it
     reads is always the newest: the stops through a ref, and the callback, which the parent
     recreates every render, through another. Listing the callback as a dependency would
     rebuild the control on every render. */
  const stopsRef = useLatest(stops);
  const onSummaryRef = useLatest(onSummary);

  useEffect(() => {
    const route = stopsRef.current;
    if (route.length < 2) {
      onSummaryRef.current(null);
      return;
    }
    const control = (L as unknown as WithRouting).Routing.control({
      waypoints: route.map((s) => L.latLng(s.lat, s.lng)),
      routeWhileDragging: false,
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: true,
      show: false,
      lineOptions: { styles: [{ color: "#2DE0E6", weight: 4, opacity: 0.85 }], extendToWaypoints: true, missingRouteTolerance: 0 },
      createMarker: (i: number, wp: { latLng: L.LatLng }) => {
        const isFirst = i === 0;
        const isLast = i === route.length - 1;
        /* The start marker is the filled accent disc (.route-stop-marker--start); it
           needs no glyph, and «◎» was a text character standing in for an icon. */
        const label = isFirst || isLast ? "" : String(i);
        return L.marker(wp.latLng, {
          icon: L.divIcon({
            className: "",
            html: `<div class="route-stop-marker${isFirst ? " route-stop-marker--start" : ""}${isLast ? " route-stop-marker--end" : ""}">${label}</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
          zIndexOffset: 900,
        }).bindTooltip(route[i].label);
      },
    });
    control.on("routesfound", (e: RoutesFoundEvent) => {
      const r = e.routes?.[0];
      if (!r) return;
      onSummaryRef.current({ distanceKm: r.summary.totalDistance / 1000, minutes: Math.round(r.summary.totalTime / 60) });
    });
    control.on("routingerror", () => onSummaryRef.current(null));
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, key, stopsRef, onSummaryRef]);

  return null;
}

export default function PlannerRouteMap({
  stops,
  facilities = [],
}: {
  stops: RouteStop[];
  facilities?: FacilityRow[];
}) {
  const [summary, setSummary] = useState<RouteSummary | null>(null);
  const bounds = useMemo<[number, number][]>(() => stops.map((s) => [s.lat, s.lng]), [stops]);

  if (stops.length < 2) return null;

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="h-64 w-full">
        <MapContainer bounds={bounds} className="h-full w-full" boundsOptions={{ padding: [30, 30] }}>
          <TileLayer
            url={QUIET_TILES.url}
            attribution={QUIET_TILES.attribution}
            className="tiles-quiet"
            maxZoom={QUIET_TILES.maxZoom}
          />
          <RoutingLayer stops={stops} onSummary={setSummary} />
          {/* Below the route markers (zIndexOffset 900): a stop the user is reading off
              the list is more urgent than a landmark. Without these the origin is
              invisible on the very map that routes from it. */}
          {facilities.filter(isPlaced).map((f) => (
            <Marker key={f.id} position={[f.lat, f.lng]} icon={facilityIcon(f.kind, f.icon_key)} zIndexOffset={800}>
              <Tooltip>{f.name}</Tooltip>
            </Marker>
          ))}
          {/* The route is read against where you actually are, so the map that draws it
              has to show that too. */}
          <MyLocationMarker />
          <LocateControl />
          <FullscreenControl />
        </MapContainer>
      </div>
      {summary && (
        <div className="flex items-center justify-between border-t border-border bg-surface px-3 py-2 font-mono text-[length:var(--text-xs)] text-text-muted">
          <span>مسیر پیشنهادی روی جاده</span>
          <span className="text-text">
            {faFixed(summary.distanceKm, 1)} کیلومتر · {faNum(summary.minutes)} دقیقه
          </span>
        </div>
      )}
    </div>
  );
}
