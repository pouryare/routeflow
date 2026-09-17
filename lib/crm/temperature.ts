import type { Temperature } from "./vocab";

export interface TempWindows { hotDays: number; warmDays: number }
export const DEFAULT_WINDOWS: TempWindows = { hotDays: 14, warmDays: 30 };
export interface TempSignal { at: string; signal: Temperature }

const DAY = 86_400_000;

/** The latest eligible signal wins, with later entries breaking timestamp ties.
 * Hot signals cool to warm after hotDays; all signals expire after warmDays.
 * Missed calls carry no signal, so they do not erase prior interest. */
export function autoTemperature(signals: TempSignal[], asOfIso: string, w: TempWindows = DEFAULT_WINDOWS): Temperature {
  const now = Date.parse(asOfIso);
  let latest: TempSignal | null = null;
  for (const s of signals) {
    const t = Date.parse(s.at);
    if (t > now || now - t > w.warmDays * DAY) continue;
    if (!latest || t >= Date.parse(latest.at)) latest = s;
  }
  if (!latest) return "cold";
  if (latest.signal === "hot") return now - Date.parse(latest.at) <= w.hotDays * DAY ? "hot" : "warm";
  return latest.signal;
}
