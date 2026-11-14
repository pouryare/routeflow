import { distanceKm, type LatLng } from "@/lib/geo";

/** F103: the distance a person covered between the shops they visited in a day, in time order.
 *  shortcut: straight-line distance × 1.3 for roads (Tehran streets are not straight), not a routed distance; upgrade when
 *  reimbursement is paid on it and the routing service can measure each leg. */
export const ROAD_FACTOR = 1.3;

export function dayKm(points: LatLng[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += distanceKm(points[i - 1], points[i]);
  return Math.round(km * ROAD_FACTOR * 10) / 10;
}
