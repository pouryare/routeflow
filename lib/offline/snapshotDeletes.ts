/** Which offline snapshot rows a pull's tombstones remove.
 *
 *  A tombstone names the deleted row by `entity_type` and `entity_id`. The server writes the
 *  table name as the entity type (`delivery_stops`), the same name the pull uses for the
 *  snapshot table; an older singular spelling (`order_line`) is accepted too. A type that
 *  matches no snapshot table is ignored: that row was never copied to the device.
 *
 *  A key that the same pull also sends as a row is left alone. The pull reads its rows and
 *  tombstones in one synchronous pass, so a row it sends exists now, and a tombstone for the
 *  same id is an older delete whose id was later reused. Dropping that key here means the
 *  order the device applies deletes and writes in cannot remove a live row. */

/** Every table `pullSince` (lib/repo/syncPull.ts) can send. */
const SNAPSHOT_TABLES: ReadonlySet<string> = new Set([
  "products",
  "packagings",
  "product_prices",
  "delivery_runs",
  "delivery_stops",
  "lead_run_stops",
  "run_facility_stops",
  "facilities",
  "run_unload_lines",
  "saved_locations",
  "orders",
  "order_lines",
  "customers",
  "deliveries",
]);

type SnapshotKey = readonly [table: string, id: number];

export function snapshotTableFor(entityType: string): string | null {
  if (SNAPSHOT_TABLES.has(entityType)) return entityType;
  if (SNAPSHOT_TABLES.has(`${entityType}s`)) return `${entityType}s`;
  return null;
}

export function snapshotDeletes(
  tombstones: readonly { entity_type: string; entity_id: number }[],
  rows: readonly { table: string; row: Record<string, unknown> }[]
): SnapshotKey[] {
  const sent = new Set(rows.map((r) => `${r.table}:${String(r.row.id)}`));
  const out = new Map<string, SnapshotKey>();
  for (const t of tombstones) {
    const table = snapshotTableFor(t.entity_type);
    if (!table) continue;
    const key = `${table}:${t.entity_id}`;
    if (sent.has(key)) continue;
    out.set(key, [table, t.entity_id]);
  }
  return [...out.values()];
}
