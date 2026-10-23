import { getDb } from "@/lib/db";
import { groupKeyFor, getChannelState, inQuietWindow } from "@/lib/repo/notifications";

/** Keep in step with lib/repo/notifications.ts — quiet hours are Tehran wall-clock. */
const TEHRAN = "Asia/Tehran";

/** The catalogue row for `system.test`, tenant override winning over the NULL-org seed --
 *  the same resolution `catalogueRow` does in lib/repo/notifications.ts (private there). */
async function testTypePriority(organizationId: number): Promise<string> {
  const row = await getDb()
    .prepare(
      `SELECT priority FROM notification_types
        WHERE code = 'system.test' AND (organization_id = ? OR organization_id IS NULL)
        ORDER BY (organization_id IS NULL) LIMIT 1`
    )
    .get(organizationId) as { priority: string } | undefined;
  // Only reachable if the seed has not run; NORMAL keeps a test message out of the
  // CRITICAL-breaks-quiet path, which is the conservative default.
  return row?.priority ?? "NORMAL";
}

/** Insert the one `system.test` feed row that `POST /api/notifications/test` then flushes,
 *  and return its id so the route can read back that row's own delivery outcome.
 *
 *  It is not a `fanOutNotifications` call because `recipientsFor` has no `system.test`
 *  branch (there is no event and no entity -- the recipient is the caller, by definition).
 *  It lives here rather than in the route because `tests/repo-boundary.test.ts` keeps raw
 *  SQL inside `lib/repo/`, and that test's allowlist is only allowed to shrink.
 *
 *  Priority is read from the catalogue rather than written as a literal, so a re-seed or a
 *  tenant override moves it in one place. At the seeded NORMAL a test message does not
 *  break through the caller's own quiet hours, so a quiet-hours hold is a correct outcome. */
export async function insertTestNotification(organizationId: number, userId: number): Promise<number> {
  const now = new Date().toISOString();
  const groupKey = groupKeyFor(
    "entity",
    { kind: "system.test", entity_type: null, entity_id: null, occurred_at: now, meta: {} },
    "system.test"
  );
  return Number(
    (await getDb()
      .prepare(
        `INSERT INTO notifications
           (organization_id, user_id, type_code, title_fa, body_fa, group_key, priority, created_at)
         VALUES (?, ?, 'system.test', ?, ?, ?, ?, ?)`
      )
      .run(
        organizationId,
        userId,
        "پیام آزمایشی",
        "اگر این را دریافت کردید، این کانال درست کار می‌کند.",
        groupKey,
        await testTypePriority(organizationId),
        now
      )).lastInsertRowid
  );
}

export type TestOutcome = {
  channel: "push" | "telegram";
  /** "sent" once the flush stamped this row; otherwise "held" if the caller's own quiet
   *  window was open at `asOfIso`, and "failed" if the provider simply refused. */
  status: "sent" | "held" | "failed";
};

/** What happened to *this* row on *this* channel -- the answer the caller asked for, as
 *  opposed to `flushNotifications`' org-wide counters, which also cover every other user
 *  the same pass happened to flush. The per-channel stamp is the authority: `flushChannel`
 *  writes it only after a successful send or edit. The held/failed split uses the flush's
 *  own exported `inQuietWindow`, so the two can never disagree about a quiet window. */
export async function testNotificationOutcome(
  notificationId: number,
  channel: "push" | "telegram",
  asOfIso: string
): Promise<TestOutcome> {
  const col = channel === "push" ? "push_flushed_at" : "tg_flushed_at";
  const row = await getDb()
    .prepare(`SELECT user_id, ${col} AS flushed_at FROM notifications WHERE id = ?`)
    .get(notificationId) as { user_id: number; flushed_at: string | null } | undefined;
  if (row?.flushed_at) return { channel, status: "sent" };

  const state = await getChannelState(row?.user_id ?? 0, channel);
  // Must match flushNotifications' own derivation exactly, Tehran included, or this
  // helper and the flush can disagree about whether a row was held.
  const nowHHMM = new Date(asOfIso).toLocaleTimeString("en-GB", { hour12: false, timeZone: TEHRAN }).slice(0, 5);
  return {
    channel,
    status: inQuietWindow(nowHHMM, state.quiet_start, state.quiet_end) ? "held" : "failed",
  };
}
