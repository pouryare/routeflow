import type { DatabaseSync } from "node:sqlite";

/** Clear the ledger so a test fixture can reset the tables it owns.
 *
 *  `journals` and `ledger_entries` are APPEND-ONLY by trigger -- that is the feature, and
 *  it is why a posted receipt can never be quietly edited or removed. But it collides with
 *  the teardown convention here: forty suites run `DELETE FROM customers` in their own
 *  `beforeEach`, and `ledger_entries.customer_id` REFERENCES `customers(id)`. Once
 *  `recordPayment` posts a receipt, deleting that customer is a FOREIGN KEY failure --
 *  verified in a standalone probe: `DELETE FROM customers` raises
 *  `FOREIGN KEY constraint failed`, and clearing the children first succeeds.
 *
 *  Call it BEFORE the suite's own teardown statement. Order is half the fix: the FK error
 *  happens inside that statement, so a call placed after it never runs.
 *
 *  The teardown order is children before parents. That is a FIXTURE resetting state the
 *  application never can, which is legitimate; what would not be legitimate is dropping
 *  the FK or the triggers so the fixture became convenient at the cost of the guarantee.
 *
 *  `DELETE FROM ledger_entries` fails here for the same reason the app fails, so the
 *  tables are dropped and recreated from `sqlite_master`'s own DDL. Dropping a table does
 *  not fire its DELETE triggers, and the DDL is read back rather than written out twice,
 *  so this cannot drift from the schema the app actually has.
 *
 *  **Scope warning — this must only ever be called with a TEST database handle.** Many
 *  suites in `tests/` do not set `ROUTEFLOW_DB_PATH`, so `getDb()` in those files opens the
 *  real `data/routeflow.db`. A global `setupFiles` hook calling this would therefore drop
 *  and recreate the ledger tables in production on every test run. That was tried and
 *  reverted; see `.cline/journal.md`. Keep this an explicit, per-suite call. */
export function clearLedger(db: DatabaseSync): void {
  const ddl = (name: string) =>
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) as { sql: string } | undefined;

  const tables = ["ledger_entries", "journals", "fiscal_periods"] as const;
  const saved = tables.map((t) => [t, ddl(t)] as const);

  db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const [t] of saved) db.exec(`DROP TABLE IF EXISTS ${t}`);
    for (const [, row] of saved) if (row?.sql) db.exec(row.sql);
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }

  // The sequences restart too, so a fixture that asserts on a literal journal id is not
  // coupled to how many rows a previous test happened to leave behind.
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('journals','ledger_entries','fiscal_periods')");
}
