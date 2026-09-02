import type { DatabaseSync } from "node:sqlite";
import { makeRepo } from "./base";
import {
  orderTransition,
  legalOrderActions,
  type OrderStatus,
  type OrderAction,
  type OrderRole,
  type OrderEffect,
} from "@/lib/orderStateMachine";
import { reserveForOrder, releaseForOrder, consumeForOrder } from "./stock";
import { tryEmitEvent } from "./events";

/** A refusal the caller shows the user, not a bug. */
export class OrderError extends Error {}
/** The (from, action) pair is not a legal edge. `.legal` lists what the actor could do
 *  instead. Routes map this to 409. */
export class OrderTransitionError extends OrderError {
  legal: OrderAction[];
  constructor(message: string, legal: OrderAction[]) {
    super(message);
    this.legal = legal;
  }
}
/** The edge exists but this role may not fire it. Routes map this to 403. */
export class OrderRoleError extends OrderError {}

export interface OrderRow {
  id: number;
  organization_id: number;
  order_no: string;
  customer_id: number;
  group_id: number | null;
  salesperson_user_id: number | null;
  status: OrderStatus;
  order_type: string;
  priority: string;
  offline: number;
  order_date: string;
  delivered_at: string | null;
  payment_status: string;
  paid_toman: number;
  credit_override_by: number | null;
  credit_hold: number;
  notes: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export const ordersRepo = makeRepo<OrderRow>("orders", { tenant: true });

export interface OrderEventRow {
  id: number;
  organization_id: number;
  order_id: number;
  from_status: string | null;
  to_status: string;
  action: string;
  actor_user_id: number | null;
  reason_code_id: number | null;
  note: string | null;
  device_time: string | null;
  created_at: string;
}

export interface AdvanceOpts {
  reason_code_id?: number | null;
  note?: string | null;
  device_time?: string | null;
  /** Join the caller's open transaction instead of opening one. */
  db?: DatabaseSync;
}

/** Write one order_events row. Caller supplies an open connection. */
export function appendOrderEvent(
  conn: DatabaseSync,
  row: {
    organization_id: number;
    order_id: number;
    from_status: string | null;
    to_status: string;
    action: string;
    actor_user_id: number | null;
    reason_code_id?: number | null;
    note?: string | null;
    device_time?: string | null;
  }
): void {
  conn
    .prepare(
      `INSERT INTO order_events
         (organization_id, order_id, from_status, to_status, action, actor_user_id,
          reason_code_id, note, device_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.organization_id,
      row.order_id,
      row.from_status,
      row.to_status,
      row.action,
      row.actor_user_id,
      row.reason_code_id ?? null,
      row.note ?? null,
      row.device_time ?? null,
      new Date().toISOString()
    );
}

/** Hook points that Tasks 8 and 9 fill. Kept here so advanceOrder's effect switch has a
 *  single dispatch table and no forward import cycle. */
export interface EffectHandlers {
  createCreditApprovalTask?: (conn: DatabaseSync, orgId: number, orderId: number, actorId: number | null) => void;
  spawnBackorder?: (conn: DatabaseSync, orgId: number, orderId: number, actorId: number | null) => void;
}
const effectHandlers: EffectHandlers = {};
export function registerOrderEffectHandlers(h: EffectHandlers): void {
  Object.assign(effectHandlers, h);
}

function runEffect(
  effect: OrderEffect,
  conn: DatabaseSync,
  orgId: number,
  orderId: number,
  actorId: number | null
): void {
  switch (effect) {
    case "reserveStock":
      reserveForOrder(orgId, orderId, conn);
      return;
    case "releaseReservations":
      releaseForOrder(orgId, orderId, conn);
      return;
    case "consumeReservations":
      consumeForOrder(orgId, orderId, conn);
      return;
    case "clearCreditHold":
      conn
        .prepare("UPDATE orders SET credit_hold = 0 WHERE id = ? AND organization_id = ?")
        .run(orderId, orgId);
      return;
    case "stampDelivered":
      conn
        .prepare(
          "UPDATE orders SET delivered_at = COALESCE(delivered_at, ?) WHERE id = ? AND organization_id = ?"
        )
        .run(new Date().toISOString(), orderId, orgId);
      return;
    case "createCreditApprovalTask":
      effectHandlers.createCreditApprovalTask?.(conn, orgId, orderId, actorId);
      return;
    case "spawnBackorder":
      effectHandlers.spawnBackorder?.(conn, orgId, orderId, actorId);
      return;
  }
}

/** Move an order along the machine. Loads the order (tenant-scoped -> 404 on a miss or a
 *  cross-tenant id), checks the (from, action) edge exists (-> OrderTransitionError /
 *  409) and that the actor's role may fire it (-> OrderRoleError / 403), runs the
 *  transition's effects in order, updates orders.status and writes one order_events row.
 *  Returns the new status. Joins `opts.db` if given, else opens BEGIN IMMEDIATE. */
export function advanceOrder(
  organizationId: number,
  orderId: number,
  action: OrderAction,
  actor: { id: number | null; role: OrderRole },
  opts: AdvanceOpts = {}
): OrderStatus {
  const conn = opts.db ?? ordersRepo.db();

  const apply = (): OrderStatus => {
    const order = conn
      .prepare("SELECT id, status FROM orders WHERE id = ? AND organization_id = ?")
      .get(orderId, organizationId) as { id: number; status: OrderStatus } | undefined;
    if (!order) throw new OrderError("سفارش پیدا نشد");

    const from = order.status;
    const t = orderTransition(from, action);
    if (!t) {
      throw new OrderTransitionError(
        `از وضعیت «${from}» این کار انجام نمی‌شود`,
        legalOrderActions(from, actor.role)
      );
    }
    if (!t.roles.includes(actor.role)) {
      throw new OrderRoleError("نقش شما اجازهٔ این تغییر وضعیت را ندارد");
    }

    for (const effect of t.effects ?? []) {
      runEffect(effect, conn, organizationId, orderId, actor.id);
    }

    conn
      .prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ?")
      .run(t.to, new Date().toISOString(), orderId, organizationId);

    appendOrderEvent(conn, {
      organization_id: organizationId,
      order_id: orderId,
      from_status: from,
      to_status: t.to,
      action,
      actor_user_id: actor.role === "system" ? actor.id : actor.id,
      reason_code_id: opts.reason_code_id ?? null,
      note: opts.note ?? null,
      device_time: opts.device_time ?? null,
    });

    // Phase 7: mirror the transition onto the generic event bus so rules can listen.
    tryEmitEvent(
      organizationId,
      {
        kind: `order.${action}`,
        entity_type: "order",
        entity_id: orderId,
        actor_user_id: actor.id,
        metadata: { from, to: t.to },
      },
      conn
    );

    return t.to;
  };

  if (opts.db) return apply();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const to = apply();
    conn.exec("COMMIT");
    return to;
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

/** The order's transition history, oldest first, with the actor's display name. */
export function orderEvents(
  organizationId: number,
  orderId: number
): (OrderEventRow & { actor_name: string | null; reason_label: string | null })[] {
  return ordersRepo
    .db()
    .prepare(
      `SELECT e.*, u.display_name AS actor_name, rc.label_fa AS reason_label
         FROM order_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
         LEFT JOIN reason_codes rc ON rc.id = e.reason_code_id
        WHERE e.order_id = ? AND e.organization_id = ?
        ORDER BY e.id`
    )
    .all(orderId, organizationId) as unknown as (OrderEventRow & {
    actor_name: string | null;
    reason_label: string | null;
  })[];
}

/** What `role` could do to this order right now -- for rendering buttons. Empty if the
 *  order is missing or cross-tenant. */
export function legalActionsForOrder(
  organizationId: number,
  orderId: number,
  role: OrderRole
): OrderAction[] {
  const order = ordersRepo.get(organizationId, orderId);
  if (!order) return [];
  return legalOrderActions(order.status, role);
}
