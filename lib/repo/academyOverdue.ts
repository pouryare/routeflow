/* A required company lesson whose deadline has passed (lesson.due_days after the person joined) sends that person
 * one push, once per person and lesson. Run by the rules sweep; the sweep's flush delivers it. Same reach as the
 * Academy page: the lesson must name the person's role, and a group's own lesson only reaches that group. */
import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";
import { companySlug, stillDone, type LessonRow } from "@/lib/repo/academyLessons";

const TYPE = "academy.lesson_overdue";

export async function queueOverdueLessonNudges(organizationId: number, today = tehranTodayIso()): Promise<number> {
  const db = getDb();
  const lessons = (await db
    .prepare("SELECT * FROM academy_lessons WHERE organization_id = ? AND status = 'published' AND required = true AND due_days IS NOT NULL AND roles <> ''")
    .all(organizationId)) as unknown as LessonRow[];
  let queued = 0;
  for (const l of lessons) {
    const roles = l.roles.split(",");
    const people = (await db
      .prepare(
        `SELECT u.id, u.created_at FROM users u
          WHERE u.organization_id = ? AND u.active = 1${l.group_id === null ? "" : " AND u.group_id = ?"}
            AND (u.role = ANY(?::text[]) OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = ANY(?::text[])))`
      )
      .all(organizationId, ...(l.group_id === null ? [] : [l.group_id]), `{${roles.join(",")}}`, `{${roles.join(",")}}`)) as unknown as { id: number; created_at: string }[];
    for (const u of people) {
      const due = new Date(Date.parse(u.created_at) + Number(l.due_days) * 86_400_000).toISOString().slice(0, 10);
      if (due >= today) continue;
      const progress = (await db.prepare("SELECT version_read FROM lesson_progress WHERE organization_id = ? AND user_id = ? AND lesson_slug = ?").get(organizationId, u.id, companySlug(l.id))) as
        | { version_read: number }
        | undefined;
      if (progress && stillDone(l, Number(progress.version_read))) continue;
      const key = `${TYPE}:${l.id}:${u.id}`;
      const res = await db
        .prepare(
          `INSERT INTO notifications (organization_id, user_id, type_code, title_fa, body_fa, group_key, priority, created_at)
           SELECT ?, ?, ?, ?, ?, ?, 'NORMAL', ? WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = ? AND n.group_key = ?)`
        )
        .run(organizationId, u.id, TYPE, "درس الزامی از مهلتش گذشته", `«${l.title}» را بخوانید`, key, new Date().toISOString(), u.id, key);
      queued += Number(res.changes);
    }
  }
  return queued;
}
