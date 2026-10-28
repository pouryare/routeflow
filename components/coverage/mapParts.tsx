"use client";

import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-maplibre";
import { CustomerRow } from "@/lib/types";
import { distanceKm } from "@/lib/geo";
import { isPlaced, FacilityRow } from "@/lib/facilityTypes";
import { MapView } from "@/lib/deepLink";
import { type Bounds } from "@/lib/mapWorklist";

/** Publishes where the map is once on mount and again whenever it settles: the view for
 *  the address bar and memory, the zoom for the precision tier, the visible area for the
 *  worklist (lib/mapWorklist.ts). Only `moveend`, never `move`: the intermediate values
 *  during a pinch or a flight would thrash the tier and re-fetch geometry mid-gesture. */
export function MapWatcher({
  onView,
  onZoom,
  onBounds,
}: {
  onView: (v: MapView) => void;
  onZoom: (zoom: number) => void;
  onBounds: (b: Bounds) => void;
}) {
  const { current: map } = useMap();
  const latest = useRef({ onView, onZoom, onBounds });
  useEffect(() => {
    latest.current = { onView, onZoom, onBounds };
  });
  useEffect(() => {
    if (!map) return;
    const report = (first: boolean) => {
      const c = map.getCenter(), b = map.getBounds(), z = map.getZoom();
      if (!first) latest.current.onView({ lat: c.lat, lng: c.lng, zoom: Math.round(z * 100) / 100 });
      latest.current.onZoom(z);
      latest.current.onBounds({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
    };
    const settle = () => report(false);
    report(true);
    map.on("moveend", settle);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __map?: unknown }).__map = map.getMap();
    return () => {
      map.off("moveend", settle);
    };
  }, [map]);
  return null;
}

/** The opening view when nothing else has said where to look. Skipped entirely when the
 *  URL carries a view or a target, or when this browser remembers where it was left --
 *  fitting to all customers would throw away the thing the user actually asked for. */
export function FitToCustomers({ customers, enabled }: { customers: CustomerRow[]; enabled: boolean }) {
  const { current: map } = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!map || !enabled || fitted.current) return;
    const pts = customers.filter((c) => c.lat && c.lng) as (CustomerRow & { lat: number; lng: number })[];
    if (pts.length === 0) return;
    fitted.current = true;
    if (pts.length === 1) {
      map.jumpTo({ center: [pts[0].lng, pts[0].lat], zoom: 13 });
    } else {
      const lngs = pts.map((p) => p.lng), lats = pts.map((p) => p.lat);
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 40, maxZoom: 14, duration: 0 });
    }
  }, [customers, map, enabled]);
  return null;
}

/** Straight-line distance from one site to the nearest other one -- the popup's
 *  "N km from the warehouse" line. Takes the list rather than closing over it, since
 *  the sites now arrive as a prop and can change while the map is open. */
export function otherFacilityDistance(
  f: FacilityRow,
  all: FacilityRow[]
): { other: FacilityRow; km: number } | null {
  // Both ends need a position, so an unplaced facility is not a candidate to measure to.
  // `self` is a const on purpose: TypeScript resets narrowing on a mutable binding inside a
  // closure, so passing `f` directly to the callback below loses the isPlaced proof.
  if (!isPlaced(f)) return null;
  const self = f;
  const others = all.filter(isPlaced).filter((x) => x.id !== self.id);
  if (others.length === 0) return null;
  return others
    .map((other) => ({ other, km: distanceKm(self, other) }))
    .sort((a, b) => a.km - b.km)[0];
}
