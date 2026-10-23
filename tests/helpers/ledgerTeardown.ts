import type { Db } from "@/lib/database/client";

import { mapSeq } from "@/lib/seq";
import { dialect } from "@/lib/database/dialect";
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
  /* PostgreSQL: replica mode skips the append-only triggers and the foreign-key checks for
     this one statement batch, and the identities restart as sqlite_sequence's rows did. */
  if (dialect() === "postgres") {
    await db.exec(
      `SET session_replication_role = replica;
       DELETE FROM ledger_entries; DELETE FROM journals; DELETE FROM fiscal_periods;
       SET session_replication_role = DEFAULT;
       ALTER TABLE ledger_entries ALTER COLUMN id RESTART; ALTER TABLE journals ALTER COLUMN id RESTART;
       ALTER TABLE fiscal_periods ALTER COLUMN id RESTART;`
    );
    return;
  }
  const ddl = async (name: string) =>
    await db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) as { sql: string } | undefined;

  const tables = ["ledger_entries", "journals", "fiscal_periods"] as const;
  const saved = await mapSeq(tables, async (t) => [t, await ddl(t)] as const);

  await db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const [t] of saved) await db.exec(`DROP TABLE IF EXISTS ${t}`);
    for (const [, row] of saved) if (row?.sql) await db.exec(row.sql);
  } finally {
    await db.exec("PRAGMA foreign_keys = ON");
  }

  // The sequences restart too, so a fixture that asserts on a literal journal id is not
  // coupled to how many rows a previous test happened to leave behind.
  await db.exec("DELETE FROM sqlite_sequence WHERE name IN ('journals','ledger_entries','fiscal_periods')");
}

/** Drops a guard trigger so a fixture can reset an append-only table such as `activities`.
 *  PostgreSQL names triggers per table, so its DROP TRIGGER needs the table too. */
export async function dropTrigger(db: Db, name: string, table: string): Promise<void> {
  await db.exec(dialect() === "postgres" ? `DROP TRIGGER IF EXISTS ${name} ON ${table}` : `DROP TRIGGER IF EXISTS ${name}`);
}
