/* Migration era 07: The second tenant sweep, ledger and stock backfills, delivery-run and vehicle columns, requested day, prediction, offline ids, board and pocket, per-order figures, and the final indexes.
 * Moved out of lib/db.ts's getDb() unchanged; the eras run in numeric order from ../migrate.ts and
 * each statement is idempotent (it inspects the live schema first). */
import type { DatabaseSync } from "node:sqlite";
import type { Db } from "../client";
import { backfillOrderFigures } from "../../repo/orderFigures";
import { migrateCrm } from "../../repo/crm/migrate";
import { TENANT_TABLES } from "../tenantTables";
import {
  seedAccounts,
  migratePurchaseSuppliers,
  backfillLedger,
  backfillStockLedger,
  backfillOrderEvents,
  backfillReminderTasks,
} from "../backfills";
import { rebuildDeliveryRunsStatus } from "../rebuilds";

export async function applyLedgersAndLateColumns(db: DatabaseSync, adb: Db): Promise<void> {
  // A second sweep, run last and every boot. The first one above (right after the
  // ALTER) exists so seedFacilities sees already-backfilled rows and can correctly
  // recognise them as already seeded; this one is the safety net for whatever runs
  // between here and there -- today that is seedFacilities itself, and the point of
  // running this every boot is that it stays correct for whatever gets added later
  // without anyone having to remember to update this comment.
  for (const table of TENANT_TABLES) {
    // reason_codes is the one exception: a NULL organization_id there is deliberate --
    // it marks a system-default row every tenant shares -- not a row that missed the
    // tenancy backfill.
    if (
      table === "reason_codes" ||
      table === "capacity_factors" ||
      table === "rules" ||
      table === "notification_types" ||
      table === "objection_cards" ||
      table === "kpi_definitions" ||
      table === "seasonal_factors" ||
      table === "churn_models"
    )
      continue;
    db.exec(`UPDATE ${table} SET organization_id = 1 WHERE organization_id IS NULL`);
  }

  // Seed the chart of accounts before any ledger backfill can need an account id. Not
  // guarded on an app_meta marker: seedAccounts is itself idempotent by code, so running it
  // on every boot is what guarantees a row added to the chart in a later release reaches
  // every database, including one that booted a hundred times before that release.
  seedAccounts(db);

  // purchases gains supplier_id and the legacy free-text supplier becomes real rows. Must
  // run AFTER the suppliers table exists (schema block above) and BEFORE any purchase is
  // recorded, so a receipt recorded on a fresh database already has a supplier_id.
  migratePurchaseSuppliers(db);

  // Turn existing payments into ledger postings. After seedAccounts (it needs account
  // ids) and BEFORE any live payment path can write, so the cutover in Task 4 never races
  // the history it is supposed to sit on top of.
  await backfillLedger(db, adb);

  // Phase 2: convert legacy purchases + deliveries into the stock-movement ledger, once.
  backfillStockLedger(db);

  // Phase 3: give every legacy order a synthetic 'create' event so its timeline is not
  // blank. After backfillStockLedger so a fresh boot has done all its table rebuilds.
  backfillOrderEvents(db);

  // Phase 5 (Routing): delivery_runs gains the planning + optimisation record. Plain ADD
  // COLUMN, guarded per column.
  const drCols = (db.prepare("PRAGMA table_info(delivery_runs)").all() as { name: string }[]).map(
    (c) => c.name
  );
  const drAdds: [string, string][] = [
    ["vehicle_id", "INTEGER REFERENCES vehicles(id)"],
    ["route_template_id", "INTEGER REFERENCES route_templates(id)"],
    ["planned_distance_km", "REAL"],
    ["actual_distance_km", "REAL"],
    ["planned_duration_min", "INTEGER"],
    ["actual_duration_min", "INTEGER"],
    ["capacity_stops", "INTEGER"],
    ["weather_json", "TEXT"],
    ["optimisation_json", "TEXT"],
    ["frozen_at", "TEXT"],
  ];
  for (const [col, type] of drAdds) {
    if (!drCols.includes(col)) db.exec(`ALTER TABLE delivery_runs ADD COLUMN ${col} ${type}`);
  }

  /* Phase 8: a van holds stock, so a vehicle needs to point at the facility where its stock
   * lives. Nullable on purpose — a vehicle with no facility simply has no stock of its own and
   * everything it delivers comes off the depot, which is how the app behaved before this phase
   * and has to keep working. */
  const vehCols = (db.prepare("PRAGMA table_info(vehicles)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!vehCols.includes("facility_id")) {
    db.exec("ALTER TABLE vehicles ADD COLUMN facility_id INTEGER REFERENCES facilities(id)");
  }
  // A 'ready' status between 'planned' and 'in_progress' -- the run is frozen but the
  // driver has not started. CHECK change -> a guarded rebuild.
  //
  // Runs AFTER foldLeadRunsIntoDeliveryRuns (called ~380 lines earlier, ahead of the pin
  // fold): the fold inserts into delivery_runs, so this rebuild must not be about to replace
  // the table those rows just landed in.
  rebuildDeliveryRunsStatus(db);

  // Phase 1 (mixed-route planning): the day a customer asked an order to be delivered on.
  //
  // NULL here is NOT "unset" and it is NOT a boolean -- it IS «در اولین فرصت», the state
  // that says nobody has committed this order to a day yet. That is the whole reason there is
  // no `is_asap` column: a second flag would have to be kept in step with this one forever,
  // and the two would eventually disagree about which orders are urgent.
  //
  // The day-splitter's raw material is exactly the set where this is NULL, so an existing
  // database needs no backfill: every order already in it is uncommitted, which is true.
  //
  // requested_kind records WHICH control the reader used, so «هفتهٔ بعد» still reads as a week
  // after it has been resolved to a concrete date — a customer who said "next week" was not
  // told 2026-10-10.
  //
  // Both plain ADD COLUMN, guarded per column. No rebuild: neither is NOT NULL and neither
  // needs an index. The CHECK on requested_kind governs NEW rows only, which is correct --
  // every existing row is NULL and passes.
  const reqDayCols = db.prepare("PRAGMA table_info(orders)").all() as { name: string }[];
  if (!reqDayCols.some((c) => c.name === "requested_day")) {
    db.exec("ALTER TABLE orders ADD COLUMN requested_day TEXT");
  }
  if (!reqDayCols.some((c) => c.name === "requested_kind")) {
    db.exec(
      "ALTER TABLE orders ADD COLUMN requested_kind TEXT CHECK (requested_kind IN ('soonest', 'week_offset', 'exact_date'))"
    );
  }

  const prodVolCols = (db.prepare("PRAGMA table_info(products)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!prodVolCols.includes("volume_m3_per_base_unit")) {
    db.exec("ALTER TABLE products ADD COLUMN volume_m3_per_base_unit REAL");
  }

  // Phase 10 (Prediction): learned capacity factors sit beside the shipped/tuned ones.
  // resolvedCapacityFactorsFor uses the learned value only once learned_n >= MIN_LEARN_N,
  // so a fresh column set (learned_n = 0) leaves every Phase 6 reading unchanged.
  const cfCols = (db.prepare("PRAGMA table_info(capacity_factors)").all() as { name: string }[]).map(
    (c) => c.name
  );
  const cfAdds: [string, string][] = [
    ["learned_stop_factor", "REAL"],
    ["learned_speed_factor", "REAL"],
    ["learned_service_time_factor", "REAL"],
    ["learned_max_duration_factor", "REAL"],
    ["learned_n", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [col, type] of cfAdds) {
    if (!cfCols.includes(col)) db.exec(`ALTER TABLE capacity_factors ADD COLUMN ${col} ${type}`);
  }

  // Phase 4 (Offline-first): client_uuid on every offline-writable table. No CHECK, so a
  // plain ADD COLUMN + a *partial* UNIQUE index (WHERE client_uuid IS NOT NULL) -- every
  // legacy NULL row is fine and the migration is O(1) per table. UNIQUE buys idempotency
  // for free. Runs last, after every table rebuild, so nothing drops the column.
  for (const t of ["orders", "payments", "deliveries", "customers"]) {
    const cuCols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
    if (!cuCols.some((c) => c.name === "client_uuid")) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN client_uuid TEXT`);
    }
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS ix_${t}_client_uuid ON ${t}(client_uuid) WHERE client_uuid IS NOT NULL`
    );
  }

  // Board & Pocket: two nullable columns. tasks.stage is the per-kind pipeline stage
  // for the board's workflow lens -- NULL means "derive from status" (lib/tasks/lenses).
  // users.prefs_json holds { board_mobile_mode, board_default_view } -- server-side so a
  // member's board choice follows them across devices.
  const bpTaskCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  if (!bpTaskCols.some((c) => c.name === "stage")) {
    db.exec("ALTER TABLE tasks ADD COLUMN stage TEXT");
  }
  // Phase 7 status is open|done|dismissed -- no "in progress". The Board's status lens
  // needs a middle column that works for every kind, so a task is "in progress" when
  // started_at is set and it is not yet done. Plain ADD COLUMN; status semantics for
  // listTasks / the briefing are unchanged (a started task is still status='open').
  if (!bpTaskCols.some((c) => c.name === "started_at")) {
    db.exec("ALTER TABLE tasks ADD COLUMN started_at TEXT");
  }
  const bpUserCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!bpUserCols.some((c) => c.name === "prefs_json")) {
    db.exec("ALTER TABLE users ADD COLUMN prefs_json TEXT");
  }
  // Fold existing customer reminders into the tasks spine (once, guarded).
  backfillReminderTasks(db);
  await migrateCrm(adb);

  /* Per-order figures (weight, total, cost), stored so the commission ledgers, the debt pass and
     the dashboard do not have to re-add every line of every order on each request (see
     lib/repo/orderFigures.ts).

     They are a CACHE of something derivable from order_lines, so they must never be trusted when
     they could be stale. These triggers void all three on any insert, update or delete of a line;
     the writers that know better (creating an order, recording a delivery, splitting a
     back-order) refill them straight away, and everything else is refilled by the backfill just
     below. A reader that finds one empty works it out from the lines itself.

     The first version of this cached only the weight, under order_lines_void_kg_*. Those are
     dropped by name because CREATE TRIGGER IF NOT EXISTS would leave a database that already has
     them voiding only one of the three columns.

     If a future migration rebuilds `orders` or `order_lines`, drop these triggers first and let
     this block recreate them: SQLite refuses a RENAME while a trigger names a missing table. */
  const figureCols = (db.prepare("PRAGMA table_info(orders)").all() as { name: string }[]).map((c) => c.name);
  if (!figureCols.includes("kg_total")) db.exec("ALTER TABLE orders ADD COLUMN kg_total REAL");
  if (!figureCols.includes("total_toman")) db.exec("ALTER TABLE orders ADD COLUMN total_toman INTEGER");
  if (!figureCols.includes("cost_toman")) db.exec("ALTER TABLE orders ADD COLUMN cost_toman INTEGER");
  db.exec(`
    DROP TRIGGER IF EXISTS order_lines_void_kg_insert;
    DROP TRIGGER IF EXISTS order_lines_void_kg_update;
    DROP TRIGGER IF EXISTS order_lines_void_kg_delete;
    CREATE TRIGGER IF NOT EXISTS order_lines_void_figures_insert AFTER INSERT ON order_lines
    BEGIN UPDATE orders SET kg_total = NULL, total_toman = NULL, cost_toman = NULL WHERE id = NEW.order_id; END;
    CREATE TRIGGER IF NOT EXISTS order_lines_void_figures_update AFTER UPDATE ON order_lines
    BEGIN UPDATE orders SET kg_total = NULL, total_toman = NULL, cost_toman = NULL WHERE id IN (OLD.order_id, NEW.order_id); END;
    CREATE TRIGGER IF NOT EXISTS order_lines_void_figures_delete AFTER DELETE ON order_lines
    BEGIN UPDATE orders SET kg_total = NULL, total_toman = NULL, cost_toman = NULL WHERE id = OLD.order_id; END;
  `);
  /* Per-customer order history in date order (customer health, first order): the status rides along so
     the whole read is answered from the index, already sorted. Created here, not beside the other
     orders indexes, because organization_id is added to orders by a later migration. */
  db.exec(
    "CREATE INDEX IF NOT EXISTS ix_orders_org_customer_date ON orders(organization_id, customer_id, order_date, status)"
  );
  await backfillOrderFigures(adb);
}
