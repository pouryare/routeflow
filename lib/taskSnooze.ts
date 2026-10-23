import { resolveDue } from "@/lib/crm/due";

/** F142: «remind me later» on a task or reminder, by moving its due time.
 *
 *  Only normal and low priority work can be put off: a critical or high item is the thing that
 *  must not be easy to ignore. And at most three times, so nothing is pushed off for ever; after
 *  that the choice is to do it or remove it. */

export type SnoozeChoice = "hour" | "tomorrow";

export const SNOOZE_CHOICES: { id: SnoozeChoice; label: string }[] = [
  { id: "hour", label: "یک ساعت دیگر" },
  { id: "tomorrow", label: "فردا ساعت ۹" },
];

export const MAX_SNOOZES = 3;

export function isSnoozeChoice(v: unknown): v is SnoozeChoice {
  return v === "hour" || v === "tomorrow";
}

export function canSnooze(t: { priority: string; snooze_count: number; status?: string }): boolean {
  if (t.status !== undefined && t.status !== "open") return false;
  return (t.priority === "NORMAL" || t.priority === "LOW") && t.snooze_count < MAX_SNOOZES;
}

/** The new due time: an hour from now, or 09:00 Tehran tomorrow. */
export function snoozedDue(choice: SnoozeChoice, nowIso: string): string {
  return choice === "hour"
    ? (resolveDue({ kind: "in_hours", hours: 1 }, nowIso) as string)
    : (resolveDue({ kind: "tomorrow", hour: 9 }, nowIso) as string);
}
