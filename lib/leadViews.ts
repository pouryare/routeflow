/** View mode definitions for the همه مکان‌ها pool section.
 *
 *  Each view renders the same `visible` data from `useLeads()` in a different
 *  layout. The active mode persists to localStorage so the user's preference
 *  survives page reloads.
 */

import type { IconName } from "@/components/meridian/icon-map";

export type LeadViewMode =
  | "compact"
  | "pocket"
  | "grid"
  | "kanban"
  | "score"
  | "table"
  | "batch"
  | "cluster";

export interface LeadViewConfig {
  mode: LeadViewMode;
  label: string;
  icon: IconName;
  description: string;
}

/** All available pool view modes. Order determines toggle bar layout. */
export const LEAD_VIEWS: LeadViewConfig[] = [
  { mode: "compact", label: "مختصر", icon: "list", description: "دوره‌های فشرده برای مرور سریع" },
  { mode: "pocket", label: "جیبی", icon: "wallet", description: "کارت‌ها با کاغذ پشت آنها" },
  { mode: "grid", label: "شبکه‌ای", icon: "grid", description: "شبکه ۲-۳ ستونی" },
  { mode: "kanban", label: "کانبان", icon: "panel-side", description: "ستون‌ها بر اساس وضعیت" },
  { mode: "score", label: "امتیاز", icon: "star", description: "نمایش امتیازات بالقوه/حجم/راحتی" },
  { mode: "table", label: "جدول", icon: "file", description: "ستون‌های مرتب‌سازی‌پذیر" },
  { mode: "batch", label: "گروهی", icon: "check", description: "با تیک‌برگری برای تقسیم روز" },
  { mode: "cluster", label: "منطقه‌ای", icon: "map-pin", description: "گروه‌بندی بر اساس منطقه" },
];

const STORAGE_KEY = "coverage_lead_view";

/** Read the stored view mode; returns "compact" if missing or invalid. */
export function readViewMode(): LeadViewMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && LEAD_VIEWS.some((v) => v.mode === raw)) return raw as LeadViewMode;
  } catch { /* localStorage unavailable */ }
  return "compact";
}

/** Persist the chosen view mode to localStorage. */
export function saveViewMode(mode: LeadViewMode): void {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* silent */ }
}

export { STORAGE_KEY };

/** The list views draw this many leads, then more on a tap: 200 leads were 12,400 elements, and a
 *  cheap phone stuttered scrolling them. */
export const LEADS_SHOWN_STEP = 30;

/** How many leads a view draws. The grouped views (kanban, score, cluster) need every lead to place
 *  each in its group. A lead opened from the map or a link (`linkedAt`, -1 for none) is always drawn,
 *  however far down the list it sits. */
export function leadsDrawn(mode: LeadViewMode, total: number, shown: number, linkedAt: number): number {
  if (mode === "kanban" || mode === "score" || mode === "cluster") return total;
  return Math.min(total, Math.max(shown, linkedAt + 1));
}
