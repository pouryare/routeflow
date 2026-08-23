import type { LatLng } from "./geo";

/** The same public OSRM instance the planner and leads maps route against, so there is
 *  one host to allow in the CSP and one service to be down at a time. */
const ROUTE_URL = "https://router.project-osrm.org/route/v1/driving";

/** Give up rather than leave the corridor spinning. The band has a usable fallback --
 *  the straight line it always drew -- so a slow answer is worth less than a fast "no". */
const TIMEOUT_MS = 8000;

export interface DrivingRoute {
  /** The road, in the order driven. */
  path: LatLng[];
  /** Road distance in kilometres. Always longer than the straight line, and the honest
   *  figure to show beside a corridor drawn along real roads. */
  km: number;
}

/** The driving route between two points, or null if it cannot be had.
 *
 *  Null rather than a thrown error: every caller's fallback is the straight line, and
 *  there is nothing a caller could do with the difference between "offline", "OSRM said
 *  no route" and "OSRM returned something unrecognisable".
 *
 *  Asks for `overview=simplified` rather than `full`. The geometry feeds a band
 *  kilometres wide and a point-to-path distance run against every district on the map;
 *  full detail would add several hundred vertices that cannot be seen at that width and
 *  that every district then has to be measured against.
 */
export async function fetchDrivingRoute(a: LatLng, b: LatLng, signal?: AbortSignal): Promise<DrivingRoute | null> {
  const coords = `${a.lng},${a.lat};${b.lng},${b.lat}`;
  const url = `${ROUTE_URL}/${coords}?overview=simplified&geometries=geojson`;

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  // Either the caller giving up or the clock running out ends the request.
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const res = await fetch(url, { signal: combined });
    if (!res.ok) return null;
    const data = await res.json();
    return parseRoute(data);
  } catch {
    return null;
  }
}

/** Pulled out of the fetch so the shape-checking is testable without a network. OSRM
 *  answers `{code: "Ok", routes: [...]}`; anything else is a refusal in a 200. */
export function parseRoute(data: unknown): DrivingRoute | null {
  if (typeof data !== "object" || data === null) return null;
  const body = data as { code?: unknown; routes?: unknown };
  if (body.code !== "Ok" || !Array.isArray(body.routes) || body.routes.length === 0) return null;

  const route = body.routes[0] as { distance?: unknown; geometry?: { coordinates?: unknown } };
  const coordinates = route.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const path: LatLng[] = [];
  for (const c of coordinates) {
    // GeoJSON order is [lng, lat] -- the reverse of every other pair in this codebase.
    if (!Array.isArray(c) || c.length < 2) return null;
    const [lng, lat] = c;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    path.push({ lat, lng });
  }

  const metres = route.distance;
  if (typeof metres !== "number" || !Number.isFinite(metres)) return null;

  return { path, km: metres / 1000 };
}
