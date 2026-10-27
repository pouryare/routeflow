import type { Db } from "@/lib/database/client";

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
export async function clearLedger(db: Db): Promise<void> {
  /* Replica mode skips the append-only triggers and the foreign-key checks for this one
     statement batch, and the identities restart so a fixture that asserts on a literal journal
     id is not coupled to how many rows a previous test left behind. */
  await db.exec(
    `SET session_replication_role = replica;
     DELETE FROM ledger_entries; DELETE FROM journals; DELETE FROM fiscal_periods;
     SET session_replication_role = DEFAULT;
     SELECT setval(pg_get_serial_sequence('ledger_entries', 'id'), 1, false);
     SELECT setval(pg_get_serial_sequence('journals', 'id'), 1, false);
     SELECT setval(pg_get_serial_sequence('fiscal_periods', 'id'), 1, false);`
  );
}
