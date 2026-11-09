/* Live updates (issue #58): the rules both ends of the stream agree on, with no database and no
 * browser API, so they are tested on their own.
 *
 * One stream per person carries every topic. Each message is one SSE frame whose data is
 * `{ "t": topic, "d": data }`; a stored event also carries `id:`, so the browser's own reconnect
 * sends it back as Last-Event-ID. Ephemeral notices (typing, online) carry no id: they are never
 * stored, so there is nothing to catch up on. */
import type { Role } from "@/lib/roles";

/** Topics the server itself sends on the stream, beside the ones features publish. */
export const RESET_TOPIC = "live.reset"; // the phone is too far behind: refetch, do not trust the gap
export const BYE_TOPIC = "live.bye"; // the session ended: stop, do not reconnect with it

/** One stored event, as the stream reads it. */
export interface LiveEvent {
  id: number;
  organization_id: number;
  topic: string;
  audience_users: number[] | null;
  audience_roles: string[] | null;
  data_json: string | null;
  /** The record the event is about, when it is about one; the stream checks the person may see it. */
  entity_type?: string | null;
  entity_id?: number | null;
}

/** Who is on the other end of a stream. */
export interface LiveListener {
  userId: number;
  organizationId: number;
  roles: readonly Role[];
}

/** A topic is short and plain: it ends up in SQL checks, logs and the browser's handler map. */
export function isTopic(topic: string): boolean {
  return /^[a-z0-9_.:-]{1,80}$/.test(topic);
}

/** The stored size limit of an event's data, which the table also enforces. Send ids or a small
 *  change and let the screen fetch the rest, not whole records (a phone on 3G pays for every byte). */
export const MAX_DATA_CHARS = 4000;

/** Whether this person may receive this event: same company, and named by the event's audience
 *  when it has one. Both lists given means both must match (for example "these users, and only
 *  while they are managers"). An empty list matches nobody: an empty audience must never read
 *  as "everyone". */
export function canReceive(who: LiveListener, ev: Pick<LiveEvent, "organization_id" | "audience_users" | "audience_roles">): boolean {
  if (ev.organization_id !== who.organizationId) return false;
  if (ev.audience_users && !ev.audience_users.includes(who.userId)) return false;
  if (ev.audience_roles && !ev.audience_roles.some((r) => who.roles.includes(r as Role))) return false;
  return true;
}

/** The last event id the browser already has: the larger of the header its own reconnect sends
 *  and the `?after=` a reopened stream sends, since one may be newer than the other. Anything that
 *  is not a plain non-negative integer counts as "nothing yet". */
export function lastSeenId(header: string | null, query: string | null): number {
  const read = (v: string | null) => (v && /^\d{1,15}$/.test(v.trim()) ? Number(v.trim()) : 0);
  return Math.max(read(header), read(query));
}

/** Whether a reconnecting phone can be caught up from the log, or must refetch. `oldest` and
 *  `newest` are the ids still in the table (null when it is empty). Behind the oldest means
 *  events were pruned in between; ahead of the newest means the database is not the one the
 *  phone saw (a restore). Either way the gap cannot be trusted. */
export function needsReset(lastSeen: number, oldest: number | null, newest: number | null): boolean {
  if (lastSeen === 0) return false; // a first connection: nothing to catch up on
  if (oldest === null || newest === null) return true;
  return lastSeen < oldest - 1 || lastSeen > newest;
}

/** One SSE frame. Data is JSON on one line, so no frame can be split by a newline in it. */
export function frame(topic: string, data: unknown, id?: number): string {
  const body = JSON.stringify({ t: topic, d: data ?? null });
  return `${id !== undefined ? `id: ${id}\n` : ""}data: ${body}\n\n`;
}

/** The frame for a stored event. Its data is already JSON text. */
export function eventFrame(ev: Pick<LiveEvent, "id" | "topic" | "data_json">): string {
  return `id: ${ev.id}\ndata: {"t":${JSON.stringify(ev.topic)},"d":${ev.data_json ?? "null"}}\n\n`;
}

/** How long the browser waits before reconnecting, spread between 2 and 8 seconds so that after a
 *  restart every phone does not come back in the same second. */
export function retryMs(random: () => number = Math.random): number {
  return 2000 + Math.floor(random() * 6000);
}
