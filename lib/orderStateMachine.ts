/** The lifecycle of an order, as one explicit transition table.
 *
 *  `orders.status` used to have four values advanced by `UPDATE orders SET status = …`
 *  scattered across five files. This replaces that: every legal move is a row below, and
 *  everything else -- which buttons a role sees, which API calls exist, what the audit
 *  trail records, which side-effects fire -- is derived from it. An illegal move is a
 *  409 with the legal options listed, never a silent no-op.
 *
 *  `roles` lists who may fire a transition. `"system"` in the list means an internal
 *  caller (an effect, a migration, `recordDelivery`) is allowed to fire it while passing
 *  `role: "system"`; a real user still needs their own role named. `effects` run in
 *  order inside the caller's transaction.
 *
 *  Pure module -- no `lib/db` / `lib/repo` import, so it unit-tests in isolation and is
 *  safe to pull into anything.
 */

export type OrderStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "PENDING_CREDIT"
  | "ON_HOLD"
  | "CONFIRMED"
  | "PLANNED"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "PARTIALLY_DELIVERED"
  | "DELIVERY_FAILED"
  | "CLOSED"
  | "CANCELLED"
  | "RETURNED";

export type OrderAction =
  | "submit"
  | "passReview"
  | "flagCredit"
  | "approveCredit"
  | "rejectCredit"
  | "releaseHold"
  | "plan"
  | "unplan"
  | "freeze"
  | "startRoute"
  | "deliver"
  | "deliverPartial"
  | "failDelivery"
  | "retryDelivery"
  | "settle"
  | "cancel"
  | "returnOrder";

export type OrderRole = "phone_sales" | "group_manager" | "owner"
                     | "field_rep" | "delivery_driver" | "system";

/** Side-effects a transition may carry. Each is a named handler in lib/repo/orders.ts,
 *  run in listed order inside the caller's transaction. */
export type OrderEffect =
  | "reserveStock"
  | "releaseReservations"
  | "consumeReservations"
  | "createCreditApprovalTask"
  | "clearCreditHold"
  | "spawnBackorder"
  | "stampDelivered"
  /** A customer who would not take the goods owes nothing for them.
   *
   *  `RETURNED` has been a status since the machine was drawn -- in ORDER_STATUSES, in
   *  TERMINAL_ORDER_STATUSES, and treated as terminal by syncMutations -- with NO writer
   *  anywhere. So an order could reach it by nothing at all.
   *
   *  What it means: the driver offered a replacement for damaged or expired goods and the
   *  customer refused that too. The goods came back on the van, and the customer's liability
   *  for the undelivered portion ends here. Without this effect the order sits in a terminal
   *  state still carrying the full amount as owed. */
  | "stampReturned";

export interface OrderTransition {
  from: OrderStatus;
  action: OrderAction;
  to: OrderStatus;
  roles: OrderRole[];
  effects?: OrderEffect[];
}

