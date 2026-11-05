/** Background work on company storages (docs/storage.md sections 4 and 5): queued jobs (send held
 *  files, mirror copies, moves, removing old copies after a move), the daily check and trash purge,
 *  and the weekly spot-check and usage correction. Run by `/api/storages/sweep`. */

import { getDb } from "@/lib/db";
import {
  addUsage, dueJobs, finishJob, getMove, listStorages, logStorageEvent, notifyOwners, queueJob, recentEvent, recordCheck,
  retryJob, setStorageState, setUsage, updateStoredFile, listRules, replaceRules, type JobRow, type StorageRow,
  type StoredFileRow,
} from "@/lib/repo/storages";
import { cacheEvict } from "./cache";
import { contentTypeOf, copyToMirror, driverFor, eraseFile, keyFor, sendHeld, settingsOf, testStorage } from "./files";
import { s3ErrorReason } from "./s3";

const db = () => getDb();
const now = () => new Date().toISOString();
const TRASH_DAYS = 30;
const MAX_ATTEMPTS = 8;

async function fileById(id: number): Promise<StoredFileRow | undefined> {
  return (await db().prepare("SELECT * FROM stored_files WHERE id = ?").get(id)) as StoredFileRow | undefined;
}

// ---- moves (decisions 9 and 18) ----

/** Starts moving every file on `fromId` (null: the dev disk) to `toId`. For a removal the storage
 *  stops taking new files at once and is removed when the move reaches 100%. Returns the move id. */
