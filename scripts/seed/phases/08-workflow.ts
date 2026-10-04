/** Tasks on the board, and the queues each role lands on.
 *
 *  `createTask(organizationId, input)` opens no transaction and derives `stage` from `kind`
 *  when none is given. Kinds are the app's own vocabulary (lib/tasks/labels.ts), so the board
 *  filters read correctly: an unknown kind gives no stage and no workflow pipeline, and the
 *  workflow lens quietly falls back to status lanes (lib/tasks/lenses.ts:79).
 */

import { createTask } from "@/lib/repo/tasks";
import type { TaskKind } from "@/lib/tasks/labels";
import type { SeedContext } from "../context";

/* Real kinds, from the app's own vocabulary.
 *
 * This list used to be ["collection","complaint","delivery","sales","admin"] — four of which
 * are not kinds this app has. The header comment above promised "the app's own vocabulary
 * (lib/tasks/labels.ts) so the board filters read correctly"; the code did the opposite, and
 * every one of those titles printed its own raw identifier to a Persian reader
 * («collection: پیگیری سفارش») while taskKindLabel fell through to the generic «کار».
 *
 * `satisfies` rather than a bare `as const`: a kind that does not exist is a COMPILE error
 * here, which is the only remaining place this mistake can be made. */
const KINDS = [
  "call", "delivery_retry", "quote_followup", "sample_followup", "outreach", "visit", "reminder",
] as const satisfies readonly TaskKind[];

/** One title per kind. Deriving it from the kind label gave «پیگیری قیمت: پیگیری سفارش» —
 *  the same word twice — because the old title was itself a fixed phrase. */
const TITLE: Record<(typeof KINDS)[number], string> = {
  call: "تماس برای پیگیری سفارش",
  delivery_retry: "پیگیری تحویل انجام‌نشده",
  quote_followup: "پیگیری قیمت",
  sample_followup: "پیگیری نمونه",
  outreach: "پیگیری مشتری",
  visit: "بازدید مشتری",
  reminder: "یادآوری پیگیری",
};

export function run(ctx: SeedContext): void {
  const { db, rng } = ctx;
  const owner = ctx.staff.owner;

  const assignees = (db
    .prepare(
      `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.organization_id = ? AND u.active = 1 AND ur.role IN ('field_rep','sales_manager')
        GROUP BY u.id`,
    )
    .all(ctx.orgId) as Array<{ id: number }>).map((r) => r.id);

  /* Recent orders to hang tasks off, so a task links to a real entity rather than a dangling
     id. Old orders are excluded — an overdue task on a 2-year-old order is noise. */
  const recentOrders = db
    .prepare(
      `SELECT id, customer_id, status FROM orders
        WHERE organization_id = ? AND order_date >= ?
        ORDER BY order_date DESC LIMIT 200`,
    )
    .all(ctx.orgId, ctx.iso(45)) as Array<{ id: number; customer_id: number; status: string }>;

  const customers = ctx.ids.customerIds ?? [];
  const count = Math.max(12, Math.round(ctx.scale.customers * 0.4));
  let made = 0;

  for (let i = 0; i < count; i++) {
    const kind = rng.pick(KINDS);
    const useOrder = rng.chance(0.7) && recentOrders.length > 0;
    const order = useOrder ? rng.pick(recentOrders) : null;
    /* Both branches need an entity id, and `order` is nullable — so the fallback is computed
       separately rather than through `order?.customer_id`, which TS narrows to `never` once
       `order` has been proven null inside the else. */
    const customerId = order ? order.customer_id : (customers.length > 0 ? rng.pick(customers) : 0);
    try {
      createTask(ctx.orgId, {
        title: TITLE[kind],
        kind,
        assignee_user_id: assignees.length > 0 ? rng.pick(assignees) : null,
        /* Overdue on purpose for a slice of them — /board's overdue lens is otherwise empty. */
        due_at: rng.chance(0.3) ? ctx.stamp(-rng.int(1, 14)) : ctx.stamp(rng.int(0, 10)),
        entity_type: order ? "order" : "customer",
        entity_id: order ? order.id : customerId,
        created_by: owner,
      });
      made++;
    } catch {
      /* A refused task must not take the build down. */
    }
  }

  ctx.progress(`${made} tasks across ${assignees.length} assignees`);
}
