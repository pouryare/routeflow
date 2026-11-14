/* Handover (F59): one person's customers and open tasks go to a colleague, with the history kept.
 * For the day someone leaves, falls ill or changes job: the work does not have to be moved one record at a time.
 * Each customer gets the «تغییر مسئول» line on its timeline (F100, lib/repo/crm/ownerChange.ts); orders, payments
 * and commission stay with the person who made them. */
import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { canSell, isOwner } from "@/lib/roles";
import { emitEvent } from "@/lib/repo/events";
import { recordOwnerChange } from "@/lib/repo/crm/ownerChange";
import { tehranTodayIso } from "@/lib/jalali";

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

/* ---- Lending (T13): the customers go to a colleague for N days and come back by themselves ---- */

export interface Loan {
  id: number;
  customer_id: number;
  customer_name: string;
  from_name: string;
  to_name: string;
  until: string;
}

function lastDay(days: number, today = tehranTodayIso()): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

/** Lends all of one person's customers for `days` days (1 to 90). Open tasks stay with their owner.
 *  shortcut: customers only, whole portfolio at once; pick-by-customer lending is for when a manager asks. */
export async function lend(s: Session, fromId: number, toId: number, days: number): Promise<{ customers: number; until: string }> {
  if (!isOwner(s.role)) throw new HandoverError("فقط مالک مشتری‌ها را قرض می‌دهد", 403);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new HandoverError("مدت قرض باید بین ۱ تا ۹۰ روز باشد");
  if (fromId === toId) throw new HandoverError("گیرنده باید کس دیگری باشد");
  const [from, to] = [await userIn(s.organizationId, fromId), await userIn(s.organizationId, toId)];
  if (!from || !to) throw new HandoverError("کاربر پیدا نشد", 404);
  if (!Number(to.active) || !canSell(to.role)) throw new HandoverError("گیرنده باید همکار فعالی باشد که می‌تواند مشتری داشته باشد");

  const db = getDb();
  const org = s.organizationId;
  const until = lastDay(days);
  return await db.tx(async () => {
    const owned = (await db.prepare("SELECT id FROM customers WHERE owner_user_id = ? AND organization_id = ?").all(fromId, org)) as unknown as { id: number }[];
    await db.prepare("UPDATE customers SET owner_user_id = ? WHERE owner_user_id = ? AND organization_id = ?").run(toId, fromId, org);
    const now = new Date().toISOString();
    for (const c of owned) {
      await db
        .prepare("INSERT INTO customer_loans (organization_id, customer_id, from_user_id, to_user_id, until, created_by, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(org, c.id, fromId, toId, until, s.user.id, now);
      await recordOwnerChange(db, { organizationId: org, customerId: c.id, actorUserId: s.user.id, reason: "loan", what: "owner", fromId, toId });
    }
    await emitEvent(org, { kind: "records.handed_over", entity_type: "user", entity_id: toId, actor_user_id: s.user.id, metadata: { from_user_id: fromId, customers: owned.length, tasks: 0, until } }, db);
    return { customers: owned.length, until };
  });
}

/** Loans still running, soonest end first. */
export async function openLoans(s: Session): Promise<Loan[]> {
  if (!isOwner(s.role)) throw new HandoverError("فقط مالک قرض‌ها را می‌بیند", 403);
  return (await getDb()
    .prepare(
      `SELECT l.id, l.customer_id, c.business_name AS customer_name, f.display_name AS from_name, t.display_name AS to_name, l.until
         FROM customer_loans l
         JOIN customers c ON c.id = l.customer_id
         JOIN users f ON f.id = l.from_user_id
         JOIN users t ON t.id = l.to_user_id
        WHERE l.organization_id = ? AND l.returned_at IS NULL
        ORDER BY l.until, c.business_name`
    )
    .all(s.organizationId)) as unknown as Loan[];
}

/** Gives lent customers back. Without ids: every loan whose last day has passed (the sweep). A customer whose
 *  owner changed again during the loan is left where it is; the loan is simply closed. */
export async function returnLoans(organizationId: number, ids?: number[], actorUserId: number | null = null): Promise<number> {
  const db = getDb();
  const rows = (ids
    ? await db.prepare("SELECT * FROM customer_loans WHERE organization_id = ? AND returned_at IS NULL AND id = ANY(?::bigint[])").all(organizationId, `{${ids.join(",")}}`)
    : await db.prepare("SELECT * FROM customer_loans WHERE organization_id = ? AND returned_at IS NULL AND until < ?").all(organizationId, tehranTodayIso())) as unknown as { id: number; customer_id: number; from_user_id: number; to_user_id: number }[];
  if (!rows.length) return 0;
  return await db.tx(async () => {
    for (const l of rows) {
      const back = await db.prepare("UPDATE customers SET owner_user_id = ? WHERE id = ? AND organization_id = ? AND owner_user_id = ?").run(l.from_user_id, l.customer_id, organizationId, l.to_user_id);
      if (Number(back.changes)) await recordOwnerChange(db, { organizationId, customerId: l.customer_id, actorUserId, reason: "loan_return", what: "owner", fromId: l.to_user_id, toId: l.from_user_id });
      await db.prepare("UPDATE customer_loans SET returned_at = ? WHERE id = ?").run(new Date().toISOString(), l.id);
    }
    return rows.length;
  });
}
