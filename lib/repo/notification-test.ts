import { getDb } from "@/lib/db";
import { groupKeyFor } from "@/lib/repo/notifications";

/** Insert the one `system.test` feed row that `POST /api/notifications/test` then flushes.
 *
 *  It is not a `fanOutNotifications` call because `recipientsFor` has no `system.test`
 *  branch (there is no event and no entity -- the recipient is the caller, by definition).
 *  It lives here rather than in the route because `tests/repo-boundary.test.ts` keeps raw
 *  SQL inside `lib/repo/`, and that test's allowlist is only allowed to shrink.
 *
 *  Priority is NORMAL, matching the catalogue seed: a test message must not break through
 *  the user's own quiet hours, so a quiet-hours "held" is the correct outcome. */
export function insertTestNotification(organizationId: number, userId: number): number {
  const now = new Date().toISOString();
  const groupKey = groupKeyFor(
    "entity",
    { kind: "system.test", entity_type: null, entity_id: null, occurred_at: now, meta: {} },
    "system.test"
  );
  return Number(
    getDb()
      .prepare(
        `INSERT INTO notifications
           (organization_id, user_id, type_code, title_fa, body_fa, group_key, priority, created_at)
         VALUES (?, ?, 'system.test', ?, ?, ?, 'NORMAL', ?)`
      )
      .run(
        organizationId,
        userId,
        "پیام آزمایشی",
        "اگر این را دریافت کردید، این کانال درست کار می‌کند.",
        groupKey,
        now
      ).lastInsertRowid
  );
}
