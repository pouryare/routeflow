import { resolveDue } from "@/lib/crm/due";

/** F142: «remind me later» on a task or reminder, by moving its due time.
 *
 *  Only normal and low priority work can be put off: a critical or high item is the thing that
 *  must not be easy to ignore. And at most three times, so nothing is pushed off for ever; after
 *  that the choice is to do it or remove it.
 *
 *  Three set times, plus «زمان دیگر» (a day and an hour the person picks). On a task row the same
 *  four sit along one swipe: the further the drag, the later the time (SNOOZE_STOPS_PX). */

export type SnoozeChoice = "hour" | "three" | "tomorrow";

export const SNOOZE_CHOICES: { id: SnoozeChoice; label: string }[] = [
  { id: "hour", label: "یک ساعت دیگر" },
  { id: "three", label: "سه ساعت دیگر" },
  { id: "tomorrow", label: "فردا ساعت ۹" },
];

export const SNOOZE_PICK_LABEL = "زمان دیگر…";

export const MAX_SNOOZES = 3;

/** The hours a picked snooze may land on (Tehran wall clock), a working day's span. */
export const SNOOZE_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const;
/** A picked snooze no further than this: a task put off longer is better removed. */
const SNOOZE_MAX_DAYS = 60;

/** Where the swipe stops sit, in px dragged: one set time each, then the picker. The first is the swipe's commit. */
export const SNOOZE_STOPS_PX = [140, 175, 210, 245] as const;

export function isSnoozeChoice(v: unknown): v is SnoozeChoice {
  return v === "hour" || v === "three" || v === "tomorrow";
}

export function canSnooze(t: { priority: string; snooze_count: number; status?: string }): boolean {
  if (t.status !== undefined && t.status !== "open") return false;
  return (t.priority === "NORMAL" || t.priority === "LOW") && t.snooze_count < MAX_SNOOZES;
}

/** The new due time: an hour or three from now, or 09:00 Tehran tomorrow. */
export function snoozedDue(choice: SnoozeChoice, nowIso: string): string {
  if (choice === "tomorrow") return resolveDue({ kind: "tomorrow", hour: 9 }, nowIso) as string;
  return resolveDue({ kind: "in_hours", hours: choice === "hour" ? 1 : 3 }, nowIso) as string;
}

/** A picked day and hour as the new due time, or null when it is malformed, already past, or too far off. */
export function pickedSnoozeDue(day: unknown, hour: unknown, nowIso: string): string | null {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (typeof hour !== "number" || !(SNOOZE_HOURS as readonly number[]).includes(hour)) return null;
  const due = resolveDue({ kind: "pick", hour }, nowIso, day);
  if (!due) return null;
  const ahead = Date.parse(due) - Date.parse(nowIso);
  return ahead > 0 && ahead <= SNOOZE_MAX_DAYS * 86_400_000 ? due : null;
}

