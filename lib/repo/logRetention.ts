/* FB41: keep-for-N-days per log (lib/logRetention.ts), a preview of what the next purge deletes, and the purge
 * itself (nightly, from the worker). Platform-wide like the history archive: one number per log for the server.
 * Runs as "system" for row-level security. */
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/database/client";
import { PURGEABLE_LOGS, keepCutoff, validKeepDays, type PurgeableLog } from "@/lib/logRetention";

const key = (id: string) => `retention_days:${id}`;

async function keepDays(log: PurgeableLog, db: Db = getDb()): Promise<number> {
  const r = (await db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key(log.id))) as { value: string } | undefined;
  const n = Number(r?.value);
  return validKeepDays(n) ? n : log.defaultDays;
}

/** false when `id` is not a purgeable log or `days` is out of range. */
export async function setKeepDays(id: string, days: number, db: Db = getDb()): Promise<boolean> {
  if (!PURGEABLE_LOGS.some((l) => l.id === id) || !validKeepDays(days)) return false;
  await db
    .prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
    .run(key(id), String(days));
  return true;
}

export interface RetentionRow {
  id: string;
  label: string;
  days: number;
  /** How many rows tonight's purge would delete. */
  rows: number;
}

export async function retentionPreview(now = new Date(), db: Db = getDb()): Promise<RetentionRow[]> {
  const out: RetentionRow[] = [];
  for (const log of PURGEABLE_LOGS) {
    const days = await keepDays(log, db);
    const r = (await db
      .prepare(`SELECT count(*) AS n FROM ${log.table} WHERE ${log.time} < ? ${log.also}`)
      .get(keepCutoff(now, days))) as { n: number | string };
    out.push({ id: log.id, label: log.label, days, rows: Number(r.n) });
  }
  return out;
}

/** Deletes what the preview counted, in batches so no statement holds locks for long. */
export async function purgeLogs(now = new Date(), batch = 5000, db: Db = getDb()): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const log of PURGEABLE_LOGS) {
    const before = keepCutoff(now, await keepDays(log, db));
    let total = 0;
    for (;;) {
      const r = await db
        .prepare(`DELETE FROM ${log.table} WHERE ctid IN (SELECT ctid FROM ${log.table} WHERE ${log.time} < ? ${log.also} LIMIT ?)`)
        .run(before, batch);
      total += Number(r.changes);
      if (Number(r.changes) < batch) break;
    }
    out[log.id] = total;
  }
  return out;
}
