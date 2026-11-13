/* Fair lead assignment (S6): who gets a new lead that nobody chose an owner for, per group.
 * `pool` leaves it in the group pool; `round_robin` goes one person after another; `least_open` goes to the person
 * with the fewest open leads. Only active phone sellers of that group who are at work today are candidates; if there
 * are none the lead stays in the pool. */
import type { Db } from "@/lib/database/client";
import { tehranTodayIso } from "@/lib/jalali";

export const ASSIGN_MODES = ["pool", "round_robin", "least_open"] as const;

export async function pickRep(db: Db, organizationId: number, groupId: number): Promise<number | null> {
  const g = (await db.prepare("SELECT assign_mode, last_assigned_user_id FROM groups WHERE id = ? AND organization_id = ?").get(groupId, organizationId)) as
    | { assign_mode: string; last_assigned_user_id: number | null }
    | undefined;
  if (!g || g.assign_mode === "pool") return null;
  const people = (await db
    .prepare(
      `SELECT u.id,
              (SELECT COUNT(*) FROM customers c WHERE c.owner_user_id = u.id AND c.organization_id = u.organization_id AND c.lifecycle = 'lead' AND c.closed_at IS NULL) AS open
         FROM users u
         JOIN user_roles r ON r.user_id = u.id AND r.role = 'phone_sales'
        WHERE u.organization_id = ? AND u.group_id = ? AND u.active = 1 AND (u.leave_until IS NULL OR u.leave_until < ?)
        ORDER BY u.id`
    )
    .all(organizationId, groupId, tehranTodayIso())) as unknown as { id: number; open: number }[];
  if (!people.length) return null;
  let pick: number;
  if (g.assign_mode === "least_open") {
    pick = people.reduce((best, p) => (Number(p.open) < Number(best.open) ? p : best)).id;
  } else {
    const last = Number(g.last_assigned_user_id ?? 0);
    pick = (people.find((p) => Number(p.id) > last) ?? people[0]).id;
  }
  pick = Number(pick);
  await db.prepare("UPDATE groups SET last_assigned_user_id = ? WHERE id = ?").run(pick, groupId);
  return pick;
}
