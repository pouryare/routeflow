/** View modes for the free-order pool on ?view=runs.
 *
 *  SIX, not the eight /leads has. Two of those eight are about LEADS, and an order has
 *  neither of the things they are built from:
 *
 *    کانبان's columns are built from lead STATUS (new / called / visited / …). Every
 *    confirmed order awaiting a van shares one status, so the board would be a single
 *    column that looks like a bug.
 *
 *    امتیاز ranks lead POTENTIAL, volume and ease of approach. A confirmed order has
 *    already been sold; there is nothing left to score.
 *
 *  Both were dropped rather than quietly re-labelled, because a view called امتیاز that
 *  silently sorts by weight is worse than no view at all -- the name is the promise.
 *
 *  Two of the six are BETTER here than on /leads: جیبی (orders really do have receipts and
 *  invoices behind the card) and گروهی (tick-boxes for splitting across days is literally
 *  this page's job). */

export type OrderViewMode =
  | "compact"
  | "pocket"
  | "grid"
  | "table"
  | "batch"
  | "cluster";

export interface OrderViewConfig {
  mode: OrderViewMode;
  label: string;
  icon: string;
  description: string;
}

/** Order determines the toggle bar's layout. */
export const ORDER_VIEWS: OrderViewConfig[] = [
  { mode: "compact", label: "مختصر", icon: "list", description: "دوره‌های فشرده برای مرور سریع" },
  { mode: "pocket", label: "جیبی", icon: "wallet", description: "کارت‌ها با فاکتور پشت آنها" },
  { mode: "grid", label: "شبکه‌ای", icon: "grid", description: "شبکه ۲-۳ ستونی" },
  { mode: "table", label: "جدول", icon: "file", description: "ستون‌های مرتب‌سازی‌پذیر" },
  { mode: "batch", label: "گروهی", icon: "check", description: "با تیک برای تقسیم روی روزها" },
  { mode: "cluster", label: "منطقه‌ای", icon: "map-pin", description: "گروه‌بندی بر اساس منطقه" },
];

/* Its OWN key. Deliberately not `coverage_lead_view`, which is what /leads uses: sharing it
 * would mean choosing «جدول» here also switched /leads to table -- a small bug that would be
 * blamed on something else entirely, because neither page would be doing anything wrong. */
const STORAGE_KEY = "coverage_order_view";

export function readOrderView(): OrderViewMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && ORDER_VIEWS.some((v) => v.mode === raw)) return raw as OrderViewMode;
  } catch {
    /* localStorage unavailable */
  }
  return "compact";
}

export function saveOrderView(mode: OrderViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* silent */
  }
}

export { STORAGE_KEY as ORDER_VIEW_STORAGE_KEY };