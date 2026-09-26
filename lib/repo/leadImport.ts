import type { DatabaseSync } from "node:sqlite";
import { getDb, type LocationResolution } from "@/lib/db";

/** Bulk maps-link import: one job per paste, one row per link.
 *
 *  The decode runs detached from the request that started it (see lib/leadImport/runner.ts),
 *  so this repo is the only durable record of what has happened. Every read and write is
 *  scoped by organization_id, and `saved_location_id` is recorded on each item so the
 *  10-second undo is a scoped delete over rows this job alone created.
 *
 *  Counters on the job are denormalised deliberately: the panel polls once a second, and
 *  recomputing `done_count` from a thousand item rows on every poll would make the cheapest
 *  possible read the most expensive one. */

export type ImportJobStatus = "running" | "done" | "cancelled";
export type ImportStage = "parse" | "fast" | "browser" | "nominatim" | "finish";
export type ImportItemStatus =
  | "pending"
  | "resolving"
  | "done"
  | "unresolved"
  | "duplicate"
  | "skipped";
export type DuplicateKind = "location" | "customer" | "batch";

export interface ImportJobRow {
  id: number;
  organization_id: number;
  group_id: number | null;
  status: ImportJobStatus;
  stage: ImportStage;
  total: number;
  done_count: number;
  unresolved_count: number;
  duplicate_count: number;
  added_count: number;
  notified_at: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface ImportItemRow {
  id: number;
  job_id: number;
  ordinal: number;
  name: string;
  maps_url: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  resolved_url: string | null;
  resolution: LocationResolution;
  status: ImportItemStatus;
  duplicate_of: DuplicateKind | null;
  duplicate_name: string | null;
  saved_location_id: number | null;
}

const db = (): DatabaseSync => getDb();

export function createJob(
  organizationId: number,
  groupId: number | null,
  total: number
): number {
  return Number(
    db()
      .prepare(
        `INSERT INTO lead_import_jobs (organization_id, group_id, status, stage, total, created_at)
         VALUES (?, ?, 'running', 'parse', ?, ?)`
      )
      .run(organizationId, groupId, total, new Date().toISOString()).lastInsertRowid
  );
}

export function getJob(organizationId: number, jobId: number): ImportJobRow | undefined {
  return db()
    .prepare(`SELECT * FROM lead_import_jobs WHERE id = ? AND organization_id = ?`)
    .get(jobId, organizationId) as ImportJobRow | undefined;
}

/** The job a poll should attach to: the newest one still running, else the newest. */
export function latestJob(organizationId: number): ImportJobRow | undefined {
  return db()
    .prepare(
      `SELECT * FROM lead_import_jobs
        WHERE organization_id = ?
        ORDER BY (status = 'running') DESC, id DESC
        LIMIT 1`
    )
    .get(organizationId) as ImportJobRow | undefined;
}

/** The oldest job still marked running -- the queue head, so ordering is paste order. */
export function nextQueuedJob(organizationId: number): ImportJobRow | undefined {
  return db()
    .prepare(
      `SELECT * FROM lead_import_jobs
        WHERE organization_id = ? AND status = 'running'
        ORDER BY id ASC LIMIT 1`
    )
    .get(organizationId) as ImportJobRow | undefined;
}

export function addItems(
  organizationId: number,
  jobId: number,
  items: { name: string; mapsUrl: string }[]
): void {
  const conn = db();
  const stmt = conn.prepare(
    `INSERT INTO lead_import_items (organization_id, job_id, ordinal, name, maps_url)
     VALUES (?, ?, ?, ?, ?)`
  );
  conn.exec("BEGIN");
  try {
    items.forEach((it, i) => {
      stmt.run(organizationId, jobId, i, it.name ?? "", it.mapsUrl);
    });
    conn.exec("COMMIT");
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

export function listItems(organizationId: number, jobId: number): ImportItemRow[] {
  return db()
    .prepare(
      `SELECT * FROM lead_import_items
        WHERE job_id = ? AND organization_id = ?
        ORDER BY ordinal ASC`
    )
    .all(jobId, organizationId) as unknown as ImportItemRow[];
}

export function pendingItems(organizationId: number, jobId: number): ImportItemRow[] {
  return db()
    .prepare(
      `SELECT * FROM lead_import_items
        WHERE job_id = ? AND organization_id = ? AND status = 'pending'
        ORDER BY ordinal ASC`
    )
    .all(jobId, organizationId) as unknown as ImportItemRow[];
}

export function markResolving(organizationId: number, itemId: number): void {
  db()
    .prepare(
      `UPDATE lead_import_items SET status = 'resolving'
        WHERE id = ? AND organization_id = ? AND status = 'pending'`
    )
    .run(itemId, organizationId);
}

export interface ResolvedItemUpdate {
  lat: number | null;
  lng: number | null;
  address: string | null;
  resolvedUrl: string;
  resolution: LocationResolution;
  status: Extract<ImportItemStatus, "done" | "unresolved" | "duplicate" | "skipped">;
  duplicateOf?: DuplicateKind | null;
  duplicateName?: string | null;
}

export function markResolved(
  organizationId: number,
  itemId: number,
  update: ResolvedItemUpdate
): void {
  db()
    .prepare(
      `UPDATE lead_import_items
          SET lat = ?, lng = ?, address = ?, resolved_url = ?, resolution = ?,
              status = ?, duplicate_of = ?, duplicate_name = ?
        WHERE id = ? AND organization_id = ?`
    )
    .run(
      update.lat,
      update.lng,
      update.address,
      update.resolvedUrl,
      update.resolution,
      update.status,
      update.duplicateOf ?? null,
      update.duplicateName ?? null,
      itemId,
      organizationId
    );
}

/** Recomputes the job's counters from its items. Cheap enough at 1Hz for a 1000-row job
 *  and impossible to drift out of step with the items themselves. */
export function refreshCounters(organizationId: number, jobId: number): void {
  db()
    .prepare(
      `UPDATE lead_import_jobs SET
         done_count = (SELECT COUNT(*) FROM lead_import_items WHERE job_id = ? AND organization_id = ? AND status = 'done'),
         unresolved_count = (SELECT COUNT(*) FROM lead_import_items WHERE job_id = ? AND organization_id = ? AND status IN ('unresolved', 'duplicate')),
         duplicate_count = (SELECT COUNT(*) FROM lead_import_items WHERE job_id = ? AND organization_id = ? AND status = 'duplicate'),
         added_count = (SELECT COUNT(*) FROM lead_import_items WHERE job_id = ? AND organization_id = ? AND saved_location_id IS NOT NULL)
       WHERE id = ? AND organization_id = ?`
    )
    .run(
      jobId, organizationId,
      jobId, organizationId,
      jobId, organizationId,
      jobId, organizationId,
      jobId, organizationId
    );
}

export function setStage(organizationId: number, jobId: number, stage: ImportStage): void {
  db()
    .prepare(`UPDATE lead_import_jobs SET stage = ? WHERE id = ? AND organization_id = ?`)
    .run(stage, jobId, organizationId);
}

export function finishJob(
  organizationId: number,
  jobId: number,
  status: Extract<ImportJobStatus, "done" | "cancelled">
): void {
  db()
    .prepare(
      `UPDATE lead_import_jobs SET status = ?, stage = 'finish', finished_at = ?
        WHERE id = ? AND organization_id = ?`
    )
    .run(status, new Date().toISOString(), jobId, organizationId);
}

/** Marks the slow-job notification as sent. Returns false if another poll got there
 *  first, which is what keeps three open tabs to one notification. */
export function claimNotification(organizationId: number, jobId: number): boolean {
  const res = db()
    .prepare(
      `UPDATE lead_import_jobs SET notified_at = ?
        WHERE id = ? AND organization_id = ? AND notified_at IS NULL`
    )
    .run(new Date().toISOString(), jobId, organizationId);
  return res.changes > 0;
}

export function requestCancel(organizationId: number, jobId: number): void {
  db()
    .prepare(
      `UPDATE lead_import_jobs SET status = 'cancelled', finished_at = ?
        WHERE id = ? AND organization_id = ? AND status = 'running'`
    )
    .run(new Date().toISOString(), jobId, organizationId);
}

export function isCancelled(organizationId: number, jobId: number): boolean {
  const row = db()
    .prepare(`SELECT status FROM lead_import_jobs WHERE id = ? AND organization_id = ?`)
    .get(jobId, organizationId) as { status: ImportJobStatus } | undefined;
  return row?.status === "cancelled";
}

/** Every `running` job across all tenants -- the boot sweep that requeues work orphaned
 *  by a restart. Deliberately unscoped: it is a recovery pass over the whole table, not a
 *  tenant read, and it writes nothing but the status of rows it finds. */
export function orphanedJobs(): ImportJobRow[] {
  return db()
    .prepare(`SELECT * FROM lead_import_jobs WHERE status = 'running' ORDER BY id ASC`)
    .all() as unknown as ImportJobRow[];
}

export function linkSavedLocation(
  organizationId: number,
  itemId: number,
  savedLocationId: number
): void {
  db()
    .prepare(
      `UPDATE lead_import_items SET saved_location_id = ?
        WHERE id = ? AND organization_id = ?`
    )
    .run(savedLocationId, itemId, organizationId);
}

/** Undo: deletes only the saved_locations rows this job recorded, and only those still
 *  untouched. `visit_outcome IS NULL` is the guard -- a pin somebody has since visited is
 *  no longer this import's to remove, and the row is already somebody's record. */
export function undoJob(organizationId: number, jobId: number): number {
  const conn = db();
  const victims = conn
    .prepare(
      `SELECT i.saved_location_id AS id
         FROM lead_import_items i
         JOIN saved_locations l ON l.id = i.saved_location_id
        WHERE i.job_id = ? AND i.organization_id = ?
          AND l.organization_id = ? AND l.visit_outcome IS NULL`
    )
    .all(jobId, organizationId, organizationId) as unknown as { id: number }[];

  const del = conn.prepare(`DELETE FROM saved_locations WHERE id = ? AND organization_id = ?`);
  const unlink = conn.prepare(
    `UPDATE lead_import_items SET saved_location_id = NULL WHERE job_id = ? AND organization_id = ?`
  );
  conn.exec("BEGIN");
  try {
    // Unlink before deleting, not after: saved_location_id is a foreign key, so
    // removing the location row first leaves the item pointing at nothing and the
    // delete fails on the constraint.
    unlink.run(jobId, organizationId);
    for (const v of victims) del.run(v.id, organizationId);
    conn.exec("COMMIT");
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
  return victims.length;
}
