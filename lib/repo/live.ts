/* Live updates (issue #58): the event log, presence and the short notices, in the database.
 * The stream itself is lib/live/hub.ts and app/api/live/route.ts; the rules both ends share are
 * lib/live/protocol.ts. db/migrations/1762500000000_live-events.sql explains the ordering lock. */
import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import { isTag, isTopic, MAX_DATA_CHARS, type LiveEvent, type LiveListener } from "@/lib/live/protocol";

export interface LiveMessage {
  topic: string;
  /** Only these people. Leave out for everyone in the company. */
  users?: number[];
  /** Only people holding one of these roles. Leave out for any role. */
  roles?: string[];
  /** Small: an id or a change, not a whole record. */
  data?: unknown;
  /** The record this is about. The stream then sends it only to people who may see that record
   *  (lib/live/visibility.ts), whatever the audience says. */
  entity?: { type: "order" | "run" | "customer"; id: number };
  /** Made by the sender, such as a chat message's id on the phone (idea L7): sending it again
   *  returns the first event's id and stores nothing new. 8 to 64 letters, digits, - or _. */
  clientKey?: string;
  /** Labels a screen can filter on, such as { district: "14" } (idea L10). */
  tags?: Record<string, string>;
}

/** Postgres array literal for a list of ids or plain words; the values are checked first, so
 *  nothing in them can break out of the literal. */
function pgArray(values: readonly (number | string)[] | undefined): string | null {
  if (!values) return null;
  for (const v of values) {
    if (typeof v === "number" ? !Number.isInteger(v) : !/^[a-z_]{1,40}$/.test(v)) throw new Error(`live: bad audience value ${String(v)}`);
  }
  return `{${values.join(",")}}`;
}

function checked(msg: LiveMessage): { data: string | null; tags: string[] | null } {
  if (!isTopic(msg.topic)) throw new Error(`live: bad topic ${msg.topic}`);
  const data = msg.data === undefined ? null : JSON.stringify(msg.data);
  if (data !== null && data.length > MAX_DATA_CHARS) throw new Error(`live: data for ${msg.topic} is ${data.length} chars; send an id instead`);
  if (msg.clientKey !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(msg.clientKey)) throw new Error("live: bad client key");
  const tags = msg.tags ? Object.entries(msg.tags).map(([k, v]) => `${k}:${v}`) : null;
  for (const t of tags ?? []) if (!isTag(t)) throw new Error(`live: bad tag ${t}`);
  return { data, tags };
}

/** text[] literal for tags; isTag already allowed only letters, digits, -, _ and one colon. */
const tagArray = (tags: string[] | null) => (tags ? `{${tags.join(",")}}` : null);

/** Records one event and wakes every open stream when the caller's transaction commits. Call it
 *  inside the same transaction as the change it describes, near its end: the event and the change
 *  then commit together, and the ordering lock it takes is held only briefly. Returns the id. */
export async function publishLive(organizationId: number, msg: LiveMessage, db: Db = getDb()): Promise<number> {
  const { data, tags } = checked(msg);
  const row = (await db
    .prepare("SELECT rf_live_publish(?, ?, CAST(? AS bigint[]), CAST(? AS text[]), ?, ?, ?, ?, CAST(? AS text[])) AS id")
    .get(
      organizationId,
      msg.topic,
      pgArray(msg.users),
      pgArray(msg.roles),
      data,
      msg.entity?.type ?? null,
      msg.entity?.id ?? null,
      msg.clientKey ?? null,
      tagArray(tags)
    )) as { id: number };
  return Number(row.id);
}

/** Notice payload on rf_live_eph. `l` marks a latest value (idea L4), which the stream keeps only
 *  the newest of per topic (idea L5). */
function ephemeralPayload(organizationId: number, msg: LiveMessage, data: string | null, tags: string[] | null, latest: boolean): string {
  return JSON.stringify({
    o: organizationId,
    t: msg.topic,
    u: msg.users ?? null,
    r: msg.roles ?? null,
    g: tags,
    d: data === null ? null : JSON.parse(data),
    ...(latest ? { l: 1 } : {}),
  });
}

/** A notice that is not worth keeping (someone is typing, someone came online): sent to the open
 *  streams now, never stored, so a phone that was away does not get it later. */
export async function publishEphemeral(organizationId: number, msg: LiveMessage, db: Db = getDb()): Promise<void> {
  const { data, tags } = checked(msg);
  // Postgres refuses a NOTIFY payload over 8000 bytes; the data limit above keeps well under it.
  await db.prepare("SELECT pg_notify('rf_live_eph', ?) AS ok").get(ephemeralPayload(organizationId, msg, data, tags, false));
}

/** A value where only the newest matters, such as import progress or a van's position (idea L4):
 *  kept as the topic's latest value, so a screen that opens gets it at once, and sent now to the
 *  open streams, which pass on only the newest of a quick run of them (idea L5). Not part of the
 *  event log: a phone that was away gets the current value, not the history. */
export async function publishLatest(organizationId: number, msg: LiveMessage, db: Db = getDb()): Promise<void> {
  const { data, tags } = checked(msg);
  await db
    .prepare(
      `INSERT INTO live_latest (organization_id, topic, audience_users, audience_roles, data_json, updated_at)
       VALUES (?, ?, CAST(? AS bigint[]), CAST(? AS text[]), ?, now())
       ON CONFLICT (organization_id, topic) DO UPDATE
         SET audience_users = EXCLUDED.audience_users, audience_roles = EXCLUDED.audience_roles,
             data_json = EXCLUDED.data_json, updated_at = now()`
    )
    .run(organizationId, msg.topic, pgArray(msg.users), pgArray(msg.roles), data);
  await db.prepare("SELECT pg_notify('rf_live_eph', ?) AS ok").get(ephemeralPayload(organizationId, msg, data, tags, true));
}

