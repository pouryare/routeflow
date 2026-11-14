import { faDigits } from "@/lib/crm/vocab";
import { isOpenAt, parseHours, satIndex, type WorkingHours } from "@/lib/crm/hours";

/** Opening hours as a warning, never a block (batch H). A shop's hours are when the shop is open, which is not
 *  always when it receives goods, and an empty or unreadable list means "unknown", which warns about nothing. */
export type OpeningWarning =
  | { kind: "before"; opens: string }   // arrives before opening: «قبل از باز شدن»
  | { kind: "after" }                   // arrives after closing the same day
  | { kind: "closed_day" };             // no hours at all on that weekday

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** `dateIso` is a plain «YYYY-MM-DD»; `arriveMin` is minutes after midnight Tehran (may pass 1440). */
export function openingWarning(hours: WorkingHours, dateIso: string, arriveMin: number): OpeningWarning | null {
  if (hours.length === 0) return null;
  const dow = satIndex(new Date(`${dateIso}T12:00:00Z`).getUTCDay());
  const day = dow + Math.floor(arriveMin / 1440);
  const minute = arriveMin % 1440;
  const d = ((day % 7) + 7) % 7;
  if (isOpenAt(hours, d, minute)) return null;
  const today = hours.filter((r) => r.days.includes(d));
  if (today.length === 0) return { kind: "closed_day" };
  const later = today.map((r) => toMin(r.from)).filter((f) => f > minute).sort((a, b) => a - b)[0];
  if (later === undefined) return { kind: "after" };
  const hh = String(Math.floor(later / 60)).padStart(2, "0");
  return { kind: "before", opens: `${hh}:${String(later % 60).padStart(2, "0")}` };
}

/** From the customer's stored `working_hours_json`. */
export function openingWarningFromJson(json: string | null | undefined, dateIso: string, arriveMin: number): OpeningWarning | null {
  return openingWarning(parseHours(json), dateIso, arriveMin);
}

/** The line shown on a stop card. */
export function warningText(w: OpeningWarning): string {
  if (w.kind === "before") return `قبل از باز شدن می‌رسید؛ ساعت ${faDigits(w.opens)} باز می‌شود`;
  if (w.kind === "after") return "بعد از بسته شدن می‌رسید";
  return "این روز بسته است";
}

/** VROOM's window for one day, seconds after midnight: the earliest opening to the latest closing among the
 *  ranges that start on that weekday. Null when the hours are unknown or the shop is closed that day.
 *  shortcut: one span per day (a lunch break is ignored) and a range that closes after midnight is cut at 24:00,
 *  upgrade by passing several windows when the solver result shows it matters. */
export function dayWindow(hours: WorkingHours, dateIso: string): [number, number] | null {
  const dow = satIndex(new Date(`${dateIso}T12:00:00Z`).getUTCDay());
  const today = hours.filter((r) => r.days.includes(dow));
  if (today.length === 0) return null;
  const from = Math.min(...today.map((r) => toMin(r.from)));
  const to = Math.max(...today.map((r) => (toMin(r.to) <= toMin(r.from) ? 1440 : toMin(r.to))));
  return [from * 60, to * 60];
}
