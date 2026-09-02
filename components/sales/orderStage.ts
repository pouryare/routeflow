/** Which column of the pipeline board an order belongs in.
 *
 *  Phase 3 gave `orders.status` a 14-value machine (lib/orderStateMachine.ts). The board
 *  keeps its four human lanes -- پیش‌نویس / تأییدشده / در مسیر / تحویل‌شده -- and this maps
 *  the machine's states onto them. The detailed per-state view lives on the order page.
 */
import {
  ORDER_STATUS_LABEL,
  type OrderStatus,
} from "@/lib/orderStateMachine";

export type StageKey = "draft" | "confirmed" | "on_route" | "delivered";

export const STAGES: { key: StageKey; label: string; tone: string }[] = [
  { key: "draft", label: "پیش‌نویس", tone: "var(--text-faint)" },
  { key: "confirmed", label: "تأییدشده", tone: "var(--accent)" },
  { key: "on_route", label: "در مسیر", tone: "var(--info)" },
  { key: "delivered", label: "تحویل‌شده", tone: "var(--good)" },
];

const PRE_CONFIRM: ReadonlySet<string> = new Set([
  "DRAFT",
  "PENDING_REVIEW",
  "PENDING_CREDIT",
  "ON_HOLD",
]);
const PRICED_NOT_OUT: ReadonlySet<string> = new Set(["CONFIRMED", "PLANNED", "READY"]);
const FULFILLED: ReadonlySet<string> = new Set([
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "CLOSED",
  "RETURNED",
]);

/** The board lane for a status, or null for anything that does not belong on it
 *  (CANCELLED, and a failed attempt waiting to be retried or cancelled). `onRun` still
 *  splits a priced-but-not-yet-dispatched order from one already on a van. */
export function stageOf(status: string, onRun: boolean): StageKey | null {
  if (PRE_CONFIRM.has(status)) return "draft";
  if (status === "OUT_FOR_DELIVERY") return "on_route";
  if (PRICED_NOT_OUT.has(status)) return onRun ? "on_route" : "confirmed";
  if (FULFILLED.has(status)) return "delivered";
  return null; // CANCELLED, DELIVERY_FAILED
}

/** Whether a card may be dragged from one lane to another on this board.
 *
 *  Exactly one transition here is a sales-side write: submitting a draft (the board
 *  labels it «تأیید»). Everything else belongs to other surfaces (route desk, driver).
 */
export function moveRefusal(from: StageKey, to: StageKey): string | null {
  if (from === to) return null;
  if (from === "draft" && to === "confirmed") return null;
  if (to === "draft") return "سفارش تأییدشده به پیش‌نویس برنمی‌گردد.";
  if (to === "on_route") return "بارگیری از صفحهٔ «مسیر تحویل» ثبت می‌شود.";
  if (to === "delivered") return "تحویل و تسویه را راننده سر درِ مغازه ثبت می‌کند.";
  return "این جابه‌جایی از اینجا انجام نمی‌شود.";
}

export function allowedTargets(from: StageKey): StageKey[] {
  return STAGES.map((s) => s.key).filter((k) => moveRefusal(from, k) === null && k !== from);
}

/** A status with no invoice / receipt yet -- used to decide which document rows to show. */
export function isPreConfirm(status: string): boolean {
  return PRE_CONFIRM.has(status);
}

/** A status where the goods have reached (or came back from) the customer. */
export function isFulfilled(status: string): boolean {
  return FULFILLED.has(status);
}

export function statusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status as OrderStatus] ?? status;
}
