import { cellToBoundary, cellToLatLng, latLngToCell } from "h3-js";

/** The hexagon grid (h3-js, Apache-2.0): the city cut into honeycomb cells, so "per area" has one stable answer.
 *  Cell level 8 is about 0.7 km², roughly a thousand cells over Tehran; level 7 is about five times larger. */
export const HEX_RES_DEFAULT = 8;
export const HEX_RES_OPTIONS = [7, 8] as const;

export function isHexRes(v: unknown): v is (typeof HEX_RES_OPTIONS)[number] {
  return typeof v === "number" && (HEX_RES_OPTIONS as readonly number[]).includes(v);
}

export interface HexPoint { lat: number; lng: number; weight?: number }
export interface HexCell { h3: string; count: number; value: number }

/** Counts points per cell: `count` is how many fell in it, `value` is the sum of their weights (1 each by default).
 *  Points off the planet (NaN, beyond ±90/±180) are dropped, not thrown on: one bad row must not blank the map. */
export function hexBins(points: HexPoint[], res: number = HEX_RES_DEFAULT): HexCell[] {
  const cells = new Map<string, HexCell>();
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) continue;
    const id = latLngToCell(p.lat, p.lng, res);
    const c = cells.get(id) ?? { h3: id, count: 0, value: 0 };
    c.count += 1;
    c.value += p.weight ?? 1;
    cells.set(id, c);
  }
  return [...cells.values()].sort((a, b) => b.value - a.value);
}

/** A cell as a GeoJSON polygon ring, longitude first as MapLibre expects. */
export function hexPolygon(h3: string): GeoJSON.Polygon {
  // formatAsGeoJson: [lng, lat] pairs, and the first corner is repeated to close the ring.
  return { type: "Polygon", coordinates: [cellToBoundary(h3, true)] };
}

export function hexCenter(h3: string): { lat: number; lng: number } {
  const [lat, lng] = cellToLatLng(h3);
  return { lat, lng };
}

/** Five colour steps, light to dark by quantile of the cells' values: a map with one very busy cell
 *  would otherwise paint every other cell the palest step. Returns the step 0..4 for each value. */
export function hexSteps(values: number[], steps = 5): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const rank = sorted.findIndex((x) => x >= v);
    return Math.min(steps - 1, Math.floor((rank / sorted.length) * steps));
  });
}
