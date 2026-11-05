/** T17: the owner's maintenance window, as everyone in the company sees it. Pure. */
export interface Maintenance {
  from: string;
  to: string;
  note: string | null;
}

/** Iran keeps one offset all year (no daylight saving since 2022). */
const TEHRAN = "+03:30";

/** A Tehran wall-clock hour on a civil date, as an ISO instant. */
export function tehranInstant(dateIso: string, hour: number): string {
  const hh = String(Math.max(0, Math.min(23, Math.floor(hour)))).padStart(2, "0");
  return new Date(`${dateIso.slice(0, 10)}T${hh}:00:00${TEHRAN}`).toISOString();
}

/** Whether to show the banner, and which words: before the start it announces, during it warns.
 *  After the end (or with no window) it is gone. */
export function maintenancePhase(m: Maintenance | null, nowIso: string): "none" | "soon" | "now" {
  if (!m) return "none";
  const now = Date.parse(nowIso);
  if (!(now < Date.parse(m.to))) return "none";
  return now < Date.parse(m.from) ? "soon" : "now";
}

/** A refusal in words, or null when the window can be saved. */
export function checkMaintenance(from: string, to: string): string | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "زمان شروع و پایان را وارد کنید";
  if (!(b > a)) return "پایان باید بعد از شروع باشد";
  if (b - a > 3 * 86_400_000) return "بازهٔ تعمیر حداکثر سه روز است";
  return null;
}
