/** F6: rules for a driver's shared position. Pure. */

/** The phone sends a position this often while the run is in progress. */
export const SEND_EVERY_MS = 30_000;
/** A dot older than this is drawn grey: the phone has gone quiet (no signal, app closed). */
const STALE_AFTER_MS = 5 * 60_000;

export interface PositionIn { lat: number; lng: number; accuracyM: number | null }

/** The position from a request body, or why it is refused. A fix with an accuracy worse than 5 km is a cell-tower guess, not a place. */
export function parsePosition(body: unknown): PositionIn | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const { lat, lng, accuracy } = b;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return "موقعیت نامعتبر است";
  if (accuracy !== undefined && accuracy !== null && (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0)) return "دقت موقعیت نامعتبر است";
  if (typeof accuracy === "number" && accuracy > 5000) return "دقت موقعیت کم است";
  return { lat, lng, accuracyM: typeof accuracy === "number" ? Math.round(accuracy) : null };
}

/** «همین الان», «۳ دقیقه پیش», «۲ ساعت پیش»: how old a live dot is, so nobody trusts a stale one. */
export function ageLabel(ageMs: number): string {
  const fa = (n: number) => n.toLocaleString("fa-IR");
  const min = Math.floor(Math.max(0, ageMs) / 60_000);
  if (min < 1) return "همین الان";
  if (min < 60) return `${fa(min)} دقیقه پیش`;
  return `${fa(Math.floor(min / 60))} ساعت پیش`;
}

export const isStale = (ageMs: number) => ageMs > STALE_AFTER_MS;
