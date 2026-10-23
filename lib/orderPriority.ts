/** F132: the order priority flag. `orders.priority` already existed and the route solver already
 *  weighs it (lib/repo/routing.ts: URGENT 100, KEY_ACCOUNT 60, NORMAL 10, FLEXIBLE 1), but nothing
 *  set it. A manager can now flip an order between NORMAL and URGENT; the other two values stay
 *  readable for orders that carry them.
 *
 *  Only managers and owners set it: if anyone could mark an order urgent, every order would be.
 *  It does not change commission: the urgent per-kilo rate in the commission tables is stored
 *  but nothing reads it yet. */

const SETTABLE_PRIORITIES = ["NORMAL", "URGENT"] as const;
export type SettablePriority = (typeof SETTABLE_PRIORITIES)[number];

const LABEL: Record<string, string> = {
  URGENT: "فوری",
  KEY_ACCOUNT: "مشتری کلیدی",
  NORMAL: "عادی",
  FLEXIBLE: "منعطف",
};

export function priorityLabel(priority: string | null | undefined): string {
  return LABEL[priority ?? "NORMAL"] ?? LABEL.NORMAL;
}

/** Whether the order should carry a visible tag: NORMAL and FLEXIBLE are the quiet default. */
export function priorityTagged(priority: string | null | undefined): boolean {
  return priority === "URGENT" || priority === "KEY_ACCOUNT";
}

export function isSettablePriority(v: unknown): v is SettablePriority {
  return typeof v === "string" && (SETTABLE_PRIORITIES as readonly string[]).includes(v);
}

/** No flag on an order that is finished: it would change nothing and read as a mistake. */
const CLOSED = new Set(["DELIVERED", "PARTIALLY_DELIVERED", "CLOSED", "CANCELLED", "RETURNED"]);
export function canSetPriority(status: string): boolean {
  return !CLOSED.has(status);
}
