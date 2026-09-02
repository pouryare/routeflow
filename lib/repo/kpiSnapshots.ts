/** The `kpi_snapshots` read / write path.
 *
 *  Part 2 of the plan makes this a *requirement*, not an optimisation: `DatabaseSync`
 *  is synchronous, so one unbounded scan freezes every concurrent request. Analytics
 *  therefore reads precomputed rows written by a sweep (`refreshAll`, added in a later
 *  task) and never scans `orders` to render a page.
 *
 *  This module owns the primitive upsert + point read. The per-metric calculators and
 *  the board query build on top of it.
 */

import { getDb } from "@/lib/db";

export type ScopeType =
  | "org"
  | "group"
  | "salesperson"
  | "driver"
  | "customer"
  | "product"
  | "representative";

export interface SnapshotScope {
  scope_type: ScopeType;
  /** 0 for `scope_type: 'org'`; the entity id otherwise. */
  scope_id?: number;
}

export interface SnapshotValue {
  value: number;
  numerator?: number | null;
  denominator?: number | null;
  sample_size?: number | null;
}

export interface SnapshotWrite extends SnapshotScope, SnapshotValue {
  metric: string;
  period: string;
}

/** Idempotent: the UNIQUE `(organization_id, metric, scope_type, scope_id, period)`
 *  turns a re-run of the same period into an overwrite, not a duplicate. */
export function upsertSnapshot(organizationId: number, w: SnapshotWrite): void {
  getDb()
    .prepare(
      `INSERT INTO kpi_snapshots
         (organization_id, metric, scope_type, scope_id, period, value,
          numerator, denominator, sample_size, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, metric, scope_type, scope_id, period)
       DO UPDATE SET value = excluded.value,
                     numerator = excluded.numerator,
                     denominator = excluded.denominator,
                     sample_size = excluded.sample_size,
                     computed_at = excluded.computed_at`
    )
    .run(
      organizationId,
      w.metric,
      w.scope_type,
      w.scope_id ?? 0,
      w.period,
      w.value,
      w.numerator ?? null,
      w.denominator ?? null,
      w.sample_size ?? null,
      new Date().toISOString()
    );
}

/** Write several snapshots in one transaction — the sweep's unit of work. */
export function upsertSnapshots(organizationId: number, writes: SnapshotWrite[]): number {
  const db = getDb();
  db.exec("BEGIN");
  try {
    for (const w of writes) upsertSnapshot(organizationId, w);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return writes.length;
}

/** One indexed row, or null when the sweep has not written it yet. */
export function snapshot(
  organizationId: number,
  metric: string,
  scope: SnapshotScope & { period: string }
): number | null {
  const row = getDb()
    .prepare(
      `SELECT value FROM kpi_snapshots
        WHERE organization_id = ? AND metric = ? AND scope_type = ? AND scope_id = ? AND period = ?`
    )
    .get(
      organizationId,
      metric,
      scope.scope_type,
      scope.scope_id ?? 0,
      scope.period
    ) as { value: number } | undefined;
  return row ? row.value : null;
}

/** The full row (value + parts + freshness), for a drill-down that re-aggregates. */
export interface SnapshotRow extends SnapshotValue {
  metric: string;
  scope_type: ScopeType;
  scope_id: number;
  period: string;
  computed_at: string;
}

export function snapshotRows(
  organizationId: number,
  filter: { period?: string; metric?: string; scope_type?: ScopeType }
): SnapshotRow[] {
  const where = ["organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (filter.period) {
    where.push("period = ?");
    params.push(filter.period);
  }
  if (filter.metric) {
    where.push("metric = ?");
    params.push(filter.metric);
  }
  if (filter.scope_type) {
    where.push("scope_type = ?");
    params.push(filter.scope_type);
  }
  return getDb()
    .prepare(
      `SELECT metric, scope_type, scope_id, period, value, numerator, denominator, sample_size, computed_at
         FROM kpi_snapshots WHERE ${where.join(" AND ")}`
    )
    .all(...(params as never[])) as SnapshotRow[];
}

/** The newest `computed_at` across a period's snapshots — the page's "as of …" line. */
export function newestComputedAt(organizationId: number, period: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(computed_at) AS t FROM kpi_snapshots WHERE organization_id = ? AND period = ?`
    )
    .get(organizationId, period) as { t: string | null };
  return row.t;
}
