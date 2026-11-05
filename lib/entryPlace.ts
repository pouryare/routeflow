/** Z9: the phone's position sent with a money entry. Pure. */
export interface EntryPlace {
  lat: number;
  lng: number;
  accuracy_m: number | null;
}

/** The place from a request body's `place`, or null when there is none or it is off the globe.
 *  A bad place never refuses the payment: the money is the fact, the place is a help. */
export function parsePlace(v: unknown): EntryPlace | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (p.lat == null || p.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const acc = Number(p.accuracy_m);
  return { lat, lng, accuracy_m: p.accuracy_m != null && Number.isFinite(acc) && acc >= 0 ? acc : null };
}

/** The app's own map, centred on the spot (lib/deepLink.ts «at» view). */
export const placeHref = (p: { lat: number; lng: number }): string => `/map?at=${p.lat.toFixed(5)},${p.lng.toFixed(5)},17`;

/** Adds the phone's current fix, when it has one, to a money entry's request body (Z9). */
export function withPlace<T extends { body: Record<string, unknown> }>(req: T, pos: { lat: number; lng: number; accuracy?: number | null } | null): T {
  return pos ? { ...req, body: { ...req.body, place: { lat: pos.lat, lng: pos.lng, accuracy_m: pos.accuracy ?? null } } } : req;
}
