import { getDb } from "@/lib/db";
import { claimNotification } from "@/lib/repo/leadImport";
import { fanOutNotifications } from "@/lib/repo/notifications";

/** The notification code for "your bulk import is still running".
 *
 *  Deliberately ambient, not directed: the person who pasted is the one who wants to
 *  know, and there is no actor or entity to point the feed at -- the job is the subject.
 *  An event row is written so the fanout has something real to hang the notification on
 *  rather than inventing a synthetic one. */
const TYPE_CODE = "lead_import.slow";

/** Registers the type once per organisation, on first use.
 *
 *  A missing catalogue row makes fanOutNotifications return 0 silently, so without this
 *  the 60-second notification would simply never appear and nothing would say why. */
async function ensureType(organizationId: number): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO notification_types
         (organization_id, code, name_fa, category, directedness, priority, group_scope, created_at, updated_at)
       VALUES (?, ?, 'پردازش لینک‌ها طول کشیده است', 'system', 'ambient', 'LOW', 'type_day', ?, ?)
       ON CONFLICT DO NOTHING`
    )
    .run(organizationId, TYPE_CODE, now, now);
}

/** Tells the tenant's managers that a large import is still grinding away.
 *
 *  Fires at most once per job: `claimNotification` is a conditional UPDATE, so of the
 *  several tabs polling the same job exactly one wins and the rest get 0. Returns how
 *  many notifications were actually created, which is the testable part. */
export async function maybeNotifySlowJob(organizationId: number, jobId: number, total: number): Promise<number> {
  if (!await claimNotification(organizationId, jobId)) return 0;
  await ensureType(organizationId);

  const now = new Date().toISOString();
  const eventId = Number(
    (await getDb()
      .prepare(
        `INSERT INTO events (organization_id, kind, entity_type, entity_id, occurred_at, metadata_json, created_at)
         VALUES (?, 'lead_import.slow', 'lead_import_job', ?, ?, ?, ?)`
      )
      .run(organizationId, jobId, now, JSON.stringify({ job_id: jobId, total }), now)).lastInsertRowid
  );

  return await fanOutNotifications(
    organizationId,
    { code: TYPE_CODE, action_json: JSON.stringify({ notification_type: TYPE_CODE }) },
    {
      id: eventId,
      kind: "lead_import.slow",
      entity_type: "lead_import_job",
      entity_id: jobId,
      actor_user_id: null,
      metadata_json: JSON.stringify({ job_id: jobId, total }),
      occurred_at: now,
    },
    null
  );
}
