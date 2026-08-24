/** Tehran's two driving-restriction zones, and whether you are allowed in right now.
 *
 *  Both boundaries come from OpenStreetMap (relations 6947428 and 6950174) and are baked
 *  into public/tehran-traffic-zones.geojson by scripts/build-traffic-zones.mjs, so they
 *  cost no request at runtime and work with no signal. They change roughly never.
 *
 *  The hours for محدوده طرح ترافیک come from the relation's own `motor_vehicle:conditional`
 *  tag. The pollution-control zone carries no hours in OSM, so this reports "unknown" for
 *  it rather than inventing a schedule -- being confidently wrong about a zone that issues
 *  fines is worse than saying nothing.
 *
 *  ## What this deliberately does not know
 *
 *  Public holidays. The zone is free on them, and there is no offline list of Iranian
 *  public holidays in this app to check against, so a holiday reads as an ordinary
 *  weekday: the app will say "restricted" when you are actually free to drive in. That
 *  error is in the safe direction, and the UI says so rather than hiding it.
 */

/** JS day numbering: 0 = Sunday ... 6 = Saturday. The Iranian working week runs Saturday
 *  (6) through Wednesday (3), with Thursday (4) a half day and Friday (5) the weekend. */
export interface RestrictedWindow {
  days: number[];
  /** "HH:MM", local time. */
  from: string;
  to: string;
}

export interface TrafficZoneProperties {
  id: string;
  name: string;
  name_en: string | null;
  /** Null when nobody has recorded the hours -- see the note above. */
  restricted: RestrictedWindow[] | null;
  osm_relation: number;
  note: string | null;
}

export type ZoneState = "restricted" | "free" | "unknown";

export interface ZoneStatus {
  state: ZoneState;
  /** "HH:MM" the current state ends, when that is known and happens today. Null when the
   *  state runs past midnight or cannot be worked out. */
  until: string | null;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Whether driving into the zone is restricted at `now`.
 *
 *  Windows are half-open: 06:30-17:00 means restricted at 06:30 and free at 17:00. The
 *  boundary minute has to belong to one side or the other, and the side that lets you
 *  drive at exactly 17:00 is the one that matches how the rule is written and announced.
 */
export function zoneStatusNow(restricted: RestrictedWindow[] | null, now: Date = new Date()): ZoneStatus {
  if (restricted === null) return { state: "unknown", until: null };

  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const w of restricted) {
    if (!w.days.includes(day)) continue;
    const from = minutesOf(w.from);
    const to = minutesOf(w.to);
    if (minutes >= from && minutes < to) return { state: "restricted", until: w.to };
  }

  // Free now. If a window starts later today, say when -- "free until 06:30" is the fact
  // worth having at 6am.
  let nextStart: number | null = null;
  for (const w of restricted) {
    if (!w.days.includes(day)) continue;
    const from = minutesOf(w.from);
    if (from > minutes && (nextStart === null || from < nextStart)) nextStart = from;
  }
  if (nextStart === null) return { state: "free", until: null };
  const h = Math.floor(nextStart / 60);
  const m = nextStart % 60;
  return { state: "free", until: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}

/** Whether a point is inside a GeoJSON linear ring, by ray casting.
 *
 *  Flat-plane, no projection: the zones span a few kilometres of one city, where the
 *  distortion is far below the precision of a "which side of this boundary am I" answer.
 *
 *  Coordinates are GeoJSON order, [lng, lat].
 */
export function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // Does the edge straddle the ray's latitude, and is the crossing to the east?
    const straddles = yi > lat !== yj > lat;
    if (straddles && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Which of the given zones contain the point. Ordered as the file lists them, which puts
 *  the smaller and stricter zone first. */
export function zonesContaining(
  lng: number,
  lat: number,
  zones: { properties: TrafficZoneProperties; geometry: { coordinates: [number, number][][] } }[]
): TrafficZoneProperties[] {
  return zones.filter((z) => pointInRing(lng, lat, z.geometry.coordinates[0])).map((z) => z.properties);
}

export const TRAFFIC_ZONES_URL = "/tehran-traffic-zones.geojson";
