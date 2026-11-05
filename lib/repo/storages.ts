/** Company storages: the rows behind lib/storage (docs/storage.md). Every function takes the company
 *  id and filters on it, on top of row-level security. Secrets never leave this file unsealed except
 *  through `secretOf`, which only lib/storage calls. */

import { getDb } from "@/lib/db";
import { openSecret, sealSecret } from "@/lib/auth";
import type { FileKind } from "@/lib/storage/driver";

const SECRET_PURPOSE = "storage-secret";

export interface StorageRow {
  id: number;
  organization_id: number;
  name: string;
  kind: "s3" | "local";
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  path_prefix: string;
  access_key_id: string | null;
  secret_enc: string | null;
  secret_last4: string | null;
  plan_bytes: number | null;
  warn_percent: number;
  at_limit: "keep" | "spill";
  overflow_storage_id: number | null;
  state: "active" | "moving_out" | "removed";
  used_bytes: number;
  file_count: number;
  near_full_at: string | null;
  last_check_at: string | null;
  last_check_error: string | null;
  created_at: string;
  updated_at: string;
}

/** What the browser may see: everything but the sealed secret. */
export type PublicStorage = Omit<StorageRow, "secret_enc">;
export const publicStorage = (s: StorageRow): PublicStorage => {
  const { secret_enc: _sealed, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
};

export interface RuleRow {
  file_kind: FileKind | "*";
  storage_id: number;
  mirror_storage_id: number | null;
}

export interface StoredFileRow {
  id: number;
  organization_id: number;
  file_kind: FileKind;
  stem: string;
  variants: string;
  month: string;
  storage_id: number | null;
  bytes: number;
  mirror_storage_id: number | null;
  mirror_state: "none" | "pending" | "done" | "failed";
  upload_state: "stored" | "held";
  held_since: string | null;
  deleted_at: string | null;
  trash_ref: string | null;
  last_move_id: number | null;
  created_at: string;
}

export type EventKind =
  | "added" | "edited" | "key_swapped" | "rules_changed" | "check_failed" | "check_ok" | "held" | "near_full"
  | "spilled" | "move_started" | "move_done" | "removed" | "file_missing" | "restored" | "purged";

const now = () => new Date().toISOString();
const db = () => getDb();

export const secretOf = (s: StorageRow): string | null => (s.secret_enc ? openSecret(SECRET_PURPOSE, s.secret_enc) : null);
export const sealStorageSecret = (plain: string) => sealSecret(SECRET_PURPOSE, plain);

export async function listStorages(orgId: number, withRemoved = false): Promise<StorageRow[]> {
  return (await db()
    .prepare(`SELECT * FROM storages WHERE organization_id = ?${withRemoved ? "" : " AND state <> 'removed'"} ORDER BY id`)
    .all(orgId)) as unknown as StorageRow[];
}

export async function getStorage(orgId: number, id: number): Promise<StorageRow | undefined> {
  return (await db().prepare("SELECT * FROM storages WHERE id = ? AND organization_id = ?").get(id, orgId)) as StorageRow | undefined;
}

export interface StorageInput {
  name: string;
  kind: "s3" | "local";
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  path_prefix: string;
  access_key_id: string | null;
  /** Plain secret; null keeps the stored one (an edit that does not swap the key). */
  secret: string | null;
  plan_bytes: number | null;
  warn_percent: number;
  at_limit: "keep" | "spill";
  overflow_storage_id: number | null;
}

export async function insertStorage(orgId: number, input: StorageInput, userId: number): Promise<number> {
  const t = now();
  const r = await db()
    .prepare(
      `INSERT INTO storages (organization_id, name, kind, endpoint, region, bucket, path_prefix, access_key_id, secret_enc,
         secret_last4, plan_bytes, warn_percent, at_limit, overflow_storage_id, last_check_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      orgId, input.name, input.kind, input.endpoint, input.region, input.bucket, input.path_prefix, input.access_key_id,
      input.secret ? sealStorageSecret(input.secret) : null, input.secret ? input.secret.slice(-4) : null,
      input.plan_bytes, input.warn_percent, input.at_limit, input.overflow_storage_id, t, userId, t, t
    );
  const id = Number(r.lastInsertRowid);
  // The first storage becomes the default, so uploads work the moment it is saved.
  await db()
    .prepare("INSERT INTO storage_rules (organization_id, file_kind, storage_id) VALUES (?, '*', ?) ON CONFLICT DO NOTHING")
    .run(orgId, id);
  return id;
}

export async function updateStorage(orgId: number, id: number, input: StorageInput): Promise<void> {
  const t = now();
  const sets = [
    "name = ?", "endpoint = ?", "region = ?", "bucket = ?", "path_prefix = ?", "access_key_id = ?", "plan_bytes = ?",
    "warn_percent = ?", "at_limit = ?", "overflow_storage_id = ?", "last_check_at = ?", "last_check_error = NULL", "updated_at = ?",
  ];
  const params: (string | number | null)[] = [
    input.name, input.endpoint, input.region, input.bucket, input.path_prefix, input.access_key_id, input.plan_bytes,
    input.warn_percent, input.at_limit, input.overflow_storage_id, t, t,
  ];
  if (input.secret) {
    sets.push("secret_enc = ?", "secret_last4 = ?");
    params.push(sealStorageSecret(input.secret), input.secret.slice(-4));
  }
  await db().prepare(`UPDATE storages SET ${sets.join(", ")} WHERE id = ? AND organization_id = ?`).run(...params, id, orgId);
  // Below the warning level again: the next crossing warns again.
  await db()
    .prepare(
      `UPDATE storages SET near_full_at = NULL WHERE id = ? AND organization_id = ?
         AND (plan_bytes IS NULL OR used_bytes * 100 < plan_bytes * warn_percent)`
    )
    .run(id, orgId);
}

export async function setStorageState(orgId: number, id: number, state: StorageRow["state"]): Promise<void> {
  await db().prepare("UPDATE storages SET state = ?, updated_at = ? WHERE id = ? AND organization_id = ?").run(state, now(), id, orgId);
}

export async function recordCheck(orgId: number, id: number, error: string | null): Promise<void> {
  await db()
    .prepare("UPDATE storages SET last_check_at = ?, last_check_error = ? WHERE id = ? AND organization_id = ?")
    .run(now(), error, id, orgId);
}

/** Add (or take away, with negative numbers) used space; returns the storage afterwards. */
export async function addUsage(orgId: number, id: number, bytes: number, files: number): Promise<StorageRow | undefined> {
  await db()
    .prepare(
      `UPDATE storages SET used_bytes = GREATEST(0, used_bytes + ?), file_count = GREATEST(0, file_count + ?)
        WHERE id = ? AND organization_id = ?`
    )
    .run(bytes, files, id, orgId);
  return await getStorage(orgId, id);
}

export async function setUsage(orgId: number, id: number, bytes: number, files: number): Promise<void> {
  await db().prepare("UPDATE storages SET used_bytes = ?, file_count = ? WHERE id = ? AND organization_id = ?").run(bytes, files, id, orgId);
}

/** Marks the storage near full once per crossing; true when this call is the crossing. */
export async function claimNearFull(orgId: number, id: number): Promise<boolean> {
  const r = await db()
    .prepare(
      `UPDATE storages SET near_full_at = ? WHERE id = ? AND organization_id = ? AND near_full_at IS NULL
         AND plan_bytes IS NOT NULL AND used_bytes * 100 >= plan_bytes * warn_percent`
    )
    .run(now(), id, orgId);
  return Number(r.changes) > 0;
}

export async function listRules(orgId: number): Promise<RuleRow[]> {
  return (await db()
    .prepare("SELECT file_kind, storage_id, mirror_storage_id FROM storage_rules WHERE organization_id = ? ORDER BY file_kind")
    .all(orgId)) as unknown as RuleRow[];
}

export async function replaceRules(orgId: number, rules: RuleRow[]): Promise<void> {
  const d = db();
  await d.prepare("DELETE FROM storage_rules WHERE organization_id = ?").run(orgId);
  for (const r of rules) {
    await d
      .prepare("INSERT INTO storage_rules (organization_id, file_kind, storage_id, mirror_storage_id) VALUES (?, ?, ?, ?)")
      .run(orgId, r.file_kind, r.storage_id, r.mirror_storage_id);
  }
}

export async function logStorageEvent(orgId: number, storageId: number | null, kind: EventKind, detail: string | null, userId: number | null = null): Promise<void> {
  await db()
    .prepare("INSERT INTO storage_events (organization_id, storage_id, kind, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(orgId, storageId, kind, detail ? detail.slice(0, 500) : null, userId, now());
}

export interface EventRow {
  id: number;
  storage_id: number | null;
  storage_name: string | null;
  kind: EventKind;
  detail: string | null;
  user_name: string | null;
  created_at: string;
}

export async function listEvents(orgId: number, limit = 100): Promise<EventRow[]> {
  return (await db()
    .prepare(
      `SELECT e.id, e.storage_id, s.name AS storage_name, e.kind, e.detail, u.display_name AS user_name, e.created_at
         FROM storage_events e LEFT JOIN storages s ON s.id = e.storage_id LEFT JOIN users u ON u.id = e.user_id
        WHERE e.organization_id = ? ORDER BY e.id DESC LIMIT ?`
    )
    .all(orgId, limit)) as unknown as EventRow[];
}

/** An event of this kind for this storage in the last `minutes`, so a repeated failure is logged once. */
export async function recentEvent(orgId: number, storageId: number | null, kind: EventKind, minutes: number): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  return !!(await db()
    .prepare(
      `SELECT 1 FROM storage_events WHERE organization_id = ? AND kind = ? AND created_at >= ?
         AND storage_id IS NOT DISTINCT FROM ? LIMIT 1`
    )
    .get(orgId, kind, since, storageId));
}

/** An in-app notice to the company's owners (decision 19). */
export async function notifyOwners(orgId: number, title: string, body: string | null, groupKey: string): Promise<void> {
  const owners = (await db()
    .prepare("SELECT id FROM users WHERE organization_id = ? AND role = 'owner' AND active = 1")
    .all(orgId)) as { id: number }[];
  const t = now();
  for (const o of owners) {
    await db()
      .prepare(
        `INSERT INTO notifications (organization_id, user_id, type_code, title_fa, body_fa, group_key, priority, created_at)
         VALUES (?, ?, 'storage.problem', ?, ?, ?, 'HIGH', ?)`
      )
      .run(orgId, o.id, title, body, groupKey, t);
  }
}

// ---- stored files ----

export async function fileByStem(stem: string): Promise<StoredFileRow | undefined> {
  return (await db().prepare("SELECT * FROM stored_files WHERE stem = ?").get(stem)) as StoredFileRow | undefined;
}

export async function insertStoredFile(row: Omit<StoredFileRow, "id" | "deleted_at" | "trash_ref" | "last_move_id" | "created_at">): Promise<number> {
  const r = await db()
    .prepare(
      `INSERT INTO stored_files (organization_id, file_kind, stem, variants, month, storage_id, bytes, mirror_storage_id,
         mirror_state, upload_state, held_since, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.organization_id, row.file_kind, row.stem, row.variants, row.month, row.storage_id, row.bytes, row.mirror_storage_id,
      row.mirror_state, row.upload_state, row.held_since, now()
    );
  return Number(r.lastInsertRowid);
}

export async function updateStoredFile(id: number, fields: Partial<Pick<StoredFileRow, "storage_id" | "mirror_storage_id" | "mirror_state" | "upload_state" | "held_since" | "last_move_id" | "deleted_at" | "trash_ref">>): Promise<void> {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (keys.length === 0) return;
  const allowed = new Set(["storage_id", "mirror_storage_id", "mirror_state", "upload_state", "held_since", "last_move_id", "deleted_at", "trash_ref"]);
  for (const k of keys) if (!allowed.has(k)) throw new Error(`bad column ${k}`);
  await db()
    .prepare(`UPDATE stored_files SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => fields[k] ?? null), id);
}

export async function deleteStoredFile(id: number): Promise<void> {
  await db().prepare("DELETE FROM stored_files WHERE id = ?").run(id);
}

// ---- jobs ----

export type JobKind = "upload" | "mirror" | "move" | "purge";
export interface JobRow {
  id: number;
  organization_id: number;
  kind: JobKind;
  stored_file_id: number;
  move_id: number | null;
  attempts: number;
  next_try_at: string;
  last_error: string | null;
}

export async function queueJob(orgId: number, kind: JobKind, fileId: number, moveId: number | null = null, delayMs = 0): Promise<void> {
  const t = new Date(Date.now() + delayMs).toISOString();
  await db()
    .prepare(
      `INSERT INTO storage_jobs (organization_id, kind, stored_file_id, move_id, next_try_at, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (stored_file_id, kind) DO UPDATE SET move_id = EXCLUDED.move_id, next_try_at = EXCLUDED.next_try_at, attempts = 0`
    )
    .run(orgId, kind, fileId, moveId, t, now());
}

export async function dueJobs(orgId: number, limit: number): Promise<JobRow[]> {
  return (await db()
    .prepare("SELECT * FROM storage_jobs WHERE organization_id = ? AND next_try_at <= ? ORDER BY id LIMIT ?")
    .all(orgId, now(), limit)) as unknown as JobRow[];
}

export async function finishJob(id: number): Promise<void> {
  await db().prepare("DELETE FROM storage_jobs WHERE id = ?").run(id);
}

/** Try again later: 1, 2, 4 ... minutes, at most 6 hours apart. */
export async function retryJob(job: JobRow, error: string): Promise<void> {
  const delay = Math.min(2 ** job.attempts * 60_000, 6 * 3_600_000);
  await db()
    .prepare("UPDATE storage_jobs SET attempts = attempts + 1, last_error = ?, next_try_at = ? WHERE id = ?")
    .run(error.slice(0, 300), new Date(Date.now() + delay).toISOString(), job.id);
}

// ---- moves ----

export interface MoveRow {
  id: number;
  organization_id: number;
  from_storage_id: number | null;
  to_storage_id: number;
  reason: "default" | "remove";
  total: number;
  done: number;
  failed: number;
  state: "running" | "finished" | "closed";
  created_at: string;
  finished_at: string | null;
}

export async function listMoves(orgId: number): Promise<MoveRow[]> {
  return (await db()
    .prepare("SELECT * FROM storage_moves WHERE organization_id = ? AND state <> 'closed' ORDER BY id DESC")
    .all(orgId)) as unknown as MoveRow[];
}

export async function getMove(orgId: number, id: number): Promise<MoveRow | undefined> {
  return (await db().prepare("SELECT * FROM storage_moves WHERE id = ? AND organization_id = ?").get(id, orgId)) as MoveRow | undefined;
}
