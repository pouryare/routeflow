import { distanceKm, type LatLng } from "@/lib/geo";

/** Arriving at a door: which stop of today's run the driver is standing at, if any.
 *
 *  Only a PENDING stop counts (a delivered or refused one has nothing left to record), only one
 *  with coordinates, and one the driver has not already waved away. Within the radius the nearest
 *  wins. The radius matches the geofence prompt on the map (150 m). */
export const ARRIVAL_RADIUS_KM = 0.15;

export interface DoorStop {
  id: number;
  status: string;
  lat: number | null;
  lng: number | null;
}

export function stopAtDoor<T extends DoorStop>(stops: T[], here: LatLng | null, snoozed: ReadonlySet<number>, radiusKm = ARRIVAL_RADIUS_KM): T | null {
  if (!here) return null;
  let best: { stop: T; km: number } | null = null;
  for (const s of stops) {
    if (s.status !== "pending" || s.lat === null || s.lng === null || snoozed.has(s.id)) continue;
    const km = distanceKm(here, { lat: s.lat, lng: s.lng });
    if (km <= radiusKm && (!best || km < best.km)) best = { stop: s, km };
  }
  return best ? best.stop : null;
}
