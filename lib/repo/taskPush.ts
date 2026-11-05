import { getDb } from "@/lib/db";

/** S19: minutes before a timed task its assignee is pinged (default 10). */
export async function taskPushMinutes(organizationId: number): Promise<number> {
  const r = (await getDb().prepare("SELECT task_push_minutes FROM organizations WHERE id = ?").get(organizationId)) as { task_push_minutes: number } | undefined;
  return Number(r?.task_push_minutes ?? 10);
}

export async function setTaskPushMinutes(organizationId: number, minutes: number): Promise<void> {
  await getDb().prepare("UPDATE organizations SET task_push_minutes = ? WHERE id = ?").run(minutes, organizationId);
}

/** Open, assigned tasks with a clock time (not just a day) starting within the lead minutes. */
export async function tasksStartingSoon(organizationId: number, asOfIso: string) {
  const lead = await taskPushMinutes(organizationId);
  return (await getDb()
    .prepare(
      `SELECT id, title, assignee_user_id, due_at FROM tasks
        WHERE organization_id = ? AND status = 'open' AND assignee_user_id IS NOT NULL
          AND length(due_at) > 10 AND due_at > ? AND due_at <= ?`
    )
    .all(organizationId, asOfIso, new Date(Date.parse(asOfIso) + lead * 60_000).toISOString())) as {
    id: number; title: string; assignee_user_id: number; due_at: string;
  }[];
}
