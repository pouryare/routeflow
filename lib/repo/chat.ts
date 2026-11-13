import { getDb } from "@/lib/db";
import { publishLive } from "@/lib/repo/live";
import { CHAT_PAGE, type ChatMessage, type ChatRecord } from "@/lib/chat";
import type { Session } from "@/lib/session";

interface Row { id: number; author_id: number; author: string; body: string; created_at: string }
const message = (r: Row): ChatMessage => ({ id: Number(r.id), authorId: Number(r.author_id), author: r.author, body: r.body, at: r.created_at });

/** Messages of one thread, oldest first: the latest page, or those after `afterId`. The caller has already checked the person may see the record. */
export async function threadOf(orgId: number, type: ChatRecord, recordId: number, afterId: number | null): Promise<ChatMessage[]> {
  const sql = `SELECT m.id, m.author_id, u.display_name AS author, m.body, m.created_at
      FROM chat_messages m JOIN users u ON u.id = m.author_id
     WHERE m.organization_id = ? AND m.record_type = ? AND m.record_id = ?`;
  const rows = (afterId === null
    ? await getDb().prepare(`${sql} ORDER BY m.id DESC LIMIT ?`).all(orgId, type, recordId, CHAT_PAGE)
    : await getDb().prepare(`${sql} AND m.id > ? ORDER BY m.id LIMIT 200`).all(orgId, type, recordId, afterId)) as unknown as Row[];
  return (afterId === null ? rows.reverse() : rows).map(message);
}

/** Saves a message (a repeat of the same clientKey saves once and returns the first) and tells everyone who may see the record. */
export async function postMessage(session: Session, type: ChatRecord, recordId: number, body: string, clientKey: string | null): Promise<number> {
  const db = getDb();
  const org = session.organizationId;
  const row = (await db
    .prepare(
      `INSERT INTO chat_messages (organization_id, record_type, record_id, author_id, body, client_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (author_id, client_key) WHERE client_key IS NOT NULL DO NOTHING RETURNING id`
    )
    .get(org, type, recordId, session.user.id, body, clientKey, new Date().toISOString())) as { id: number } | undefined;
  if (!row) {
    const first = (await db.prepare("SELECT id FROM chat_messages WHERE author_id = ? AND client_key = ?").get(session.user.id, clientKey)) as { id: number };
    return Number(first.id);
  }
  const id = Number(row.id);
  await markRead(session, type, recordId, id);
  await publishLive(org, { topic: "chat.msg", entity: { type, id: recordId }, data: { t: type, r: recordId, m: id, u: session.user.id } });
  return id;
}

export async function markRead(session: Session, type: ChatRecord, recordId: number, lastId: number): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO chat_reads (organization_id, user_id, record_type, record_id, last_read_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, record_type, record_id) DO UPDATE SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id)`
    )
    .run(session.organizationId, session.user.id, type, recordId, lastId);
}

/** How many messages from other people this person has not read in the thread. */
export async function unreadIn(session: Session, type: ChatRecord, recordId: number): Promise<number> {
  const r = (await getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM chat_messages m
        WHERE m.organization_id = ? AND m.record_type = ? AND m.record_id = ? AND m.author_id <> ?
          AND m.id > COALESCE((SELECT last_read_id FROM chat_reads WHERE user_id = ? AND record_type = ? AND record_id = ?), 0)`
    )
    .get(session.organizationId, type, recordId, session.user.id, session.user.id, type, recordId)) as { n: number };
  return Number(r.n);
}
