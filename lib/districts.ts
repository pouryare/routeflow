import type { DatabaseSync } from "node:sqlite";
import { District, getDb } from "./db";
import { DistrictProperties } from "./types";

/** Shared by GET /api/districts and the server-rendered map page, so both produce a
 *  byte-identical property list -- the page's initial data and the client's first
 *  refetch must agree or the map would flicker through a spurious re-render on load. */
export function readDistrictProperties(db: DatabaseSync = getDb()): DistrictProperties[] {
  const rows = db
    .prepare(
      `SELECT id, name, level, parent_name, coverage_status, notes, is_custom, updated_at, assigned_to
       FROM districts ORDER BY level, parent_name, name`
    )
    .all() as unknown as District[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    level: r.level,
    parent_name: r.parent_name,
    coverage_status: r.coverage_status,
    notes: r.notes,
    is_custom: !!r.is_custom,
    updated_at: r.updated_at,
    assigned_to: r.assigned_to,
  }));
}
