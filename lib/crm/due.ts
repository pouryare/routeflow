import { toJalali } from "@/lib/jalali";
import { faDigits } from "./vocab";

/** Tehran has kept +03:30 year-round since 2022. */
export const TEHRAN_OFFSET_MIN = 210;
const MIN = 60_000;

export type DueSpec =
  | { kind: "at_today"; hour: number }
  | { kind: "in_hours"; hours: number }
  | { kind: "tomorrow"; hour: number }
  | { kind: "in_days"; days: number; hour: number }
  | { kind: "in_months"; months: number; hour: number }
  | { kind: "pick"; hour: number }
  | { kind: "none" };

export function tehranParts(iso: string) {
  const t = new Date(Date.parse(iso) + TEHRAN_OFFSET_MIN * MIN);
  return { y: t.getUTCFullYear(), m0: t.getUTCMonth(), d: t.getUTCDate(), h: t.getUTCHours(), min: t.getUTCMinutes(), jsDow: t.getUTCDay() };
}

/** A Tehran wall-clock moment as a UTC ISO string. Date.UTC normalises day/month overflow. */
function tehranWall(y: number, m0: number, d: number, h: number, min = 0): string {
  return new Date(Date.UTC(y, m0, d, h, min) - TEHRAN_OFFSET_MIN * MIN).toISOString();
}

export function resolveDue(spec: DueSpec, nowIso: string, picked?: string | null): string | null {
  const p = tehranParts(nowIso);
  switch (spec.kind) {
    case "none":
      return null;
    case "in_hours":
      return new Date(Date.parse(nowIso) + spec.hours * 60 * MIN).toISOString();
    case "at_today": {
      const at = tehranWall(p.y, p.m0, p.d, spec.hour);
      return Date.parse(at) > Date.parse(nowIso) ? at : new Date(Date.parse(nowIso) + 60 * MIN).toISOString();
    }
    case "tomorrow":
      return tehranWall(p.y, p.m0, p.d + 1, spec.hour);
    case "in_days":
      return tehranWall(p.y, p.m0, p.d + spec.days, spec.hour);
    case "in_months":
      return tehranWall(p.y, p.m0 + spec.months, p.d, spec.hour);
    case "pick": {
      if (!picked || !/^\d{4}-\d{2}-\d{2}$/.test(picked)) return null;
      const [y, m, d] = picked.split("-").map(Number);
      return tehranWall(y, m - 1, d, spec.hour);
    }
  }
}

export function labelDue(iso: string, nowIso: string): string {
  const a = tehranParts(nowIso);
  const b = tehranParts(iso);
  const n = Math.round((Date.UTC(b.y, b.m0, b.d) - Date.UTC(a.y, a.m0, a.d)) / 86_400_000);
  const time = faDigits(`${String(b.h).padStart(2, "0")}:${String(b.min).padStart(2, "0")}`);
  let day: string;
  if (n === 0) day = "امروز";
  else if (n === 1) day = "فردا";
  else if (n === 2) day = "پس‌فردا";
  else if (n > 2 && n < 14) day = `${faDigits(String(n))} روز دیگر`;
  else {
    const j = toJalali(iso);
    day = j ? faDigits(`${j.jd}/${j.jm}`) : faDigits(iso.slice(0, 10));
  }
  return `${day} ${time}`;
}
