/* Migration era 05: Territory (district and group ownership), visit plans, photos, the order status machine, district codes, the customer lifecycle and debt move, and folding lead pins and runs into customers and delivery runs.
 * Moved out of lib/db.ts's getDb() unchanged; the eras run in numeric order from ../migrate.ts and
 * each statement is idempotent (it inspects the live schema first). */
import type { DatabaseSync } from "node:sqlite";
import { foldLeadPinsIntoCustomers, backfillLegacyPayments } from "../backfills";
import { foldLeadRunsIntoDeliveryRuns, rebuildOrdersStatusMachine } from "../rebuilds";
import { backfillDistrictCentroids } from "../seeds";

export function applyTerritoryOrdersCustomers(db: DatabaseSync): void {
  // Territory. Nullable rather than NOT NULL: a district nobody has claimed yet is a
  // real state, and it is different from one deliberately given to a group.
  const districtGroupCols = db.prepare("PRAGMA table_info(districts)").all() as { name: string }[];
  if (!districtGroupCols.some((c) => c.name === "group_id")) {
    db.exec("ALTER TABLE districts ADD COLUMN group_id INTEGER REFERENCES groups(id)");
  }

  // A cache, not a source of truth -- recomputed from district containment by
  // recomputeCustomerGroups() whenever territory changes or customers are imported.
  // Stored rather than derived per query because deriving it means point-in-polygon
  // against 369 polygons per customer, per request.
  const customerGroupCols = db.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
  if (!customerGroupCols.some((c) => c.name === "group_id")) {
    db.exec("ALTER TABLE customers ADD COLUMN group_id INTEGER REFERENCES groups(id)");
  }

  // Group ownership for the tables that are owned outright rather than through what they
  // point at (spec §2.3 / Task 8). saved_locations, lead_lists and facilities each belong
  // to one group from the moment they are created, so they carry their own column and it
  // is stamped from the creating session.
  //
  // photos, reminders and visit_plans deliberately do NOT get one: their
  // (entity_type, entity_id) already names a customer, district or facility that carries
  // the group, so they join to it instead. That way a district changing hands takes its
  // reminders and photos with it, with no second copy of the truth to keep in step.
  for (const table of ["saved_locations", "lead_lists", "facilities"] as const) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "group_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN group_id INTEGER REFERENCES groups(id)`);
    }
  }

  // activity_log.changed_by holds a display name, so renaming someone rewrites their
  // history and two people with the same name are indistinguishable. Record the id too.
  const activityActorCols = db.prepare("PRAGMA table_info(activity_log)").all() as { name: string }[];
  if (!activityActorCols.some((c) => c.name === "changed_by_user_id")) {
    // changed_by stays: it is what the history UI renders, and it must keep reading
    // correctly for rows written before this column existed, which have no id to look up.
    db.exec("ALTER TABLE activity_log ADD COLUMN changed_by_user_id INTEGER REFERENCES users(id)");
  }

  // visit_plans shipped with entity_type restricted to district/customer. SQLite cannot
  // ALTER a CHECK, so widening it to accept a facility and lead_location means the standard rebuild:
  // new table, copy every row, drop, rename. Guarded on the constraint text so it runs
  // exactly once. Same dance saved_locations went through above.
  const visitPlansSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='visit_plans'")
    .get() as { sql: string } | undefined;
  if (visitPlansSchema && !visitPlansSchema.sql.includes("'lead_location'")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE visit_plans_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'facility', 'lead_location')),
          entity_id INTEGER NOT NULL,
          planned_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'skipped')),
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          purpose TEXT
        );
        INSERT INTO visit_plans_new SELECT * FROM visit_plans;
        DROP TABLE visit_plans;
        ALTER TABLE visit_plans_new RENAME TO visit_plans;
        CREATE INDEX IF NOT EXISTS idx_visit_plans_date ON visit_plans(planned_date);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // Phase 1 (Money): a POS / card-to-card payment can carry a receipt photo, so photos
  // must accept entity_type 'payment'. SQLite cannot ALTER a CHECK -- same rebuild the
  // visit_plans widening above uses, guarded on the constraint text so it runs once.
  const photosSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='photos'")
    .get() as { sql: string } | undefined;
  if (photosSchema && !photosSchema.sql.includes("'payment'")) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE photos_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'payment')),
          entity_id INTEGER NOT NULL,
          file_stem TEXT UNIQUE NOT NULL,
          caption TEXT,
          taken_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO photos_new SELECT id, entity_type, entity_id, file_stem, caption, taken_at, created_at FROM photos;
        DROP TABLE photos;
        ALTER TABLE photos_new RENAME TO photos;
        CREATE INDEX IF NOT EXISTS idx_photos_entity ON photos(entity_type, entity_id, taken_at);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  }

  // Phase 1 (Money): an order that breaches a direct customer's credit limit is parked
  // -- credit_hold = 1 -- until a credit_approvals decision releases it. No CHECK, so a
  // plain ADD COLUMN, guarded on the column's absence.
  const orderCols = db.prepare("PRAGMA table_info(orders)").all() as { name: string }[];
  if (!orderCols.some((c) => c.name === "credit_hold")) {
    db.exec("ALTER TABLE orders ADD COLUMN credit_hold INTEGER NOT NULL DEFAULT 0");
  }

  // Phase 3: widen orders.status from 'draft/confirmed/delivered/cancelled' to the
  // 12+2-state machine (lib/orderStateMachine.ts). Runs here, after the credit_hold
  // ADD COLUMN above, so the rebuild's value map can read credit_hold on every path.
  // Guarded on the CHECK already naming PENDING_REVIEW.
  rebuildOrdersStatusMachine(db);

  // Phase 3 (M6): delivery_line_batches gains a link to the deliveries row. Plain ADD,
  // nullable -- Phase 2's backfilled rows keep only delivery_stop_id; new code writes
  // both.
  const dlbCols = db.prepare("PRAGMA table_info(delivery_line_batches)").all() as { name: string }[];
  if (!dlbCols.some((c) => c.name === "delivery_id")) {
    db.exec("ALTER TABLE delivery_line_batches ADD COLUMN delivery_id INTEGER REFERENCES deliveries(id)");
  }


  const districtCentroidCols = db.prepare("PRAGMA table_info(districts)").all() as { name: string }[];
  if (!districtCentroidCols.some((c) => c.name === "centroid_lat")) {
    db.exec("ALTER TABLE districts ADD COLUMN centroid_lat REAL");
    db.exec("ALTER TABLE districts ADD COLUMN centroid_lng REAL");
  }
  backfillDistrictCentroids(db);

  // A short, speakable code per district, and the منطقه number as an integer.
  //
  // parent_no exists because the two source files spell the same district differently --
  // map.tehran.ir writes "منطقه ۱۴ شهر تهران" and our own mahalle.geojson writes "منطقه 14"
  // -- and UNIQUE(name, level, parent_name) joins on the name. An integer cannot be
  // spelled two ways, so the 369 محله resolve to their منطقه regardless of which file they
  // came from.
  //
  // The code index is PARTIAL-unique. A hand-drawn district (is_custom = 1) has no code
  // until an operator assigns one, and a hard UNIQUE would fail the moment two of them sat
  // blank -- which is exactly the state a freshly drawn district is in.
  //
  // Assigned by scripts/assign-district-codes.ts, never here. A code written during boot
  // would be recomputed on every seed, so a split would renumber existing districts and
  // every printed route sheet would silently point somewhere else.
  const districtCodeCols = db.prepare("PRAGMA table_info(districts)").all() as { name: string }[];
  if (!districtCodeCols.some((c) => c.name === "code")) {
    db.exec("ALTER TABLE districts ADD COLUMN code TEXT");
  }
  if (!districtCodeCols.some((c) => c.name === "parent_no")) {
    db.exec("ALTER TABLE districts ADD COLUMN parent_no INTEGER");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ix_districts_code ON districts(code) WHERE code IS NOT NULL");

  const customerCols = db.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
  if (!customerCols.some((c) => c.name === "last_purchase_date")) {
    db.exec("ALTER TABLE customers ADD COLUMN last_purchase_date TEXT");
  }

  // Phase 0b: the Excel customer importer is gone. Its bookkeeping tables go with it.
  // DROP IF EXISTS is idempotent and safe to run twice.
  db.exec("DROP TABLE IF EXISTS import_log;");
  db.exec("DROP TABLE IF EXISTS import_snapshots;");

  // Phase 0b M2: customers gains a lifecycle, a type, credit terms and a parent link,
  // and loses the free-text `status` column (its values map onto `lifecycle`). SQLite
  // cannot ALTER ADD a CHECK constraint, so this is a table rebuild -- guarded on the
  // new `lifecycle` column so it runs exactly once.
  const custM2Cols = (db.prepare("PRAGMA table_info(customers)").all() as { name: string }[]).map((c) => c.name);
  if (!custM2Cols.includes("lifecycle")) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE customers_m2_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_code TEXT NOT NULL,
          business_name TEXT NOT NULL,
          contact_person TEXT,
          phone TEXT,
          address TEXT,
          city TEXT,
          province TEXT,
          lat REAL,
          lng REAL,
          salesperson TEXT,
          debt_0_7 REAL DEFAULT 0,
          debt_8_30 REAL DEFAULT 0,
          debt_30_plus REAL DEFAULT 0,
          notes TEXT,
          synced_at TEXT NOT NULL,
          last_purchase_date TEXT,
          group_id INTEGER REFERENCES groups(id),
          credit_limit_toman INTEGER,
          organization_id INTEGER REFERENCES organizations(id),
          customer_type TEXT CHECK (customer_type IN
            ('RESTAURANT','HOTEL','CATERING','CAFE','RETAIL','WHOLESALE','OTHER')),
          lifecycle TEXT NOT NULL DEFAULT 'lead' CHECK (lifecycle IN
            ('lead','qualified','sampled','active','dormant','lost','blocked')),
          parent_customer_id INTEGER REFERENCES customers(id),
          payment_terms_days INTEGER NOT NULL DEFAULT 0,
          hard_credit_block INTEGER NOT NULL DEFAULT 0,
          qualified_at TEXT,
          first_order_at TEXT,
          UNIQUE (organization_id, customer_code)
        );
        INSERT INTO customers_m2_new
          (id, customer_code, business_name, contact_person, phone, address, city, province,
           lat, lng, salesperson, debt_0_7, debt_8_30, debt_30_plus, notes, synced_at,
           last_purchase_date, group_id, credit_limit_toman, organization_id, lifecycle)
        SELECT
          id, customer_code, business_name, contact_person, phone, address, city, province,
          lat, lng, salesperson, debt_0_7, debt_8_30, debt_30_plus, notes, synced_at,
          last_purchase_date, group_id, credit_limit_toman, organization_id,
          CASE TRIM(COALESCE(status,''))
            WHEN 'فعال' THEN 'active'
            WHEN 'مشتری فعال' THEN 'active'
            WHEN 'در حال پیگیری' THEN 'qualified'
            WHEN 'نمونه داده شد' THEN 'sampled'
            WHEN 'سرنخ' THEN 'lead'
            WHEN 'غیرفعال' THEN 'dormant'
            WHEN '' THEN 'lead'
            ELSE 'lead'
          END
        FROM customers;
        DROP TABLE customers;
        ALTER TABLE customers_m2_new RENAME TO customers;
        CREATE INDEX IF NOT EXISTS idx_customers_business_name ON customers(business_name);
        UPDATE customers
          SET first_order_at = (SELECT MIN(o.order_date) FROM orders o WHERE o.customer_id = customers.id)
          WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = customers.id);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
    console.info("[migrate] customers.status -> lifecycle applied; unknown values defaulted to 'lead'");
  }

  // Phase 1 (Money): customer debt is computed from orders now, not stored. The three
  // debt_* columns held demo figures (confirmed 2026-09-02), so they are dropped
  // outright -- no backfill. opening_balance_toman replaces them at 0 for every row; a
  // real pre-app balance is entered per customer through the normal patch path. SQLite
  // cannot DROP a column with an index/constraint cleanly across versions, so this is
  // the same rebuild the m2 block above uses, guarded on debt_0_7 still being present.
  const custDebtCols = (
    db.prepare("PRAGMA table_info(customers)").all() as { name: string }[]
  ).map((c) => c.name);
  if (custDebtCols.includes("debt_0_7")) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE customers_ob_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_code TEXT NOT NULL,
          business_name TEXT NOT NULL,
          contact_person TEXT,
          phone TEXT,
          address TEXT,
          city TEXT,
          province TEXT,
          lat REAL,
          lng REAL,
          salesperson TEXT,
          notes TEXT,
          synced_at TEXT NOT NULL,
          last_purchase_date TEXT,
          group_id INTEGER REFERENCES groups(id),
          credit_limit_toman INTEGER,
          organization_id INTEGER REFERENCES organizations(id),
          customer_type TEXT CHECK (customer_type IN
            ('RESTAURANT','HOTEL','CATERING','CAFE','RETAIL','WHOLESALE','OTHER')),
          lifecycle TEXT NOT NULL DEFAULT 'lead' CHECK (lifecycle IN
            ('lead','qualified','sampled','active','dormant','lost','blocked')),
          parent_customer_id INTEGER REFERENCES customers(id),
          payment_terms_days INTEGER NOT NULL DEFAULT 0,
          hard_credit_block INTEGER NOT NULL DEFAULT 0,
          qualified_at TEXT,
          first_order_at TEXT,
          opening_balance_toman INTEGER NOT NULL DEFAULT 0,
          UNIQUE (organization_id, customer_code)
        );
        INSERT INTO customers_ob_new
          (id, customer_code, business_name, contact_person, phone, address, city, province,
           lat, lng, salesperson, notes, synced_at, last_purchase_date, group_id,
           credit_limit_toman, organization_id, customer_type, lifecycle, parent_customer_id,
           payment_terms_days, hard_credit_block, qualified_at, first_order_at)
        SELECT
          id, customer_code, business_name, contact_person, phone, address, city, province,
          lat, lng, salesperson, notes, synced_at, last_purchase_date, group_id,
          credit_limit_toman, organization_id, customer_type, lifecycle, parent_customer_id,
          payment_terms_days, hard_credit_block, qualified_at, first_order_at
        FROM customers;
        DROP TABLE customers;
        ALTER TABLE customers_ob_new RENAME TO customers;
        CREATE INDEX IF NOT EXISTS idx_customers_business_name ON customers(business_name);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
    console.info("[migrate] customers.debt_* dropped; opening_balance_toman added (0)");
  }

  // customers.lead_location_id is the seam between a pin and the customer it became, and
  // it lives HERE rather than beside the other group_id columns further up, because this is
  // the last statement in the boot that touches the shape of `customers`.
  //
  // The two rebuilds above copy an explicit column list, so a column added before them is
  // silently dropped again: a fresh database runs both, and lead_location_id vanished the
  // first time this was written higher up in the file. Adding it after them means no rebuild
  // can undo it, and the guard makes it a no-op on every later boot.
  //
  // Why the column at all, and not the other direction. The convert route used to DELETE the
  // saved_locations row, which is defensible on its own terms -- a promoted venue is not a
  // prospect any more -- but lead_list_items.location_id is ON DELETE CASCADE, so the delete
  // quietly ripped the stop out of every route that referenced it, including the run the
  // driver was standing on. Keeping the pin and pointing the customer at it makes the
  // promotion reversible, keeps the visit history attached to the place it happened, and
  // gives the pool one honest test for "is this still a lead?" instead of a second flag on
  // saved_locations that could disagree with this one.
  const custLeadCols = db.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
  if (!custLeadCols.some((c) => c.name === "lead_location_id")) {
    db.exec("ALTER TABLE customers ADD COLUMN lead_location_id INTEGER REFERENCES saved_locations(id)");
  }
  // Promotions are rare and the lookup is by lead rather than by customer, so this index is
  // not on a hot path -- but it has to be unique per organisation, or two promotions of one
  // pin would both appear to succeed and the second customer would be unreachable.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_lead_location
           ON customers(organization_id, lead_location_id)
           WHERE lead_location_id IS NOT NULL`);

  /* Phase 0b: pins that reached a lead list become customers.
   *
   * This used to run ONCE, guarded on an `app_meta` marker, and that guard was the bug.
   * The fold's predicate is "a pin that is in a lead list" — a fact about ROWS, not
   * about time. A one-shot marker makes it time-dependent: any qualifying row that
   * arrives after the marker is written is never promoted, on any future boot, however
   * long it waits. Which page shows a given lead was then a function of WHEN it was
   * added, and /leads (MANAGE_ROLES, pins) and /crm (CRM_ROLES, customers) could
   * permanently disagree about where it lives. The code permitted that forever, and
   * nothing reconciled the two.
   *
   * So it runs on every boot. The fold is idempotent (ON CONFLICT DO NOTHING on the
   * LEAD-<id> code, the same scheme the manual convert uses, so it cannot collide), and
   * it skips any pin a live lead-run stop points at rather than cascading it away. The
   * cost is a couple of indexed queries per boot; the marker it replaces was saving work
   * at the price of correctness.
   *
   * The old key is left in app_meta untouched — a marker nobody reads is harmless, and
   * deleting it would be a migration for no gain. */
  /* Phase 2 (mixed-route planning): one run per driver-day, holding orders AND visits.
   *
   *  Runs IMMEDIATELY BEFORE the lead-pin fold below, and that is load-bearing rather than
   *  tidy. That fold deletes a pin unless a live run stop protects it, and its query joins
   *  lead_run_stops -> delivery_runs (Phase 2 changed the join target). On a database not yet
   *  folded, lead_run_stops.run_id still holds lead_runs ids, so the join matches NOTHING,
   *  every stop looks unprotected, and the fold deletes pins that are on a live route.
   *
   *  Measured on backups/routeflow-2026-09-30T19-12-20-846Z.db: 58 stops across 6 runs, and 0
   *  id collisions between the two tables. With the join reading lead_runs the pin fold found
   *  0 deletable pins; with it reading delivery_runs before this function ran, it found 31 —
   *  then died on FOREIGN KEY constraint failed, so the whole migration could not boot.
   *
   *  The order is the difference between deleting a driver's assigned work and not.
   *  `foldLeadRunsIntoDeliveryRuns` is a no-op once the table is gone, so calling it first
   *  costs nothing on every boot after the first. */
  foldLeadRunsIntoDeliveryRuns(db);

  foldLeadPinsIntoCustomers(db);

  // Phase 1: give every legacy paid_toman a payment row to stand on before the derived
  // recompute can zero it.
  backfillLegacyPayments(db);
}
