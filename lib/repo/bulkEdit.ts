import { getDb } from "@/lib/db";
import type { BulkActor, BulkPlan } from "@/lib/bulkEdit";
import { MANAGE_ROLES, canSell, isOwner, type Role } from "@/lib/roles";
import { recordOwnerChange } from "@/lib/repo/crm/ownerChange";

export class BulkEditError extends Error {}

type Row = { id: number; owner_user_id: number | null; group_id: number | null };

/** The customers of `plan.ids` the actor may change: any in the company for an owner, only their own group's for a group manager. */
async function reachable(a: BulkActor, ids: number[]): Promise<Row[]> {
  const rows = (await getDb()
    .prepare(`SELECT id, owner_user_id, group_id FROM customers WHERE organization_id = ? AND merged_into_id IS NULL AND id IN (${ids.map(() => "?").join(",")})`)
    .all(a.organizationId, ...ids)) as unknown as Row[];
  return isOwner(a.role) ? rows : rows.filter((r) => a.groupId !== null && r.group_id === a.groupId);
}

/** Refuses a value the actor may not set; returns null when fine. */
async function valueProblem(a: BulkActor, plan: BulkPlan): Promise<string | null> {
  if (!MANAGE_ROLES.includes(a.role)) return "این کار فقط برای مدیران است";
  if (plan.field === "group") {
    if (!isOwner(a.role)) return "فقط مالک گروه مشتری را عوض می‌کند";
    if (plan.value === null) return null;
    return (await getDb().prepare("SELECT 1 FROM groups WHERE id = ? AND organization_id = ?").get(plan.value, a.organizationId)) ? null : "گروه پیدا نشد";
  }
  if (plan.value === null) return null;
  const u = (await getDb().prepare("SELECT role, active, group_id FROM users WHERE id = ? AND organization_id = ?").get(plan.value, a.organizationId)) as { role: Role; active: number; group_id: number | null } | undefined;
  if (!u || !Number(u.active) || !canSell(u.role)) return "فروشنده‌ای با این مشخصات پیدا نشد";
  if (!isOwner(a.role) && u.group_id !== a.groupId) return "فقط به همکاران گروه خودتان می‌توانید بسپارید";
  return null;
}

const currentOf = (r: Row, f: BulkPlan["field"]) => (f === "owner" ? r.owner_user_id : r.group_id);

/** What would change, without changing it: how many customers differ, how many already match, how many are out of reach. */
export async function previewBulkEdit(a: BulkActor, plan: BulkPlan): Promise<{ count: number; same: number; refused: number }> {
  const problem = await valueProblem(a, plan);
  if (problem) throw new BulkEditError(problem);
  const rows = await reachable(a, plan.ids);
  const same = rows.filter((r) => currentOf(r, plan.field) === plan.value).length;
  return { count: rows.length - same, same, refused: plan.ids.length - rows.length };
}

/** Changes every reachable customer that differs, one `owner_change` line on each one's timeline (F100). */
export async function applyBulkEdit(a: BulkActor, plan: BulkPlan, onProgress?: (done: number) => Promise<void>): Promise<number> {
  const problem = await valueProblem(a, plan);
  if (problem) throw new BulkEditError(problem);
  const db = getDb();
  const todo = (await reachable(a, plan.ids)).filter((r) => currentOf(r, plan.field) !== plan.value);
  let done = 0;
  for (const r of todo) {
    await db.tx(async () => {
      const col = plan.field === "owner" ? "owner_user_id" : "group_id";
      await db.prepare(`UPDATE customers SET ${col} = ? WHERE id = ? AND organization_id = ?`).run(plan.value, r.id, a.organizationId);
      await recordOwnerChange(db, { organizationId: a.organizationId, customerId: r.id, actorUserId: a.userId, reason: "bulk", what: plan.field, fromId: currentOf(r, plan.field), toId: plan.value });
    });
    if (onProgress && ++done % 25 === 0) await onProgress(done);
  }
  return todo.length;
}

/** Who and which groups the bulk-edit sheet may offer this person (the same limits valueProblem enforces). */
export async function bulkTargets(a: BulkActor): Promise<{ reps: { id: string; label: string }[]; groups: { id: string; label: string }[] }> {
  if (!MANAGE_ROLES.includes(a.role)) return { reps: [], groups: [] };
  const own = !isOwner(a.role);
  const users = (await getDb()
    .prepare(`SELECT id, display_name, role FROM users WHERE organization_id = ? AND active = 1 ${own ? "AND group_id = ?" : ""} ORDER BY display_name`)
    .all(...(own ? [a.organizationId, a.groupId] : [a.organizationId]))) as unknown as { id: number; display_name: string; role: Role }[];
  const groups = isOwner(a.role) ? ((await getDb().prepare("SELECT id, name FROM groups WHERE organization_id = ? ORDER BY name").all(a.organizationId)) as unknown as { id: number; name: string }[]) : [];
  return {
    reps: users.filter((u) => canSell(u.role)).map((u) => ({ id: String(u.id), label: u.display_name })),
    groups: groups.map((g) => ({ id: String(g.id), label: g.name })),
  };
}