/** One row per legal edge. Anything not here is illegal. */
export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  { from: "DRAFT", action: "submit", to: "PENDING_REVIEW", roles: ["phone_sales", "group_manager", "owner", "system"] },
  { from: "DRAFT", action: "cancel", to: "CANCELLED", roles: ["phone_sales", "group_manager", "owner"], effects: ["releaseReservations"] },

  { from: "PENDING_REVIEW", action: "passReview", to: "CONFIRMED", roles: ["group_manager", "owner", "system"], effects: ["reserveStock"] },
  { from: "PENDING_REVIEW", action: "flagCredit", to: "PENDING_CREDIT", roles: ["system"], effects: ["createCreditApprovalTask"] },
  { from: "PENDING_REVIEW", action: "cancel", to: "CANCELLED", roles: ["group_manager", "owner"], effects: ["releaseReservations"] },

  { from: "PENDING_CREDIT", action: "approveCredit", to: "CONFIRMED", roles: ["group_manager", "owner"], effects: ["clearCreditHold", "reserveStock"] },
  { from: "PENDING_CREDIT", action: "rejectCredit", to: "ON_HOLD", roles: ["group_manager", "owner"] },
  { from: "PENDING_CREDIT", action: "cancel", to: "CANCELLED", roles: ["group_manager", "owner"], effects: ["releaseReservations"] },

  { from: "ON_HOLD", action: "releaseHold", to: "CONFIRMED", roles: ["group_manager", "owner"], effects: ["clearCreditHold", "reserveStock"] },
  { from: "ON_HOLD", action: "cancel", to: "CANCELLED", roles: ["group_manager", "owner"], effects: ["releaseReservations"] },

  { from: "CONFIRMED", action: "plan", to: "PLANNED", roles: ["group_manager", "owner", "system"] },
  { from: "CONFIRMED", action: "cancel", to: "CANCELLED", roles: ["group_manager", "owner"], effects: ["releaseReservations"] },

  { from: "PLANNED", action: "unplan", to: "CONFIRMED", roles: ["group_manager", "owner", "system"] },
  { from: "PLANNED", action: "freeze", to: "READY", roles: ["group_manager", "owner", "system"] },

  { from: "READY", action: "startRoute", to: "OUT_FOR_DELIVERY", roles: ["delivery_driver", "group_manager", "owner", "system"] },
  { from: "READY", action: "unplan", to: "CONFIRMED", roles: ["group_manager", "owner"] },

  { from: "OUT_FOR_DELIVERY", action: "deliver", to: "DELIVERED", roles: ["delivery_driver", "system"], effects: ["consumeReservations", "stampDelivered"] },
  { from: "OUT_FOR_DELIVERY", action: "deliverPartial", to: "PARTIALLY_DELIVERED", roles: ["delivery_driver", "system"], effects: ["consumeReservations", "stampDelivered"] },
  /* The door, twice refused. The driver offered fresh goods for damaged or expired ones and
   * the customer would not take those either, so nothing of this order was handed over.
   *
   * Named `returnOrder` rather than a new action, because that action ALREADY exists and
   * already leads to RETURNED from DELIVERED and PARTIALLY_DELIVERED for a manager. Two
   * actions meaning "the goods came back" would be two vocabularies for one event -- the
   * same mistake this whole plan exists to undo.
   *
   * `consumeReservations` because the goods DID physically move -- out of the van, back onto
   * it -- and reservations are consumed by movement, not by receipt. Omitting it would leave
   * stock reserved against goods now sitting in a warehouse.
   *
   * Terminal, so the same goods are never offered to the same customer again by retrying. */
  { from: "OUT_FOR_DELIVERY", action: "returnOrder", to: "RETURNED", roles: ["delivery_driver", "system"], effects: ["consumeReservations", "stampReturned"] },
  { from: "OUT_FOR_DELIVERY", action: "failDelivery", to: "DELIVERY_FAILED", roles: ["delivery_driver", "system"], effects: ["releaseReservations"] },

  { from: "DELIVERY_FAILED", action: "retryDelivery", to: "PLANNED", roles: ["group_manager", "owner", "system"] },
  { from: "DELIVERY_FAILED", action: "cancel", to: "CANCELLED", roles: ["group_manager", "owner"], effects: ["releaseReservations"] },

  { from: "DELIVERED", action: "settle", to: "CLOSED", roles: ["system", "group_manager", "owner"] },
  { from: "DELIVERED", action: "returnOrder", to: "RETURNED", roles: ["group_manager", "owner"] },

  { from: "PARTIALLY_DELIVERED", action: "settle", to: "CLOSED", roles: ["system", "group_manager", "owner"], effects: ["spawnBackorder"] },
  { from: "PARTIALLY_DELIVERED", action: "returnOrder", to: "RETURNED", roles: ["group_manager", "owner"] },
] as const;

/** The transition for a (from, action) pair, or undefined if the move is illegal. */
export function orderTransition(
  from: OrderStatus,
  action: OrderAction
): OrderTransition | undefined {
  return ORDER_TRANSITIONS.find((t) => t.from === from && t.action === action);
}

/** Every action legal from `from` for `role`. `role` "system" sees every internal edge.
 *
 *  `role` is a single role OR the full set a person holds, because a delivery driver whose
 *  ACTIVE role is field_rep must still be able to deliver: reading only the active role
 *  refuses them at the last step, in a van, by the guard meant to protect them. A set is
 *  read as a UNION — "holds any of these" — because the intersection would refuse
 *  everything the person can legitimately do.
 *
 *  The union type is what keeps the ~139 existing `canAdvanceOrder(from, action, actor.role)`
 *  call sites compiling and correct without edit. */
/** platform_owner is a strict superset of owner (lib/roles.ts), but the transition table names
 *  only the owner, so the platform's own key was refused every transition an owner may fire.
 *  Held as a role set it also counts as `owner`. */
