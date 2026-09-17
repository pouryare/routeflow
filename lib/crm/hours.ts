import { faDigits } from "./vocab";
import { tehranParts } from "./due";

/** days: 0 = شنبه … 6 = جمعه (the Iranian week). `to` may be earlier than `from` for a
 *  range that closes after midnight; "24:00" is allowed as a closing time. */
export interface HoursRange { days: number[]; from: string; to: string }
export type WorkingHours = HoursRange[];

export const WEEKDAY_LABEL = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const HHMM = /^([01]\d|2[0-4]):([0-5]\d)$/;
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function isWorkingHours(v: unknown): v is WorkingHours {
  if (!Array.isArray(v) || v.length > 14) return false;
  return v.every((r) => {
    if (!r || typeof r !== "object") return false;
    const { days, from, to } = r as HoursRange;
    return (
      Array.isArray(days) && days.length > 0 && new Set(days).size === days.length &&
      days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
      typeof from === "string" && typeof to === "string" && HHMM.test(from) && HHMM.test(to) && from !== to
    );
  });
}

export function parseHours(json: string | null | undefined): WorkingHours {
  try {
    const v: unknown = JSON.parse(json ?? "[]");
    return isWorkingHours(v) ? v : [];
  } catch {
    return [];
  }
}

/** Saturday-first index from JS getUTCDay() (0 = Sunday). */
export const satIndex = (jsDow: number): number => (jsDow + 1) % 7;

export function isOpenAt(h: WorkingHours, dow: number, minute: number): boolean {
  return h.some((r) => {
    const f = toMin(r.from);
    const t = toMin(r.to);
    if (f < t) return r.days.includes(dow) && minute >= f && minute < t;
    return (r.days.includes(dow) && minute >= f) || (r.days.includes((dow + 6) % 7) && minute < t);
  });
}

const QUARTER = 15 * 60_000;

/** The first moment at or after `iso` when the business is open; `iso` itself when hours
 *  are unknown or never open within a week. */
export function nextOpenAt(h: WorkingHours, iso: string): string {
  if (h.length === 0) return iso;
  const open = (ms: number) => {
    const p = tehranParts(new Date(ms).toISOString());
    return isOpenAt(h, satIndex(p.jsDow), p.h * 60 + p.min);
  };
  const start = Date.parse(iso);
  if (open(start)) return iso;
  let ms = Math.ceil(start / QUARTER) * QUARTER;
  for (let i = 0; i < 7 * 24 * 4; i++, ms += QUARTER) if (open(ms)) return new Date(ms).toISOString();
  return iso;
}

function daysLabel(days: number[]): string {
  const s = [...days].sort((a, b) => a - b).join(",");
  if (s === "0,1,2,3,4,5,6") return "همه‌روزه";
  if (s === "0,1,2,3,4") return "شنبه تا چهارشنبه";
  if (s === "0,1,2,3,4,5") return "به‌جز جمعه";
  return [...days].sort((a, b) => a - b).map((d) => WEEKDAY_LABEL[d]).join("، ");
}
const clock = (hhmm: string) => faDigits(hhmm.endsWith(":00") ? String(Number(hhmm.slice(0, 2))) : `${Number(hhmm.slice(0, 2))}:${hhmm.slice(3)}`);

export function formatHours(h: WorkingHours): string {
  const groups = new Map<string, HoursRange[]>();
  for (const r of h) {
    const key = [...r.days].sort((a, b) => a - b).join(",");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .map((rs) => `${daysLabel(rs[0].days)} ${rs.map((r) => `${clock(r.from)}–${clock(r.to)}`).join(" و ")}`)
    .join(" · ");
}