export async function startMove(orgId: number, fromId: number | null, toId: number, reason: "default" | "remove", userId: number | null): Promise<number> {
  const files = (await db()
    .prepare(
      `SELECT id FROM stored_files WHERE organization_id = ? AND storage_id IS NOT DISTINCT FROM ? AND deleted_at IS NULL
         AND upload_state = 'stored'`
    )
    .all(orgId, fromId)) as { id: number }[];
  const r = await db()
    .prepare(
      `INSERT INTO storage_moves (organization_id, from_storage_id, to_storage_id, reason, total, started_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(orgId, fromId, toId, reason, files.length, userId, now());
  const moveId = Number(r.lastInsertRowid);
  if (fromId != null) {
    // New files go to the new storage at once: every rule that pointed at the old one now points at the new one.
    const rules = await listRules(orgId);
    await replaceRules(
      orgId,
      rules
        .map((x) => ({
          ...x,
          storage_id: x.storage_id === fromId ? toId : x.storage_id,
          mirror_storage_id: reason === "remove" && x.mirror_storage_id === fromId ? null : x.mirror_storage_id,
        }))
        .map((x) => ({ ...x, mirror_storage_id: x.mirror_storage_id === x.storage_id ? null : x.mirror_storage_id })),
    );
    if (reason === "remove") {
      await setStorageState(orgId, fromId, "moving_out");
      await db().prepare("UPDATE storages SET overflow_storage_id = NULL WHERE organization_id = ? AND overflow_storage_id = ?").run(orgId, fromId);
    }
  }
  for (const f of files) await queueJob(orgId, "move", f.id, moveId);
  await logStorageEvent(orgId, fromId, "move_started", `${files.length} فایل`, userId);
  if (files.length === 0) await finishMoveIfDone(orgId, moveId);
  return moveId;
}

async function finishMoveIfDone(orgId: number, moveId: number): Promise<void> {
  const r = await db()
    .prepare(
      `UPDATE storage_moves SET state = 'finished', finished_at = ? WHERE id = ? AND organization_id = ? AND state = 'running'
         AND done + failed >= total`
    )
    .run(now(), moveId, orgId);
  if (Number(r.changes) === 0) return;
  const m = await getMove(orgId, moveId);
  if (!m) return;
  await logStorageEvent(orgId, m.from_storage_id, "move_done", `${m.done} از ${m.total} فایل منتقل شد${m.failed ? `، ${m.failed} فایل نشد` : ""}`);
  await notifyOwners(orgId, "انتقال فایل‌ها تمام شد", `${m.done} از ${m.total} فایل منتقل شد.`, `storage.move.${moveId}`);
  if (m.reason === "remove" && m.failed === 0 && m.from_storage_id != null) await removeIfEmpty(orgId, m.from_storage_id, null);
}

/** Closes a finished move; with `deleteOld` the copies left in the old storage are removed in the background. */
export async function closeMove(orgId: number, moveId: number, deleteOld: boolean): Promise<boolean> {
  const m = await getMove(orgId, moveId);
  if (!m || m.state !== "finished") return false;
  await db().prepare("UPDATE storage_moves SET state = 'closed' WHERE id = ? AND organization_id = ?").run(moveId, orgId);
  if (deleteOld && m.from_storage_id != null) {
    const files = (await db()
      .prepare("SELECT id FROM stored_files WHERE organization_id = ? AND last_move_id = ?")
      .all(orgId, moveId)) as { id: number }[];
    for (const f of files) await queueJob(orgId, "purge", f.id, moveId);
  }
  return true;
}

/** Removes a storage that holds nothing (decision 18): no file lives on it and none is moving. */
export async function removeIfEmpty(orgId: number, storageId: number, userId: number | null): Promise<boolean> {
  const busy = await db()
    .prepare(
      `SELECT 1 FROM stored_files WHERE organization_id = ? AND storage_id = ? AND deleted_at IS NULL LIMIT 1`
    )
    .get(orgId, storageId);
  if (busy) return false;
  // Mirror copies on it are simply no longer counted; trashed files on it are erased first.
  const trashed = (await db()
    .prepare("SELECT * FROM stored_files WHERE organization_id = ? AND storage_id = ? AND deleted_at IS NOT NULL")
    .all(orgId, storageId)) as unknown as StoredFileRow[];
  for (const f of trashed) {
    await eraseFile(f).catch(() => {});
    await db().prepare("DELETE FROM stored_files WHERE id = ?").run(f.id);
  }
  await db()
    .prepare("UPDATE stored_files SET mirror_storage_id = NULL, mirror_state = 'none' WHERE organization_id = ? AND mirror_storage_id = ?")
    .run(orgId, storageId);
  const rules = await listRules(orgId);
  await replaceRules(orgId, rules.filter((r) => r.storage_id !== storageId).map((r) => ({ ...r, mirror_storage_id: r.mirror_storage_id === storageId ? null : r.mirror_storage_id })));
  await db().prepare("UPDATE storages SET overflow_storage_id = NULL WHERE organization_id = ? AND overflow_storage_id = ?").run(orgId, storageId);
  await setStorageState(orgId, storageId, "removed");
  await logStorageEvent(orgId, storageId, "removed", null, userId);
  return true;
}

async function moveOne(f: StoredFileRow, moveId: number): Promise<void> {
  const m = await getMove(f.organization_id, moveId);
  if (!m) return;
  const all = await listStorages(f.organization_id, true);
  const to = all.find((s) => s.id === m.to_storage_id) ?? null;
  if (!to) throw new Error("فضای مقصد پیدا نشد");
  if (f.storage_id !== m.to_storage_id) {
    const from = all.find((s) => s.id === f.storage_id) ?? null;
    const mirror = all.find((s) => s.id === f.mirror_storage_id) ?? null;
    for (const ext of f.variants.split(",")) {
      let body = await driverFor(from).get(keyFor(from, f, ext)).catch(() => null);
      if (!body && mirror && f.mirror_state === "done") body = await driverFor(mirror).get(keyFor(mirror, f, ext));
      if (!body) throw new Error("فایل در فضای قبلی پیدا نشد");
      await driverFor(to).put(keyFor(to, f, ext), body, contentTypeOf(ext));
      if ((await driverFor(to).head(keyFor(to, f, ext))) !== body.length) throw new Error("فایل در فضای تازه درست ذخیره نشد");
    }
    await updateStoredFile(f.id, { storage_id: to.id, last_move_id: moveId });
    if (from) await addUsage(f.organization_id, from.id, -f.bytes, -1);
    await addUsage(f.organization_id, to.id, f.bytes, 1);
  }
  await db().prepare("UPDATE storage_moves SET done = done + 1 WHERE id = ?").run(moveId);
  await finishMoveIfDone(f.organization_id, moveId);
}

async function purgeOldCopy(f: StoredFileRow, moveId: number): Promise<void> {
  const m = await getMove(f.organization_id, moveId);
  if (!m || m.from_storage_id == null || f.storage_id === m.from_storage_id) return;
  const from = (await listStorages(f.organization_id, true)).find((s) => s.id === m.from_storage_id) ?? null;
  if (!from || from.state === "removed" && !from.secret_enc) return;
  for (const ext of f.variants.split(",")) await driverFor(from).remove(keyFor(from, f, ext));
}

// ---- the queue ----

async function runJob(job: JobRow): Promise<void> {
  const f = await fileById(job.stored_file_id);
  if (!f) return finishJob(job.id);
  try {
    if (job.kind === "upload") {
      if (f.upload_state !== "held") return finishJob(job.id);
      if (!await sendHeld(f)) return retryJob(job, "فضا پر است");
    } else if (job.kind === "mirror") {
      if (f.mirror_state === "done" || !f.mirror_storage_id) return finishJob(job.id);
      if (f.upload_state === "held") return retryJob(job, "فایل هنوز روی سرور نگه داشته شده");
      await copyToMirror(f);
    } else if (job.kind === "move" && job.move_id) {
      await moveOne(f, job.move_id);
    } else if (job.kind === "purge" && job.move_id) {
      await purgeOldCopy(f, job.move_id);
    }
    await finishJob(job.id);
  } catch (e) {
    const reason = e instanceof Error && /[؀-ۿ]/.test(e.message) ? e.message : s3ErrorReason(e);
    if (job.attempts + 1 >= MAX_ATTEMPTS) {
      await finishJob(job.id);
      if (job.kind === "mirror") await updateStoredFile(f.id, { mirror_state: "failed" });
      if (job.kind === "move" && job.move_id) {
        await db().prepare("UPDATE storage_moves SET failed = failed + 1 WHERE id = ?").run(job.move_id);
        await finishMoveIfDone(f.organization_id, job.move_id);
      }
      if (job.kind === "upload") await queueJob(f.organization_id, "upload", f.id, null, 6 * 3_600_000); // a held file is never dropped
      return;
    }
    await retryJob(job, reason);
  }
}

/** Runs due jobs for one company; returns how many ran. */
export async function runStorageJobs(orgId: number, limit = 200): Promise<number> {
  const jobs = await dueJobs(orgId, limit);
  for (const j of jobs) await runJob(j);
  return jobs.length;
}

// ---- checks ----

/** The save-time test again, on a stored storage (decision 7, daily). */
export async function checkStorage(orgId: number, s: StorageRow): Promise<string | null> {
  let error: string | null;
  try {
    const r = await testStorage(s.kind, s.kind === "s3" ? settingsOf(s) : null, s.path_prefix);
    error = r.ok ? null : r.reason;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const wasFailing = !!s.last_check_error;
  await recordCheck(orgId, s.id, error);
  if (error && !await recentEvent(orgId, s.id, "check_failed", 20 * 60)) {
    await logStorageEvent(orgId, s.id, "check_failed", error);
    await notifyOwners(orgId, `فضای «${s.name}» کار نمی‌کند`, error, `storage.check.${s.id}`);
  } else if (!error && wasFailing) {
    await logStorageEvent(orgId, s.id, "check_ok", null);
  }
  return error;
}

/** Erases files in the trash for more than 30 days (decision 12). */
export async function purgeTrash(orgId: number, at = new Date()): Promise<number> {
  const cutoff = new Date(at.getTime() - TRASH_DAYS * 86_400_000).toISOString();
  const old = (await db()
    .prepare("SELECT * FROM stored_files WHERE organization_id = ? AND deleted_at IS NOT NULL AND deleted_at < ? ORDER BY id LIMIT 1000")
    .all(orgId, cutoff)) as unknown as StoredFileRow[];
  let n = 0;
  for (const f of old) {
    try {
      await eraseFile(f);
      await db().prepare("DELETE FROM stored_files WHERE id = ?").run(f.id);
      n++;
    } catch {
      /* the storage is down: tried again tomorrow */
    }
  }
  if (n) await logStorageEvent(orgId, null, "purged", `${n} فایل از سطل زباله پاک شد`);
  return n;
}

/** Files held on the server for over an hour get one notice (decision 5). */
async function warnHeld(orgId: number): Promise<void> {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const row = (await db()
    .prepare("SELECT COUNT(*) AS n FROM stored_files WHERE organization_id = ? AND upload_state = 'held' AND held_since < ?")
    .get(orgId, since)) as { n: number };
  if (Number(row.n) > 0 && !await recentEvent(orgId, null, "held", 24 * 60)) {
    await logStorageEvent(orgId, null, "held", `${row.n} فایل بیش از یک ساعت روی سرور مانده`);
    await notifyOwners(orgId, "فایل‌ها به فضای ذخیره‌سازی نرسیده‌اند", `${row.n} فایل بیش از یک ساعت روی سرور مانده است. تنظیمات فضا را بررسی کنید.`, "storage.held");
  }
}

export async function dailySweep(orgId: number): Promise<{ checked: number; failed: number; purged: number }> {
  const storages = (await listStorages(orgId)).filter((s) => s.state !== "removed");
  let failed = 0;
  for (const s of storages) if (await checkStorage(orgId, s)) failed++;
  const purged = await purgeTrash(orgId);
  await warnHeld(orgId);
  return { checked: storages.length, failed, purged };
}

/** Removes cache files not read for 7 days; once per server, not per company. */
export const evictCache = () => cacheEvict();

/** Decision 21: 100 random files, each copy asked for by HEAD. And the usage numbers recounted. */
export async function weeklySweep(orgId: number, sample = 100): Promise<{ checked: number; missing: number }> {
  const files = (await db()
    .prepare(
      `SELECT * FROM stored_files WHERE organization_id = ? AND deleted_at IS NULL AND upload_state = 'stored' AND storage_id IS NOT NULL
        ORDER BY random() LIMIT ?`
    )
    .all(orgId, sample)) as unknown as StoredFileRow[];
  const all = await listStorages(orgId, true);
  let missing = 0;
  for (const f of files) {
    const ext = f.variants.split(",")[0];
    const copies = [all.find((s) => s.id === f.storage_id) ?? null];
    if (f.mirror_storage_id && f.mirror_state === "done") copies.push(all.find((s) => s.id === f.mirror_storage_id) ?? null);
    for (const s of copies) {
      if (!s) continue;
      const size = await driverFor(s).head(keyFor(s, f, ext)).catch(() => undefined);
      if (size === null) {
        missing++;
        await logStorageEvent(orgId, s.id, "file_missing", `${f.file_kind} ${f.stem}`);
      }
    }
  }
  if (missing) await notifyOwners(orgId, "چند فایل در فضای ذخیره‌سازی پیدا نشد", `${missing} فایل از ${files.length} نمونه پیدا نشد. فهرست در گزارش فضای ذخیره‌سازی است.`, "storage.missing");
  // Usage drifts when someone deletes by hand in the provider's panel: recount from the bucket.
  for (const s of all.filter((x) => x.state !== "removed" && x.kind === "s3")) {
    try {
      let bytes = 0;
      for await (const o of driverFor(s).list(s.path_prefix)) if (!o.key.includes("/.check/")) bytes += o.bytes;
      const count = (await db()
        .prepare("SELECT COUNT(*) AS n FROM stored_files WHERE organization_id = ? AND deleted_at IS NULL AND (storage_id = ? OR (mirror_storage_id = ? AND mirror_state = 'done'))")
        .get(orgId, s.id, s.id)) as { n: number };
      await setUsage(orgId, s.id, bytes, Number(count.n));
    } catch {
      /* a storage that cannot be listed keeps its counted numbers */
    }
  }
  return { checked: files.length, missing };
}