function withPlatformOwner(held: readonly string[]): readonly string[] {
  return held.includes("platform_owner") && !held.includes("owner") ? [...held, "owner"] : held;
}

export function legalOrderActions(
  from: OrderStatus,
  role: OrderRole | readonly OrderRole[]
): OrderAction[] {
  const held = withPlatformOwner((Array.isArray(role) ? role : [role]) as readonly string[]);
  return ORDER_TRANSITIONS.filter(
    (t) => t.from === from && t.roles.some((r) => held.includes(r))
  ).map((t) => t.action);
}

/** Whether `role` may fire `action` from `from`. Distinguishes "no such edge" (handled by
 *  the caller as 409) from "edge exists, wrong role" -- this returns false for both, so
 *  callers that need the distinction check `orderTransition` first.
 *
 *  An EMPTY set is refused everything. It is not a wildcard, and a session with no roles
 *  must not be handed the whole state machine. */
export function canAdvanceOrder(
  from: OrderStatus,
  action: OrderAction,
  role: OrderRole | readonly OrderRole[]
): boolean {
  const t = orderTransition(from, action);
  if (!t) return false;
  const held = withPlatformOwner((Array.isArray(role) ? role : [role]) as readonly string[]);
  return t.roles.some((r) => held.includes(r));
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: "پیش‌نویس",
  PENDING_REVIEW: "در انتظار بررسی",
  PENDING_CREDIT: "در انتظار تأیید اعتبار",
  ON_HOLD: "متوقف",
  CONFIRMED: "تأییدشده",
  PLANNED: "برنامه‌ریزی‌شده",
  READY: "آمادهٔ ارسال",
  OUT_FOR_DELIVERY: "در مسیر",
  DELIVERED: "تحویل‌شده",
  PARTIALLY_DELIVERED: "تحویل ناقص",
  DELIVERY_FAILED: "تحویل ناموفق",
  CLOSED: "بسته‌شده",
  CANCELLED: "لغوشده",
  RETURNED: "مرجوعی",
};

/** What an order's `payment_status` is called. There were three copies (the journey page,
 *  the processing modal and the Excel export) and they disagreed: «بخشی» against
 *  «بخشی پرداخت‌شده», «پرداخت‌شده» against «تسویه‌شده». One map, the whole CHECK union. */
export type PaymentStatus = "unpaid" | "partial" | "paid";
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "پرداخت‌نشده",
  partial: "بخشی پرداخت‌شده",
  paid: "تسویه‌شده",
};

/** Colour role names from MASTER.md -- callers map to CSS vars. */
export const ORDER_STATUS_TONE: Record<OrderStatus, "good" | "warn" | "crit" | "info" | "faint"> = {
  DRAFT: "faint",
  PENDING_REVIEW: "info",
  PENDING_CREDIT: "crit",
  ON_HOLD: "crit",
  CONFIRMED: "info",
  PLANNED: "info",
  READY: "info",
  OUT_FOR_DELIVERY: "warn",
  DELIVERED: "good",
  PARTIALLY_DELIVERED: "warn",
  DELIVERY_FAILED: "crit",
  CLOSED: "good",
  CANCELLED: "faint",
  RETURNED: "warn",
};

/** Nothing moves out of these. */
export const TERMINAL_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "CLOSED",
  "CANCELLED",
  "RETURNED",
]);

export function isTerminalOrderStatus(s: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.has(s);
}

/** All 14 statuses, for schema checks and iteration. */
export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];

/** Goods have reached the customer, fully or partly -- what commission, customer debt
 *  and delivered-weight reports count. RETURNED is excluded: the goods came back. */
export const FULFILLED_ORDER_STATUSES: readonly OrderStatus[] = [
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "CLOSED",
];

/** Prices are locked -- the order is confirmed or further along. Excludes every
 *  pre-confirm state and the terminal CANCELLED / RETURNED. */
export const PRICED_ORDER_STATUSES: readonly OrderStatus[] = [
  "CONFIRMED",
  "PLANNED",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "DELIVERY_FAILED",
  "CLOSED",
];

/** `'A', 'B', 'C'` -- the body of an SQL `IN (…)` list. Values are the fixed identifiers
 *  above, never user input. */
export function sqlStatusList(statuses: readonly string[]): string {
  return statuses.map((s) => `'${s}'`).join(", ");
}
