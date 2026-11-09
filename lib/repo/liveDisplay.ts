/* Read-only display links for the live stream (idea L9, from Mercure's signed subscriber tokens).
 *
 * Example: the owner makes a link for the warehouse TV that carries only "runs". The TV opens
 * /api/live?display=<key> with nobody signed in and sees today's runs change as drivers work.
 * The key is shown once; only its SHA-256 is kept, like a password. Revoking it closes the TV's
 * stream at once (NOTIFY rf_live_kick) and refuses it from then on.
 *
 * The key starts with the company id ("1.Xy…"), so the lookup is by company like every other
 * company-data read, not a search through every company's keys. */
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import { isTopic } from "@/lib/live/protocol";

export interface DisplayKey {
  id: number;
  label: string;
  topics: string[];
  created_at: string;
  revoked_at: string | null;
}

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

/** Checks the owner's input: a label and 1 to 10 plain topics. Returns the error in Persian. */
export function checkDisplayInput(body: unknown): { ok: true; label: string; topics: string[] } | { ok: false; error: string } {
  const b = (body ?? {}) as { label?: unknown; topics?: unknown };
  const label = typeof b.label === "string" ? b.label.trim() : "";
  if (!label || label.length > 80) return { ok: false, error: "یک نام کوتاه برای این صفحه بنویسید" };
  const topics = Array.isArray(b.topics) ? [...new Set(b.topics)] : [];
  if (topics.length < 1 || topics.length > 10 || !topics.every((t) => typeof t === "string" && isTopic(t))) {
    return { ok: false, error: "موضوع‌ها نامعتبر است" };
  }
  return { ok: true, label, topics: topics as string[] };
}

/** Makes a key and returns it in full, the only time it is ever readable. */
export async function createDisplayKey(organizationId: number, label: string, topics: string[], userId: number, db: Db = getDb()): Promise<{ id: number; key: string }> {
  const key = `${organizationId}.${randomBytes(24).toString("base64url")}`;
  const row = (await db
    .prepare(
      `INSERT INTO live_display_keys (organization_id, key_hash, label, topics, created_by)
       VALUES (?, ?, ?, CAST(? AS text[]), ?) RETURNING id`
    )
    .get(organizationId, hash(key), label, `{${topics.join(",")}}`, userId)) as { id: number };
  return { id: Number(row.id), key };
}

export async function listDisplayKeys(organizationId: number, db: Db = getDb()): Promise<DisplayKey[]> {
  return (await db
    .prepare(
      `SELECT id, label, topics, created_at, revoked_at FROM live_display_keys
        WHERE organization_id = ? ORDER BY id DESC`
    )
    .all(organizationId)) as unknown as DisplayKey[];
}

/** Revokes a key and closes its open streams on every app server. False when there was no such
 *  live key in this company. */
export async function revokeDisplayKey(organizationId: number, id: number, db: Db = getDb()): Promise<boolean> {
  const r = await db
    .prepare("UPDATE live_display_keys SET revoked_at = now() WHERE organization_id = ? AND id = ? AND revoked_at IS NULL")
    .run(organizationId, id);
  if (Number(r.changes) === 0) return false;
  // A display stream's listener id is minus the key's id (displayListener), so the kick finds it.
  await db.prepare("SELECT pg_notify('rf_live_kick', ?) AS ok").get(String(-id));
  return true;
}

/** The live key a display link carries, or null when it is unknown, malformed or revoked. */
export async function displayKey(key: string, db: Db = getDb()): Promise<{ id: number; organizationId: number; topics: string[] } | null> {
  const m = /^(\d{1,12})\.[A-Za-z0-9_-]{32}$/.exec(key);
  if (!m) return null;
  const row = (await db
    .prepare(
      `SELECT id, organization_id, topics FROM live_display_keys
        WHERE organization_id = ? AND key_hash = ? AND revoked_at IS NULL`
    )
    .get(Number(m[1]), hash(key))) as { id: number; organization_id: number; topics: string[] } | undefined;
  return row ? { id: Number(row.id), organizationId: Number(row.organization_id), topics: row.topics } : null;
}
