/** A real warehouse, for tests that need one.
 *
 *  `defaultFacilityId` used to INSERT a warehouse named «انبار» at lat 0, lng 0 when a tenant
 *  had none, and that behaviour is gone. It was Null Island: a place nobody made, which then
 *  satisfied "is there a warehouse?" and quietly became the default stock location for the
 *  whole tenant. Tests that never cared where their stock lived were relying on it.
 *
 *  So this seeds one properly — inside Tehran, at a real coordinate — rather than restoring
 *  the lie. Call it right after the `getDb` import; it is idempotent.
 *
 *  What it must NEVER do is re-add the auto-create inside lib/. That would put the warehouse
 *  back for real users, where it is exactly the bug that was removed. */
import type { DatabaseSync } from "node:sqlite";

export function ensureWarehouse(db: DatabaseSync, organizationId = 1): void {
  const existing = db
    .prepare("SELECT id FROM facilities WHERE organization_id = ? AND kind = 'warehouse'")
    .get(organizationId) as { id: number } | undefined;
  if (existing) return;

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO facilities
       (organization_id, slug, name, kind, lat, lng, created_at, updated_at)
     VALUES (?, ?, ?, 'warehouse', ?, ?, ?, ?)`
  ).run(
    organizationId,
    `test-warehouse-${organizationId}`,
    "انبار آزمایش",
    35.7,
    51.4,
    now,
    now
  );
}