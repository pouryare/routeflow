/* Moves old history into the archive twins: one statement per batch, which deletes the rows and
 * inserts the same rows into the twin together, so a row is never in both or neither. Runs as
 * "system" from the nightly sweep (every company at once; the cutoff is the platform's). */
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/database/client";
import { archiveCutoff, DEFAULT_HOT_MONTHS, MONTHLY_ARCHIVE, validHotMonths } from "@/lib/historyArchive";

const KEY = "archive_hot_months";

export async function archiveHotMonths(db: Db = getDb()): Promise<number> {
  const r = (await db.prepare("SELECT value FROM app_meta WHERE key = ?").get(KEY)) as { value: string } | undefined;
  const n = Number(r?.value);
  return validHotMonths(n) ? n : DEFAULT_HOT_MONTHS;
}

export async function setArchiveHotMonths(months: number, db: Db = getDb()): Promise<void> {
  await db
    .prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
    .run(KEY, String(months));
}

/** One batch of `table` rows older than `before` into `table`_archive; the number moved. */
async function moveBatch(db: Db, table: string, time: string, also: string, before: string, batch: number): Promise<number> {
  const r = await db
    .prepare(
      `WITH moved AS (
         DELETE FROM ${table}
          WHERE id IN (SELECT id FROM ${table} WHERE ${time} < ? ${also} ORDER BY id LIMIT ?)
         RETURNING *)
       INSERT INTO ${table}_archive SELECT * FROM moved`
    )
    .run(before, batch);
  return Number(r.changes);
}

/** Moves everything older than the hot months, in batches so no statement holds locks for long.
 *  Returns how many rows each table moved. */
export async function archiveHistory(today: string, batch = 5000, db: Db = getDb()): Promise<Record<string, number>> {
  const before = archiveCutoff(today, await archiveHotMonths(db));
  const out: Record<string, number> = {};
  for (const t of MONTHLY_ARCHIVE) {
    let total = 0;
    for (;;) {
      const n = await moveBatch(db, t.table, t.time, t.also, before, batch);
      total += n;
      if (n < batch) break;
    }
    out[t.table] = total;
  }
  return out;
}
