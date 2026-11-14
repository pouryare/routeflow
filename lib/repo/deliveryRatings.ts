import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";
import { FULFILLED_ORDER_STATUSES } from "@/lib/orderStateMachine";
import { isLowRating, ratingProblem } from "@/lib/deliveryRating";
import { createTask } from "./tasks";

export interface RatingRow { stars: number; reason: string | null; rated_at: string; rated_by_name: string | null }

export async function ratingOf(orgId: number, orderId: number): Promise<RatingRow | null> {
  const r = (await getDb()
    .prepare("SELECT r.stars, r.reason, r.rated_at, u.display_name AS rated_by_name FROM delivery_ratings r LEFT JOIN users u ON u.id = r.rated_by WHERE r.organization_id = ? AND r.order_id = ?")
    .get(orgId, orderId)) as RatingRow | undefined;
  return r ? { ...r, stars: Number(r.stars) } : null;
}

/** Saves the rating of a delivered order (a second one replaces the first). A low rating makes one follow-up call task for the
 *  customer's owner the first time only. Returns the problem in words, or null once saved. */
export async function rateDelivery(orgId: number, orderId: number, by: number, input: { stars?: unknown; reason?: unknown }): Promise<string | null> {
  const problem = ratingProblem({ stars: input.stars, reason: input.reason ?? null });
  if (problem) return problem;
  const stars = input.stars as number;
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : null;
  const db = getDb();
  const o = (await db
    .prepare("SELECT o.id, o.order_no, o.status, o.customer_id, c.owner_user_id, c.group_id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ? AND o.organization_id = ?")
    .get(orderId, orgId)) as { id: number; order_no: string; status: string; customer_id: number; owner_user_id: number | null; group_id: number | null } | undefined;
  if (!o) return "سفارش پیدا نشد";
  if (!(FULFILLED_ORDER_STATUSES as readonly string[]).includes(o.status)) return "فقط سفارش تحویل‌شده امتیاز می‌گیرد";
  const before = await ratingOf(orgId, orderId);
  await db
    .prepare(
      `INSERT INTO delivery_ratings (organization_id, order_id, customer_id, stars, reason, rated_by, rated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (order_id) DO UPDATE SET stars = EXCLUDED.stars, reason = EXCLUDED.reason, rated_by = EXCLUDED.rated_by, rated_at = EXCLUDED.rated_at`,
    )
    .run(orgId, orderId, o.customer_id, stars, reason, by, new Date().toISOString());
  if (isLowRating(stars) && !(before && isLowRating(before.stars))) {
    await createTask(orgId, {
      title: `تماس پیگیری: مشتری از تحویل سفارش ${o.order_no} راضی نبود${reason ? ` (${reason})` : ""}`,
      kind: "call",
      assignee_user_id: o.owner_user_id ?? by,
      group_id: o.group_id,
      entity_type: "customer",
      entity_id: o.customer_id,
      due_at: `${tehranTodayIso()}T12:00:00.000Z`,
      priority: "HIGH",
      created_by: by,
    });
  }
  return null;
}
