import type { LeadScores } from "@/lib/leadScore";

/** The slice of a saved lead location the analytics panels read: where it is, how far along it
 *  is, and its star ratings. Narrower than the database row on purpose, so a panel cannot grow
 *  a dependency on a column the /api/locations response does not promise. */
export interface AnalyticsLocation extends LeadScores {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
  status: string | null;
}

/** A location that has coordinates, for the panels that put it on a map. */
export type PlacedLocation = AnalyticsLocation & { lat: number; lng: number };

export const hasCoords = (l: AnalyticsLocation): l is PlacedLocation => l.lat !== null && l.lng !== null;
