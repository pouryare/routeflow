/* Handover (F59): one person's customers and open tasks go to a colleague, with the history kept.
 * For the day someone leaves, falls ill or changes job: the work does not have to be moved one record at a time.
 * Each customer gets the «تغییر مسئول» line on its timeline (F100, lib/repo/crm/ownerChange.ts); orders, payments
 * and commission stay with the person who made them. */
import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { canSell, isOwner } from "@/lib/roles";
import { emitEvent } from "@/lib/repo/events";
import { recordOwnerChange } from "@/lib/repo/crm/ownerChange";

export class HandoverError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface HandoverCounts {
  customers: number;
  tasks: number;
}

async function userIn(organizationId: number, id: number) {
  return (await getDb().prepare("SELECT id, role, active FROM users WHERE id = ? AND organization_id = ?").get(id, organizationId)) as
    | { id: number; role: string; active: number }
    | undefined;
}

async function count(organizationId: number, fromId: number): Promise<HandoverCounts> {
  const db = getDb();
  const n = async (sql: string) => Number(((await db.prepare(sql).get(fromId, organizationId)) as { n: number }).n);
  return {
    customers: await n("SELECT COUNT(*) AS n FROM customers WHERE owner_user_id = ? AND organization_id = ?"),
    tasks: await n("SELECT COUNT(*) AS n FROM tasks WHERE assignee_user_id = ? AND organization_id = ? AND status = 'open'"),
  };
}

/** How much would move, so the owner sees the size before confirming. */
export async function previewHandover(s: Session, fromId: number): Promise<HandoverCounts> {
  if (!isOwner(s.role)) throw new HandoverError("فقط مالک کارها را واگذار می‌کند", 403);
  if (!(await userIn(s.organizationId, fromId))) throw new HandoverError("کاربر پیدا نشد", 404);
  return count(s.organizationId, fromId);
}

export async function handOver(s: Session, fromId: number, toId: number): Promise<HandoverCounts> {
  if (!isOwner(s.role)) throw new HandoverError("فقط مالک کارها را واگذار می‌کند", 403);
  if (fromId === toId) throw new HandoverError("گیرنده باید کس دیگری باشد");
  const [from, to] = [await userIn(s.organizationId, fromId), await userIn(s.organizationId, toId)];
  if (!from || !to) throw new HandoverError("کاربر پیدا نشد", 404);
  if (!Number(to.active) || !canSell(to.role)) throw new HandoverError("گیرنده باید همکار فعالی باشد که می‌تواند مشتری داشته باشد");

  const db = getDb();
  const org = s.organizationId;
  return await db.tx(async () => {
    const owned = (await db.prepare("SELECT id FROM customers WHERE owner_user_id = ? AND organization_id = ?").all(fromId, org)) as unknown as { id: number }[];
    await db.prepare("UPDATE customers SET owner_user_id = ? WHERE owner_user_id = ? AND organization_id = ?").run(toId, fromId, org);
    for (const c of owned) {
      await recordOwnerChange(db, { organizationId: org, customerId: c.id, actorUserId: s.user.id, reason: "handover", what: "owner", fromId, toId });
    }
    const tasks = Number((await db.prepare("UPDATE tasks SET assignee_user_id = ? WHERE assignee_user_id = ? AND organization_id = ? AND status = 'open'").run(toId, fromId, org)).changes);
    await emitEvent(org, { kind: "records.handed_over", entity_type: "user", entity_id: toId, actor_user_id: s.user.id, metadata: { from_user_id: fromId, customers: owned.length, tasks } }, db);
    return { customers: owned.length, tasks };
  });
}
