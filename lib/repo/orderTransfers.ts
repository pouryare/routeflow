import { getDb } from "@/lib/db";
import { canReachGroup, scopeGroupIds, type Session } from "@/lib/session";

export interface OrderTransfer {
  id: number;
  order_id: number;
  order_no: string;
  from_group: string;
  to_group: string;
  from_group_id: number;
  to_group_id: number;
  status: "pending" | "accepted" | "refused";
  requested_at: string;
  decided_at: string | null;
}

/** F96: a group manager asks another group to fulfil a confirmed order (not yet on a route). Returns the problem in words, or null once asked. */
export async function requestTransfer(session: Session, orderId: number, toGroupId: number): Promise<string | null> {
  const db = getDb();
  const org = session.organizationId;
  const o = (await db.prepare("SELECT group_id, status FROM orders WHERE id = ? AND organization_id = ?").get(orderId, org)) as { group_id: number | null; status: string } | undefined;
  if (!o || o.group_id === null || !(await canReachGroup(session, o.group_id))) return "سفارش پیدا نشد";
  if (o.status !== "CONFIRMED") return "فقط سفارش تأییدشدهٔ بدون مسیر را می‌شود به گروه دیگر داد";
  if (Number(o.group_id) === toGroupId) return "این سفارش همین حالا در همین گروه است";
  if (!(await db.prepare("SELECT 1 FROM groups WHERE id = ? AND organization_id = ?").get(toGroupId, org))) return "گروه پیدا نشد";
  if (await db.prepare("SELECT 1 FROM order_transfers WHERE order_id = ? AND status = 'pending'").get(orderId)) return "برای این سفارش درخواست باز وجود دارد";
  await db.prepare("INSERT INTO order_transfers (organization_id, order_id, from_group_id, to_group_id, requested_by, requested_at) VALUES (?, ?, ?, ?, ?, ?)").run(org, orderId, o.group_id, toGroupId, session.user.id, new Date().toISOString());
  return null;
}

/** Every request this person's groups sent or received, open ones first. Only names and numbers: the receiving group learns nothing about the customer's history. */
export async function listTransfers(session: Session): Promise<OrderTransfer[]> {
  const scope = await scopeGroupIds(session);
  const ids = scope === "all" ? null : scope;
  if (ids !== null && ids.length === 0) return [];
  const mark = ids === null ? "" : ` AND (t.from_group_id IN (${ids.map(() => "?").join(",")}) OR t.to_group_id IN (${ids.map(() => "?").join(",")}))`;
  const rows = (await getDb()
    .prepare(
      `SELECT t.id, t.order_id, o.order_no, gf.name AS from_group, gt.name AS to_group, t.from_group_id, t.to_group_id, t.status, t.requested_at, t.decided_at
         FROM order_transfers t JOIN orders o ON o.id = t.order_id JOIN groups gf ON gf.id = t.from_group_id JOIN groups gt ON gt.id = t.to_group_id
        WHERE t.organization_id = ?${mark}
        ORDER BY (t.status = 'pending') DESC, t.id DESC LIMIT 30`
    )
    .all(session.organizationId, ...(ids === null ? [] : [...ids, ...ids]))) as unknown as OrderTransfer[];
  return rows.map((r) => ({ ...r, id: Number(r.id), order_id: Number(r.order_id), from_group_id: Number(r.from_group_id), to_group_id: Number(r.to_group_id) }));
}

/** The receiving group's manager accepts (the order moves to their group, so their planner picks it up) or refuses. */
export async function decideTransfer(session: Session, id: number, accept: boolean): Promise<string | null> {
  const db = getDb();
  const org = session.organizationId;
  const t = (await db.prepare("SELECT order_id, to_group_id, status FROM order_transfers WHERE id = ? AND organization_id = ?").get(id, org)) as { order_id: number; to_group_id: number; status: string } | undefined;
  if (!t || !(await canReachGroup(session, Number(t.to_group_id)))) return "درخواست پیدا نشد";
  if (t.status !== "pending") return "این درخواست قبلاً جواب داده شده";
  if (accept) {
    const moved = await db.prepare("UPDATE orders SET group_id = ? WHERE id = ? AND organization_id = ? AND status = 'CONFIRMED'").run(t.to_group_id, t.order_id, org);
    if (Number(moved.changes ?? 0) === 0) return "سفارش دیگر در حالت تأییدشده نیست";
  }
  await db.prepare("UPDATE order_transfers SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND organization_id = ?").run(accept ? "accepted" : "refused", session.user.id, new Date().toISOString(), id, org);
  return null;
}
