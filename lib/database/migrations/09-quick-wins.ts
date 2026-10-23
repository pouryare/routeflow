/* Migration era 09: the 2026-10-23 quick-wins batch (docs/roadmap.md section 1).
 *
 * - activity_log accepts products (F99) and two more event kinds, `created` and `updated`. SQLite
 *   cannot ALTER a CHECK, so the table is rebuilt from its own stored definition with the two
 *   lists widened; copying the stored SQL keeps the columns later eras appended, in order.
 * - users.must_change_password (F35): set when an owner creates an account or resets its password, so
 *   the first sign-in with a password someone else chose asks for a new one.
 * login_events (F110) is in the base schema, not here: it is in TENANT_TABLES, and the tenant
 * sweeps of eras 03 and 07 expect every listed table to exist when they run. */
import type { DatabaseSync } from "node:sqlite";

function widenActivityLog(db: DatabaseSync): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='activity_log'")
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'product'")) return;
  const widened = row.sql
    .replace(/CREATE TABLE\s+"?activity_log"?/, "CREATE TABLE activity_log_new")
    .replace("'lead_location')", "'lead_location', 'product')")
    .replace("'assigned')", "'assigned', 'created', 'updated')");
  if (!widened.includes("'product'") || !widened.includes("'created'")) {
    throw new Error("activity_log has an unexpected definition; widen it by hand");
  }
  db.exec("BEGIN");
  try {
    db.exec(widened);
    db.exec("INSERT INTO activity_log_new SELECT * FROM activity_log");
    db.exec("DROP TABLE activity_log");
    db.exec("ALTER TABLE activity_log_new RENAME TO activity_log");
    db.exec("CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id, created_at)");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function addMustChangePassword(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === "must_change_password")) return;
  db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
}

export function applyQuickWins(db: DatabaseSync): void {
  widenActivityLog(db);
  addMustChangePassword(db);
}
