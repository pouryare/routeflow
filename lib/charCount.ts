import { faDigits } from "@/lib/format";

/** The letter counter on a text box with a limit (owner, 2026-11-05: a ring plus «۶۲/۷۰»).
 *  `share` fills the ring (0 to 1, more when over); `over` turns it red. Pure, so it is tested. */
export function charCount(text: string, max: number): { share: number; over: boolean; label: string } {
  const n = Array.from(text).length; // letters, not UTF-16 units
  return { share: max > 0 ? n / max : 1, over: n > max, label: `${faDigits(String(n))}/${faDigits(String(max))}` };
}

/** A task's title (tasks.title, ck_tasks_title in the input-checks migration). */
export const TASK_TITLE_MAX = 200;
