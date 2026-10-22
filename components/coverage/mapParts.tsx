"use client";

import { useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import { LatLngBounds, divIcon } from "leaflet";
import type { DivIcon } from "leaflet";
import { CustomerRow, shapeForColor } from "@/lib/types";
import { distanceKm } from "@/lib/geo";
import { isPlaced, FacilityRow } from "@/lib/facilityTypes";
import { faNum } from "@/lib/format";
import { MapView } from "@/lib/deepLink";
import { type Bounds } from "@/lib/mapWorklist";
import { MAP_PIN_SVG } from "@/components/meridian/icon-map";

export const toBounds = (b: LatLngBounds): Bounds => ({
  south: b.getSouth(),
  west: b.getWest(),
  north: b.getNorth(),
  east: b.getEast(),
});

/** Reports the visible area once on mount and again whenever the map settles, for the
 *  sidebar's worklist (lib/mapWorklist.ts). */
export function BoundsReporter({ onBounds }: { onBounds: (b: Bounds) => void }) {
  const map = useMapEvents({ moveend: () => onBounds(toBounds(map.getBounds())) });
  useEffect(() => {
    onBounds(toBounds(map.getBounds()));
  }, [map, onBounds]);
  return null;
}

export function DebugMapExpose() {
  const map = useMap();
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __leafletMap?: unknown }).__leafletMap = map;
    }
  }, [map]);
  return null;
}

/** Publishes the map's zoom upward so the "auto" precision mode can pick a tier.
 *  Deliberately only listens to zoomend, not zoom: the intermediate values during a
 *  pinch or a flyTo would thrash the tier and re-fetch geometry mid-gesture. */
export function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
  });
  return null;
}

/** The opening view when nothing else has said where to look. Skipped entirely when the
 *  URL carries a view or a target, or when this browser remembers where it was left --
 *  fitting to all customers would throw away the thing the user actually asked for. */
/** Publishes the map's position after every gesture. moveend covers zooming too --
 *  Leaflet fires a move for a zoom -- so one listener is enough, and it fires once at the
 *  end of a pan rather than continuously through it. */
export function ViewWatcher({ onView }: { onView: (v: MapView) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      onView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    },
  });
  return null;
}

export function FitToCustomers({ customers, enabled }: { customers: CustomerRow[]; enabled: boolean }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!enabled || fitted.current) return;
    const pts = customers.filter((c) => c.lat && c.lng).map((c) => [c.lat as number, c.lng as number] as [number, number]);
    if (pts.length === 0) return;
    fitted.current = true;
    if (pts.length === 1) {
      map.setView(pts[0], 13);
    } else {
      const bounds = pts.reduce((b, p) => b.extend(p), new LatLngBounds(pts[0], pts[0]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [customers, map, enabled]);
  return null;
}

// Leaflet icons are stateless factories -- one instance can back every marker that
// looks alike -- so these are built once per distinct appearance and shared. Building
// them inline instead meant 135 fresh divIcons on every render of this component (a
// sidebar toggle, a color-mode switch, a GPS fix), each one forcing Leaflet to tear
// down and rebuild that marker's DOM.
export const iconCache = new Map<string, DivIcon>();

// Only the selected marker pulses. Two infinite CSS animations on every customer meant
// a few hundred of them running forever once clustering disengages at zoom 16, which
// the compositor pays for continuously on a phone -- and a map where everything pulses
// communicates nothing anyway.
export function customerIcon(color: string, selected: boolean, shaped: boolean): DivIcon {
  const shape = shaped ? shapeForColor(color) : "diamond";
  const key = `${color}|${selected}|${shape}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const pings = selected
    ? `<span class="customer-marker__ping" aria-hidden="true" style="animation-delay:0ms"></span>
      <span class="customer-marker__ping" aria-hidden="true" style="animation-delay:var(--pulse-stagger)"></span>`
    : "";
  const icon = divIcon({
    className: "",
    html: `<div class="customer-marker customer-marker--${shape}${selected ? " customer-marker--selected" : ""}" style="--marker-color:${color}">
      ${pings}<span class="customer-marker__diamond"></span>
    </div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  iconCache.set(key, icon);
  return icon;
}

// Cluster bubbles reuse the accent hue (identity-neutral -- a cluster mixes every
// status/debt/salesperson color underneath it, so it can't commit to one) rather than
// any div in MASTER.md's reserved status palette.
export function clusterIcon(cluster: { getChildCount: () => number }) {
  const count = cluster.getChildCount();
  const size = count < 10 ? 30 : count < 50 ? 36 : 44;
  return divIcon({
    className: "",
    html: `<div class="cluster-marker" style="width:${size}px;height:${size}px;">${faNum(count)}</div>`,
    iconSize: [size, size],
  });
}

export function foundLocationIcon() {
  return divIcon({
    className: "",
    html: `<div class="found-location-marker">${MAP_PIN_SVG}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });
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
