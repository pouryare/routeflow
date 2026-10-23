/** F16: the owner's morning digest, one message a day through the push and Telegram channels
 *  the notification flush already drives. Built from the owner's own briefing panels, so the
 *  message and the screen it points to say the same thing. */
import type { BriefingPanel } from "@/lib/repo/briefing";
import { faNum } from "@/lib/format";

/** Tehran wall-clock time from which the day's digest may go out. Before it, the sweep skips. */
export const DIGEST_FROM = "07:00";

export const DIGEST_TITLE = "خلاصهٔ صبح";

/** One line per panel with work in it, «سفارش‌های بی‌مسیر: ۴», and the week's line after. */
export function digestBody(panels: BriefingPanel[], weekLine: string | null): string {
  const lines = panels.map((p) => `${p.title}: ${faNum(p.items.length + (p.more ?? 0))}`);
  if (lines.length === 0) lines.push("امروز کاری منتظر شما نیست.");
  if (weekLine) lines.push(weekLine);
  return lines.join(" · ");
}
