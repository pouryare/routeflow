"use client";

import { useState } from "react";
import FullscreenControl from "./FullscreenControl";
import LocateControl from "./LocateControl";
import MyLocationMarker from "./MyLocationMarker";
import FacilityMarker from "./FacilityMarker";
import type { FacilityRow } from "@/lib/facilityTypes";
import { isPlaced } from "@/lib/facilityTypes";
import { faFixed, faNum } from "@/lib/format";
import type { DrivingRoute } from "@/lib/osrm";
import AppMap from "@/components/map/AppMap";
import RouteLine, { type RouteStop } from "@/components/map/RouteLine";

export type { RouteStop };

export default function PlannerRouteMap({
  stops,
  facilities = [],
}: {
  stops: RouteStop[];
  facilities?: FacilityRow[];
}) {
  const [summary, setSummary] = useState<DrivingRoute | null>(null);

  if (stops.length < 2) return null;

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="h-64 w-full">
        <AppMap initialViewState={{ latitude: stops[0].lat, longitude: stops[0].lng, zoom: 12 }}>
          <RouteLine stops={stops} onRoute={setSummary} />
          {/* Below the route markers: a stop the user is reading off the list is more
              urgent than a landmark. Without these the origin is invisible on the very
              map that routes from it. */}
          {facilities.filter(isPlaced).map((f) => (
            <FacilityMarker key={f.id} lat={f.lat} lng={f.lng} kind={f.kind} iconKey={f.icon_key} name={f.name} />
          ))}
          {/* The route is read against where you actually are, so the map that draws it
              has to show that too. */}
          <MyLocationMarker />
          <LocateControl />
          <FullscreenControl />
        </AppMap>
      </div>
      {summary && (
        <div className="flex items-center justify-between border-t border-border bg-surface px-3 py-2 font-mono text-[length:var(--text-xs)] text-text-muted">
          <span>مسیر پیشنهادی روی جاده</span>
          <span className="text-text">
            {faFixed(summary.km, 1)} کیلومتر · {faNum(summary.minutes)} دقیقه
          </span>
        </div>
      )}
    </div>
  );
}
