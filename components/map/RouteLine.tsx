"use client";

import { useEffect, useMemo, useState } from "react";
import { Layer, Marker, Source, useMap } from "@vis.gl/react-maplibre";
import { fetchRouteThrough, type DrivingRoute } from "@/lib/osrm";
import { faNum } from "@/lib/format";

export interface RouteStop {
  lat: number;
  lng: number;
  label: string;
}

/** A day's stops joined by the driving route, numbered in order, with the view fitted to
 *  them. Asks OSRM once per change of stops; until (or unless) it answers, the stops are
 *  joined by straight dashes so the order is still readable. `onRoute` gets the road
 *  distance and time, or null when there is no road route.
 *
 *  `lineOnly` is for a map that already draws and frames its own pins (the leads map):
 *  no stop markers, and the view is left where the reader put it. */
export default function RouteLine({
  stops,
  onRoute,
  lineOnly = false,
}: {
  stops: { lat: number; lng: number; label?: string }[];
  onRoute?: (route: DrivingRoute | null) => void;
  lineOnly?: boolean;
}) {
  const { current: map } = useMap();
  const key = stops.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|");
  // The stops as a value that changes only when a stop moves, not on every parent render.
  const points = useMemo(
    () => (key ? key.split("|").map((p) => { const [lat, lng] = p.split(",").map(Number); return { lat, lng }; }) : []),
    [key],
  );
  const [route, setRoute] = useState<{ key: string; route: DrivingRoute | null } | null>(null);

  useEffect(() => {
    if (points.length < 2) return;
    const controller = new AbortController();
    // An answer for a route that has since changed is dropped by the abort.
    void fetchRouteThrough(points, "full", controller.signal).then((r) => {
      if (!controller.signal.aborted) setRoute({ key, route: r });
    });
    return () => controller.abort();
  }, [key, points]);

  const current = route?.key === key ? route.route : null;
  useEffect(() => {
    onRoute?.(current);
  }, [current, onRoute]);

  useEffect(() => {
    if (!map || lineOnly || points.length < 2) return;
    const lngs = points.map((s) => s.lng), lats = points.map((s) => s.lat);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 30, duration: 0, maxZoom: 16 });
  }, [map, lineOnly, points]);

  const line = useMemo<GeoJSON.Feature<GeoJSON.LineString>>(() => ({
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: (current?.path ?? stops).map((p) => [p.lng, p.lat]) },
  }), [current, stops]);

  if (stops.length < 2) return null;
  return (
    <>
      <Source id="route-line" type="geojson" data={line}>
        <Layer
          id="route-line"
          type="line"
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{ "line-color": "#2DE0E6", "line-width": 4, "line-opacity": 0.85, ...(current ? {} : { "line-dasharray": [1, 2] }) }}
        />
      </Source>
      {!lineOnly && stops.map((s, i) => {
        const first = i === 0, last = i === stops.length - 1;
        return (
          <Marker key={`${i}-${s.lat},${s.lng}`} longitude={s.lng} latitude={s.lat} style={{ zIndex: 2 }}>
            {/* The start is the filled accent disc; it needs no number. */}
            <div className={`route-stop-marker${first ? " route-stop-marker--start" : ""}${last ? " route-stop-marker--end" : ""}`} title={s.label}>
              {first || last ? "" : faNum(i)}
            </div>
          </Marker>
        );
      })}
    </>
  );
}