/** The latest values this person may receive, for a stream that just opened. */
export async function latestFor(who: LiveListener, db: Db = getDb()): Promise<{ topic: string; data_json: string | null }[]> {
  return (await db
    .prepare(
      `SELECT topic, data_json FROM live_latest
        WHERE organization_id = ?
          AND (audience_users IS NULL OR ? = ANY (audience_users))
          AND (audience_roles IS NULL OR audience_roles && CAST(? AS text[]))
        ORDER BY topic`
    )
    .all(who.organizationId, who.userId, pgArray(who.roles))) as { topic: string; data_json: string | null }[];
}

/* audience_users is read back as int[], since the driver hands bigint arrays over as strings and
   the stream compares them with numbers. */

/** The events after `afterId` that this person may receive, oldest first. The audience is checked
 *  here in SQL and again by the stream (protocol.canReceive), which decides for live events. */
export async function eventsAfter(who: LiveListener, afterId: number, limit = 500, db: Db = getDb()): Promise<LiveEvent[]> {
  return (await db
    .prepare(
      `SELECT id, organization_id, topic, CAST(audience_users AS int[]) AS audience_users, audience_roles, data_json, entity_type, entity_id, tags
         FROM live_events
        WHERE id > ? AND organization_id = ?
          AND (audience_users IS NULL OR ? = ANY (audience_users))
          AND (audience_roles IS NULL OR audience_roles && CAST(? AS text[]))
        ORDER BY id
        LIMIT ?`
    )
    .all(afterId, who.organizationId, who.userId, pgArray(who.roles), limit)) as unknown as LiveEvent[];
}

/** Every company's events after `afterId`, oldest first: what one app server fans out. Runs as a
 *  job (system scope), since it serves every signed-in person on this server. */
export async function allEventsAfter(afterId: number, limit = 1000, db: Db = getDb()): Promise<LiveEvent[]> {
  return (await db
    .prepare(
      `SELECT id, organization_id, topic, CAST(audience_users AS int[]) AS audience_users, audience_roles, data_json, entity_type, entity_id, tags
         FROM live_events WHERE id > ? ORDER BY id LIMIT ?`
    )
    .all(afterId, limit)) as unknown as LiveEvent[];
}

/** The newest event in the whole log, where one app server starts reading from. Every company's,
 *  like allEventsAfter. A transaction still holding the ordering lock has not committed, so its id
 *  is above this and is read when it lands. */
export async function newestEventId(db: Db = getDb()): Promise<number> {
  const r = (await db.prepare("SELECT id, organization_id FROM live_events ORDER BY id DESC LIMIT 1").get()) as { id: number } | undefined;
  return r?.id ?? 0;
}

/** The oldest and newest ids this company still has in the log, to tell whether a reconnecting
 *  phone's gap can be caught up (protocol.needsReset). Per company, so ids from other companies
 *  in between read as a gap only when this company's own older events were pruned too; the worst
 *  a wrong guess does is one refetch. */
export async function eventBounds(organizationId: number, db: Db = getDb()): Promise<{ oldest: number | null; newest: number | null }> {
  const r = (await db
    .prepare("SELECT MIN(id) AS oldest, MAX(id) AS newest FROM live_events WHERE organization_id = ?")
    .get(organizationId)) as { oldest: number | null; newest: number | null };
  return { oldest: r.oldest ?? null, newest: r.newest ?? null };
}

/** Moves events older than `days` to live_events_archive (kept, not deleted: owner decision
 *  2026-11-09), always keeping the newest one, so the log's bounds still say where it had got to.
 *  A phone away longer than that gets a reset and refetches. */
export async function pruneEvents(days = 7, db: Db = getDb()): Promise<number> {
  const r = await db
    .prepare(
      `WITH moved AS (
         DELETE FROM live_events
          WHERE created_at < now() - make_interval(days => ?)
            AND id < (SELECT MAX(id) FROM live_events)
         RETURNING *)
       INSERT INTO live_events_archive SELECT * FROM moved`
    )
    .run(days);
  return Number(r.changes);
}

/** "Seen now", from an open stream's heartbeat. */
export async function touchPresence(userId: number, organizationId: number, db: Db = getDb()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO live_presence (user_id, organization_id, last_seen) VALUES (?, ?, now())
       ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, last_seen = now()`
    )
    .run(userId, organizationId);
}

/** Marks a person gone at once, when their last open stream on this server closes. Another
 *  server holding one of their streams sets it again on its next heartbeat. */
export async function clearPresence(userId: number, db: Db = getDb()): Promise<void> {
  await db.prepare("DELETE FROM live_presence WHERE user_id = ?").run(userId);
}

/** Who in this company has an open screen: seen within the last minute (heartbeats come every 20
 *  seconds, so one missed beat does not drop anyone). */
export async function onlineUserIds(organizationId: number, db: Db = getDb()): Promise<number[]> {
  const rows = (await db
    .prepare(
      `SELECT user_id FROM live_presence
        WHERE organization_id = ? AND last_seen > now() - interval '60 seconds'
        ORDER BY user_id`
    )
    .all(organizationId)) as { user_id: number }[];
  return rows.map((r) => r.user_id);
}
