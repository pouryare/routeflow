import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import type { FacilityRow } from "./facilityTypes";
import type { Role } from "./roles";
import type { CustomerLifecycle, CustomerType } from "./types";
import { polygonCentroid } from "./simplify";
import type { DistrictGeometry } from "./simplify";

// Re-exported so server modules that already import from db.ts keep one import site.
export type { FacilityKind, FacilityRow } from "./facilityTypes";
export { FACILITY_KINDS } from "./facilityTypes";

const DB_PATH = process.env.COVERAGE_DB_PATH || path.join(process.cwd(), "data", "coverage.db");

let _db: DatabaseSync | null = null;

/** Rows from node:sqlite, made safe to hand to a client component.
 *
 *  `DatabaseSync.prepare().all()` returns objects with a **null prototype**. React
 *  refuses to serialise those across the server/client boundary -- "Only plain objects,
 *  and a few built-ins, can be passed to Client Components" -- and the page 500s at
 *  render time. Nothing in the types sees it: a null-prototype object satisfies every
 *  interface it structurally matches, so tsc, eslint and every unit test pass while the
 *  page is broken. It only shows up in a browser.
 *
 *  So any query result that crosses into a `"use client"` component goes through here
 *  first. Results that only ever render on the server do not need it.
 */
export function plain<T>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

/** Tables whose rows belong to exactly one tenant and are scoped by organization_id.
 *
 *  A table not on this list and not in the exemption set in
 *  tests/tenancy-schema.test.ts fails the build. That is deliberate: the failure mode
 *  this list prevents is a table added later with no tenant column, which is readable
 *  by every organisation and looks like nothing at all until a second tenant is on the
 *  system.
 *
 *  Child tables are absent on purpose -- order_lines reaches its tenant through orders,
 *  and a second copy of the answer is a second thing to keep in step. */
export const TENANT_TABLES = [
  "groups",
  "customers",
  "districts",
  "facilities",
  "saved_locations",
  "lead_lists",
  "products",
  "orders",
  "purchases",
  "delivery_runs",
  "commission_rates",
  "commission_payments",
  "driver_commission_rates",
  "driver_commission_payments",
  "manager_commission_overrides",
  "manager_commission_payments",
  "representative_profiles",
  "credit_approvals",
] as const satisfies readonly string[];

/** Rebuild a table so a globally-UNIQUE natural key becomes unique per tenant instead.
 *
 *  SQLite cannot ALTER a constraint, so the only route is the same one this file already
 *  uses for the salesperson and platform_owner role widenings: build the replacement,
 *  copy every row, drop, rename. Guarded on the *constraint text* rather than on a
 *  column, because the columns are unchanged here -- it is only the uniqueness that
 *  moves.
 *
 *  Foreign keys are suspended for the copy. With them on, DROP TABLE would either fail
 *  or cascade into whatever references this table, depending on the pragma, and neither
 *  is what a rename wants -- the schema those referents see is unchanged either way. */
function rebuildForTenantUnique(
  db: DatabaseSync,
  table: string,
  marker: string,
  createSql: string
): void {
  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | undefined;
  if (!schema || schema.sql.includes(marker)) return;

  const tableCols = (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[])
    .map((c) => `"${c.name}"`)
    .join(", ");

  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    db.exec(`
      ${createSql}
      INSERT INTO ${table}_tn_new (${tableCols}) SELECT ${tableCols} FROM ${table};
      DROP TABLE ${table};
      ALTER TABLE ${table}_tn_new RENAME TO ${table};
    `);
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

/** Phase 0b: a pin that made it into a lead list is a relationship worth tracking, not
 *  just a dot on the map. Promote each such saved_location to a `customers` row
 *  (`lifecycle='lead'`, code `LEAD-<id>` -- the same scheme /api/locations/[id]/convert
 *  uses, so it cannot collide with a manually-converted pin) and delete the pin and its
 *  list membership. Pins in no list stay as pins. Idempotent: `ON CONFLICT DO NOTHING`
 *  on the code, so a second run is a no-op. */
export function foldLeadPinsIntoCustomers(db: DatabaseSync): void {
  const pins = db
    .prepare(
      `SELECT DISTINCT s.id, s.name, s.address, s.lat, s.lng, s.notes, s.group_id, s.organization_id
         FROM saved_locations s
         JOIN lead_list_items i ON i.location_id = s.id`
    )
    .all() as Array<{
    id: number;
    name: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
    notes: string | null;
    group_id: number | null;
    organization_id: number;
  }>;
  if (pins.length === 0) return;

  const insert = db.prepare(
    `INSERT INTO customers (customer_code, business_name, address, lat, lng, notes,
                            lifecycle, group_id, organization_id, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, 'lead', ?, ?, ?)
     ON CONFLICT (organization_id, customer_code) DO NOTHING`
  );
  const now = new Date().toISOString();

  db.exec("BEGIN");
  try {
    for (const p of pins) {
      insert.run(`LEAD-${p.id}`, p.name, p.address, p.lat, p.lng, p.notes, p.group_id, p.organization_id, now);
      db.prepare("DELETE FROM lead_list_items WHERE location_id = ?").run(p.id);
      db.prepare("DELETE FROM saved_locations WHERE id = ?").run(p.id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getDb(): DatabaseSync {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_code TEXT UNIQUE NOT NULL,
      business_name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      province TEXT,
      lat REAL,
      lng REAL,
      status TEXT,
      salesperson TEXT,
      debt_0_7 REAL DEFAULT 0,
      debt_8_30 REAL DEFAULT 0,
      debt_30_plus REAL DEFAULT 0,
      notes TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS districts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('mantaghe', 'mahalle')),
      parent_name TEXT,
      boundary_geojson TEXT NOT NULL,
      coverage_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (coverage_status IN ('visited', 'needs_coverage', 'not_allowed', 'unknown')),
      notes TEXT,
      is_custom INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(name, level, parent_name)
    );

    /* Tiny key/value store for one-shot migration markers and the like. Not tenant data. */
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer')),
      entity_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('status_change', 'note', 'assigned')),
      old_value TEXT,
      new_value TEXT,
      note TEXT,
      changed_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id, created_at);

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer')),
      entity_id INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      message TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(resolved, due_date);

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer')),
      entity_id INTEGER NOT NULL,
      file_stem TEXT UNIQUE NOT NULL,
      caption TEXT,
      taken_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photos_entity ON photos(entity_type, entity_id, taken_at);

    CREATE TABLE IF NOT EXISTS visit_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer')),
      entity_id INTEGER NOT NULL,
      planned_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'skipped')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_visit_plans_date ON visit_plans(planned_date);

    CREATE INDEX IF NOT EXISTS idx_customers_business_name ON customers(business_name);
    CREATE INDEX IF NOT EXISTS idx_districts_name ON districts(name);

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT,
      sale_date TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      product_name TEXT,
      qty REAL,
      amount REAL NOT NULL DEFAULT 0,
      payment_status TEXT,
      shipping_status TEXT,
      imported_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_name, sale_date);
    CREATE INDEX IF NOT EXISTS idx_sales_product ON sales(customer_name, product_name);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    /* A tenant. RouteFlow is sold to other distributors, so one database holds several
       independent companies; organization_id on every business table is the boundary
       between them, and lib/session.ts is where it is enforced. Seeded with exactly one
       row for the company this database was built for -- see the migration below. */
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      plan TEXT NOT NULL DEFAULT 'standard',
      active INTEGER NOT NULL DEFAULT 1,
      contact_name TEXT,
      contact_phone TEXT,
      created_at TEXT NOT NULL
    );

    /* One row per time a platform_owner (the vendor) reads a tenant's data that is not
       their own. Support access that leaves a trace is a different thing from support
       access that does not: if a tenant asks what was looked at, the answer is a query
       rather than a recollection. Written by lib/platformAccess.ts. */
    CREATE TABLE IF NOT EXISTS platform_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_user_id INTEGER NOT NULL REFERENCES users(id),
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      path TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );

    /* Phase 0b M2: a representative IS a wholesale customer (customer_type='WHOLESALE',
       its own lifecycle) plus this managed-relationship record. One Order table serves
       both direct customers and reps. */
    CREATE TABLE IF NOT EXISTS representative_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      rep_code TEXT NOT NULL,
      manager_user_id INTEGER REFERENCES users(id),
      contract_signed_at TEXT,
      contract_expires_at TEXT,
      exclusivity_territory_id INTEGER REFERENCES districts(id),
      stage TEXT NOT NULL DEFAULT 'prospect' CHECK (stage IN
        ('prospect','qualified','negotiating','documents','approved','onboarding','active','dormant','terminated')),
      activated_at TEXT,
      first_order_at TEXT,
      credit_terms_days INTEGER NOT NULL DEFAULT 0,
      discount_tier TEXT,
      monthly_target_kg REAL,
      monthly_target_toman INTEGER,
      health_score REAL,
      health_computed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, customer_id),
      UNIQUE (organization_id, rep_code)
    );

    /* Phase 0b M2: an order that breaches a direct customer's credit limit parks here
       for a manager to approve or reject. Direct customers only -- reps buy on cash or
       bank cheque, so the flow refuses a rep customer at request time. The automatic
       "order over limit -> PENDING_CREDIT" trigger arrives with the order state machine
       in Phase 3; for now this is a table plus a manual decide surface. */
    CREATE TABLE IF NOT EXISTS credit_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      order_id INTEGER NOT NULL REFERENCES orders(id),
      requested_by INTEGER NOT NULL REFERENCES users(id),
      requested_at TEXT NOT NULL,
      customer_balance_toman INTEGER NOT NULL,
      credit_limit_toman INTEGER,
      overage_toman INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
      decided_by INTEGER REFERENCES users(id),
      decided_at TEXT,
      reason TEXT
    );

    /* Reaches a tenant through representative_profiles, so it is not in TENANT_TABLES. */
    CREATE TABLE IF NOT EXISTS representative_onboarding_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      representative_id INTEGER NOT NULL REFERENCES representative_profiles(id) ON DELETE CASCADE,
      step_code TEXT NOT NULL,
      label_fa TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      completed_by INTEGER REFERENCES users(id),
      notes TEXT,
      UNIQUE (representative_id, step_code)
    );

    /* A group is one management team covering part of Tehran province. Territory is
       expressed by assigning districts to a group (districts.group_id), not by drawing
       new geometry -- the 22 منطقه and 369 محله polygons are already surveyed, and a
       second boundary system would be a second thing to disagree with the first. */
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      color TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'group_manager'
        CHECK (role IN ('platform_owner', 'owner', 'group_manager', 'rep_manager', 'salesperson', 'driver')),
      group_id INTEGER REFERENCES groups(id),
      organization_id INTEGER REFERENCES organizations(id),
      staff_code TEXT,
      phone TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      token_version INTEGER NOT NULL DEFAULT 0,
      location_consent_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      maps_url TEXT UNIQUE NOT NULL,
      address TEXT,
      lat REAL,
      lng REAL,
      resolution TEXT NOT NULL DEFAULT 'unresolved'
        CHECK (resolution IN ('direct', 'pluscode', 'nominatim', 'manual', 'unresolved')),
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_locations_name ON saved_locations(name);

    /* Named, hand-ordered lists of prospect locations -- "امشب", "غرب تهران", whatever
       the user calls them. The automatic day-split proposes groupings; these are the
       answer to not liking what it proposed.

       In the database rather than in localStorage on purpose: a route being driven has
       to survive the phone restarting mid-round, and a list built on the laptop has to
       be there on the phone in the van. */
    CREATE TABLE IF NOT EXISTS lead_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    /* Membership is ordered, because the order *is* the route. ON DELETE CASCADE on both
       sides: a deleted list takes its membership with it, and a location removed from
       the prospect list stops appearing in every list that held it rather than becoming
       a row pointing at nothing. */
    CREATE TABLE IF NOT EXISTS lead_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES saved_locations(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (list_id, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lead_list_items_list ON lead_list_items(list_id, sort_order);

    CREATE TABLE IF NOT EXISTS facilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('warehouse', 'home_base', 'other')),
      name TEXT NOT NULL,
      address TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      maps_url TEXT,
      notes TEXT,
      is_default_origin INTEGER NOT NULL DEFAULT 0,
      owner_username TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_facilities_kind ON facilities(kind);

    /* ---- The sales catalogue ------------------------------------------------------
       Company-wide, deliberately with no group_id. Two groups selling different
       products would be two businesses; the column would only ever be null, and a
       nullable scope column that is always null is an invitation to write a filter
       against it later and empty everyone's screen. */
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      base_unit TEXT NOT NULL DEFAULT 'عدد',
      /* عدد -> kg. Commission is paid per kilogram, so this factor is payroll input,
         which is why an order line freezes it rather than reading it back later. */
      kg_per_base_unit REAL NOT NULL DEFAULT 0,
      /* Moving average, maintained by purchase receipts. Whole Toman, like every money
         column added from here on -- see lib/money.ts for why the legacy REAL columns
         were left alone but must not spread. */
      avg_cost_toman INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    /* How the product is sold: «جعبه بچه (۱۲۰ عددی)», «کارتن ۲۴ تایی».

       qty_per_pack lives on the product/packaging pair rather than on the name, because
       the name is not unique across products in the real data: «جعبه بچه» is 120 عدد of
       one brand and 100 عدد of another, and both are rows in the workbook today. */
    CREATE TABLE IF NOT EXISTS packagings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      qty_per_pack REAL NOT NULL,
      barcode TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE (product_id, name)
    );

    /* Prices over time. Changing a price is an INSERT here; a row is never UPDATEd.
       That is what stops last month's revenue moving when this month's price is set --
       the failure mode of the single price cell this replaces. */
    CREATE TABLE IF NOT EXISTS product_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      /* Null means the price covers every packaging of the product -- the common case
         when a product is sold one way. */
      packaging_id INTEGER REFERENCES packagings(id) ON DELETE CASCADE,
      price_toman INTEGER NOT NULL,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_product_prices_lookup
      ON product_prices(product_id, packaging_id, valid_from);
    CREATE INDEX IF NOT EXISTS idx_packagings_product ON packagings(product_id);

    /* ---- Orders ------------------------------------------------------------------
       The table that replaces the paper. Sales were never recorded in the workbook --
       they were written on slips -- so there is nothing to migrate into this and no
       dual-running period, which is why it is worth building now rather than later.

       group_id is stamped from the customer when the order is created rather than
       joined at read time, the same pattern saved_locations and lead_lists use. A
       customer moving territory must not move last month's orders with it: the order
       belongs to whoever's territory it was sold in. */
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      /* Allocated by the server inside the insert transaction. Hand-typed numbers
         collide the moment two people record at once. Latin digits -- see
         formatOrderNo in lib/orderMath.ts. */
      order_no TEXT UNIQUE NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      group_id INTEGER REFERENCES groups(id),
      /* Who the order is credited to for commission. Not necessarily who typed it:
         today the manager records what the cold-call فروشنده sold. */
      salesperson_user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'delivered', 'cancelled')),
      order_date TEXT NOT NULL,
      delivered_at TEXT,
      payment_status TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
      paid_toman INTEGER NOT NULL DEFAULT 0,
      /* Non-null means the order was taken past the customer's credit limit, and by
         whom. The limit warns rather than blocks, so this is the record of the
         override -- a warning nobody can be shown to have ignored is not a control. */
      credit_override_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, order_date);
    CREATE INDEX IF NOT EXISTS idx_orders_scope ON orders(group_id, status, order_date);
    CREATE INDEX IF NOT EXISTS idx_orders_salesperson ON orders(salesperson_user_id, order_date);

    /* The snapshot columns below are written once and never recomputed. That is the
       whole mechanism: product_prices answers "what do we charge now", and these answer
       "what did this order actually cost", and only having both makes a retroactive
       correction a deliberate, visible act instead of an invisible side effect.

       qty_per_pack and kg_per_base_unit are frozen here rather than joined for the same
       reason: a box revised from 120 to 100 عدد must not change what an old order
       weighed, because commission was already paid on the original figure. */
    CREATE TABLE IF NOT EXISTS order_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      packaging_id INTEGER NOT NULL REFERENCES packagings(id),
      packs_ordered REAL NOT NULL,
      /* Null until the driver confirms. Zero is a real answer -- the customer refused
         the line at the door -- and is not the same thing as null. */
      packs_delivered REAL,
      unit_price_toman INTEGER NOT NULL,
      unit_cost_toman INTEGER NOT NULL DEFAULT 0,
      qty_per_pack REAL NOT NULL,
      kg_per_base_unit REAL NOT NULL,
      /* Which price row this was read from, so "why was it charged that?" has an answer
         rather than an inference. */
      price_id INTEGER REFERENCES product_prices(id),
      is_reversal INTEGER NOT NULL DEFAULT 0,
      reverses_line_id INTEGER REFERENCES order_lines(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_lines_product ON order_lines(product_id);

    /* ---- Delivery ----------------------------------------------------------------
       A run is one driver's day. UNIQUE on (driver, date) because two runs for the
       same driver on the same day is always a mistake, and the mistake is expensive:
       half the stops end up on a run nobody opens. */
    CREATE TABLE IF NOT EXISTS delivery_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_user_id INTEGER NOT NULL REFERENCES users(id),
      group_id INTEGER REFERENCES groups(id),
      run_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'in_progress', 'done')),
      started_at TEXT,
      finished_at TEXT,
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (driver_user_id, run_date)
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_runs_driver ON delivery_runs(driver_user_id, run_date);

    /* One stop is one order at one door. The stop carries what happened there; the
       order's own lines carry what was actually handed over. */
    CREATE TABLE IF NOT EXISTS delivery_stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES delivery_runs(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'delivered', 'refused', 'skipped')),
      collected_toman INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,
      delivered_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (run_id, order_id)
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_stops_run ON delivery_stops(run_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_delivery_stops_order ON delivery_stops(order_id);

    /* ---- Commission ---------------------------------------------------------------
       Paid per kilogram of goods delivered. Effective-dated and INSERT-only, like
       product_prices and for the same reason: a rate held in one cell means raising it
       today silently restates what everyone earned last month.

       salesperson_user_id NULL is the company-wide default that applies to anyone
       without a rate of their own -- so onboarding a فروشنده does not require setting a
       rate before their first order can accrue anything. */
    CREATE TABLE IF NOT EXISTS commission_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_user_id INTEGER REFERENCES users(id),
      rate_per_kg_toman INTEGER NOT NULL,
      /* For فوری deliveries. Null means the ordinary rate applies to those too. */
      urgent_rate_per_kg_toman INTEGER,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commission_rates_lookup
      ON commission_rates(salesperson_user_id, valid_from);

    /* Money that actually moved. Accrual is derived from delivered weight and the rate
       in force, and can therefore be restated by a backdated rate; a payment cannot,
       and that asymmetry is deliberate -- one is a calculation, the other is a fact.

       NOT NULL on the person: a payment with nobody attached is money leaving with no
       statement to reconcile it against. */
    CREATE TABLE IF NOT EXISTS commission_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_user_id INTEGER NOT NULL REFERENCES users(id),
      amount_toman INTEGER NOT NULL,
      paid_on TEXT NOT NULL,
      period_from TEXT,
      period_to TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commission_payments_person
      ON commission_payments(salesperson_user_id, paid_on);

    /* ---- Commission, راننده -------------------------------------------------------
       A driver earns on what they PERSONALLY handed over, not on what was ordered --
       the same delivered-not-ordered rule سفارش commission follows, just measured
       against delivery_stops instead of orders.salesperson_user_id. A separate table
       rather than reusing commission_rates: the two are both "toman per kilogram", but
       a rate row that could belong to either a فروشنده or a راننده would need a second
       column just to say which, and every reader would have to filter on it -- two
       small tables are simpler than one table with a discriminator nobody can forget
       to check. */
    CREATE TABLE IF NOT EXISTS driver_commission_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_user_id INTEGER REFERENCES users(id),
      rate_per_kg_toman INTEGER NOT NULL,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_driver_commission_rates_lookup
      ON driver_commission_rates(driver_user_id, valid_from);

    CREATE TABLE IF NOT EXISTS driver_commission_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_user_id INTEGER NOT NULL REFERENCES users(id),
      amount_toman INTEGER NOT NULL,
      paid_on TEXT NOT NULL,
      period_from TEXT,
      period_to TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_driver_commission_payments_person
      ON driver_commission_payments(driver_user_id, paid_on);

    /* ---- Commission, مدیر گروه -----------------------------------------------------
       Not a per-kilogram rate at all -- a مدیر گروه does not deliver or sell a kilogram
       themself, they run the people who do. Their incentive is a share of what their
       whole group accrued, so the number here is a percentage, resolved the same
       effective-dated way every other rate in this file is, and applied to the group's
       total from commissionLedger.allStatements rather than to any order of their own. */
    CREATE TABLE IF NOT EXISTS manager_commission_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manager_user_id INTEGER REFERENCES users(id),
      override_pct REAL NOT NULL,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manager_overrides_lookup
      ON manager_commission_overrides(manager_user_id, valid_from);

    CREATE TABLE IF NOT EXISTS manager_commission_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manager_user_id INTEGER NOT NULL REFERENCES users(id),
      amount_toman INTEGER NOT NULL,
      paid_on TEXT NOT NULL,
      period_from TEXT,
      period_to TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manager_commission_payments_person
      ON manager_commission_payments(manager_user_id, paid_on);

    /* ---- Purchases and stock ------------------------------------------------------
       A receipt of goods into the warehouse. Replaces the خرید sheet.

       Company-wide, with no group_id, for the same reason the catalogue has none: one
       warehouse serves every group, and a scope column that is always null invites a
       filter that empties everyone's screen. */
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier TEXT,
      purchase_date TEXT NOT NULL,
      invoice_no TEXT,
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);

    /* Quantities are in the product's base unit (عدد), not in packs: a supplier's
       carton is rarely the carton we sell, and converting once on the way in is far
       less error-prone than carrying two pack sizes through every stock query. */
    CREATE TABLE IF NOT EXISTS purchase_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      base_qty REAL NOT NULL,
      unit_cost_toman INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase ON purchase_lines(purchase_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_lines_product ON purchase_lines(product_id);
  `);

  /* Nullable, and null means no limit rather than a limit of zero -- most customers do
     not have one, and a default of 0 would refuse every sale on the day it shipped. */
  /* What a planned visit is FOR. Nullable, because every row written before this column
     existed has no answer and inventing one would be a fabricated record — the schedule
     shows those as «بدون هدف» rather than guessing.

     No CHECK constraint: SQLite cannot ALTER one in, so a constrained column here would
     mean rebuilding the table, and the vocabulary is young enough that it is likely to
     gain a value. lib/tripPurpose.ts is the single place that defines what is valid, and
     it is what the UI and the API both read. */
  const visitPlanCols = db.prepare("PRAGMA table_info(visit_plans)").all() as { name: string }[];
  if (!visitPlanCols.some((c) => c.name === "purpose")) {
    db.exec("ALTER TABLE visit_plans ADD COLUMN purpose TEXT");
  }

  const customerCreditCols = db.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
  if (!customerCreditCols.some((c) => c.name === "credit_limit_toman")) {
    db.exec("ALTER TABLE customers ADD COLUMN credit_limit_toman INTEGER");
  }

  /* Reorder policy, per product -- in the product's own base_unit, same as on_hand.
     Both null until an owner sets them: a product nobody has configured yet must read
     as "no threshold set", not as "zero stock is fine" or "already critical". Stock
     itself stays derived (see lib/purchases.ts); these two are the one thing about
     inventory that is not a fact to compute but a decision to store. */
  const productStockCols = db.prepare("PRAGMA table_info(products)").all() as { name: string }[];
  if (!productStockCols.some((c) => c.name === "reorder_point")) {
    db.exec("ALTER TABLE products ADD COLUMN reorder_point REAL");
  }
  if (!productStockCols.some((c) => c.name === "target_stock")) {
    db.exec("ALTER TABLE products ADD COLUMN target_stock REAL");
  }

  // saved_locations shipped with CHECK constraints that lagged the valid resolution
  // values over time ('nominatim', then 'manual') -- CREATE TABLE IF NOT EXISTS never
  // re-applies a constraint change to an already-created table, and SQLite has no ALTER
  // for CHECK, so the fix is to rebuild it (standard SQLite pattern: new table under a
  // temp name, copy every row across, drop the old one, rename into place) rather than
  // skip whenever rows already exist -- real saved locations from before this migration
  // must survive it.
  const savedLocationsSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='saved_locations'")
    .get() as { sql: string } | undefined;
  if (savedLocationsSchema && !savedLocationsSchema.sql.includes("'manual'")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE saved_locations_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          maps_url TEXT UNIQUE NOT NULL,
          address TEXT,
          lat REAL,
          lng REAL,
          resolution TEXT NOT NULL DEFAULT 'unresolved'
            CHECK (resolution IN ('direct', 'pluscode', 'nominatim', 'manual', 'unresolved')),
          notes TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO saved_locations_new SELECT * FROM saved_locations;
        DROP TABLE saved_locations;
        ALTER TABLE saved_locations_new RENAME TO saved_locations;
        CREATE INDEX IF NOT EXISTS idx_saved_locations_name ON saved_locations(name);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  const savedLocationCols = db.prepare("PRAGMA table_info(saved_locations)").all() as { name: string }[];
  if (!savedLocationCols.some((c) => c.name === "status")) {
    db.exec("ALTER TABLE saved_locations ADD COLUMN status TEXT");
  }
  if (!savedLocationCols.some((c) => c.name === "updated_at")) {
    // Drives the GET /api/locations ETag signature the same way districts.updated_at
    // drives districts' -- without a column that changes on UPDATE (not just INSERT),
    // a PATCH (pin drop, status change) leaves the list's cache signature unchanged and
    // the client silently keeps showing the pre-PATCH state via a 304.
    db.exec("ALTER TABLE saved_locations ADD COLUMN updated_at TEXT");
    db.exec("UPDATE saved_locations SET updated_at = created_at WHERE updated_at IS NULL");
  }

  // Prospect scoring. Three nullable columns rather than a ratings table: the criteria
  // are fixed and there is exactly one score per criterion per location, so a join would
  // buy nothing and cost every read. NULL is "not judged yet", which is deliberately not
  // the same as a score of zero.
  for (const col of ["rating_potential", "rating_volume", "rating_ease"]) {
    if (!savedLocationCols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE saved_locations ADD COLUMN ${col} INTEGER`);
    }
  }

  const districtCols = db.prepare("PRAGMA table_info(districts)").all() as { name: string }[];
  if (!districtCols.some((c) => c.name === "assigned_to")) {
    db.exec("ALTER TABLE districts ADD COLUMN assigned_to TEXT");
  }

  const activityCols = db.prepare("PRAGMA table_info(activity_log)").all() as { name: string }[];
  if (!activityCols.some((c) => c.name === "changed_by")) {
    db.exec("ALTER TABLE activity_log ADD COLUMN changed_by TEXT");
  }

  // Districts are ranked by how far away they are, which needs one point per district.
  // Stored rather than derived per request: readDistrictProperties deliberately does not
  // read boundary_geojson (it is ~600KB across the table), and computing centroids on
  // every request would reintroduce exactly the read that split was made to avoid.
  // activity_log carries the same district/customer-only CHECK and needs the same
  // rebuild, for the same reason: a restock stop added to a day, and (feature 11) an
  // arrival logged at a depot, are both events about a facility. Widening it here rather
  // than skipping the log for facilities keeps one history for everything on the map.
  const activitySchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='activity_log'")
    .get() as { sql: string } | undefined;
  if (activitySchema && !activitySchema.sql.includes("'facility'")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE activity_log_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'facility')),
          entity_id INTEGER NOT NULL,
          event_type TEXT NOT NULL CHECK (event_type IN ('status_change', 'note', 'assigned')),
          old_value TEXT,
          new_value TEXT,
          note TEXT,
          changed_by TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO activity_log_new (id, entity_type, entity_id, event_type, old_value, new_value, note, changed_by, created_at)
          SELECT id, entity_type, entity_id, event_type, old_value, new_value, note, changed_by, created_at FROM activity_log;
        DROP TABLE activity_log;
        ALTER TABLE activity_log_new RENAME TO activity_log;
        CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id, created_at);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // users predates roles entirely: it was a username/password/display_name table backing
  // an optional named login, back when a shared password was the usual way in. Roles and
  // group scoping need
  // a CHECK constraint, which SQLite cannot add via ALTER, so this is the standard
  // rebuild.
  //
  // Existing rows become 'owner' on purpose. Those accounts already have unrestricted
  // access today (the app has no scoping at all), so 'owner' preserves exactly the
  // access they have rather than silently revoking it -- a migration that locks the user
  // out of their own production app is a worse failure than one that defers a demotion
  // to the admin screen.
  const usersSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersSchema && !usersSchema.sql.includes("token_version")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('owner', 'group_manager', 'driver')),
          group_id INTEGER REFERENCES groups(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO users_new (id, username, password_hash, display_name, role, created_at)
          SELECT id, username, password_hash, display_name, 'owner', created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // 'salesperson' joins the roles. The manager aggregates cold-call orders today; the
  // three people already named in customers.salesperson get their own accounts once the
  // sales section can show each of them their own orders and nobody else's.
  //
  // SQLite cannot ALTER a CHECK, so this is the same rebuild as above -- with one thing
  // the earlier rebuilds did not have to handle. activity_log.changed_by_user_id now
  // REFERENCES users(id), and DROP TABLE on a table a foreign key points at raises a
  // constraint violation while enforcement is on. PRAGMA foreign_keys is a silent no-op
  // inside a transaction, so it has to be toggled around the whole thing, not within it.
  const usersRoleSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersRoleSchema && !usersRoleSchema.sql.includes("salesperson")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_role_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('owner', 'group_manager', 'salesperson', 'driver')),
          group_id INTEGER REFERENCES groups(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO users_role_new
          (id, username, password_hash, display_name, role, group_id, staff_code, phone,
           active, token_version, location_consent_at, created_at)
          SELECT id, username, password_hash, display_name, role, group_id, staff_code, phone,
                 active, token_version, location_consent_at, created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_role_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      // Always, including on the failure path: leaving a connection with enforcement off
      // would silently drop referential integrity for every write that followed.
      db.exec("PRAGMA foreign_keys = ON");
    }
  }

  // ---- Tenancy (RouteFlow Phase 0a, Task 1) -------------------------------------------
  //
  // One database, several companies. The boundary is organization_id, and it is enforced
  // in lib/session.ts rather than at every call site: scopeGroupIds already funnels every
  // scoped read, and redefining what `owner` means there covers the group-scoped tables
  // without touching them.

  // Seeded rather than left to a UI. Every backfill below needs an id to point at, and
  // there is exactly one company in this database at the moment the column appears.
  const orgCount = db.prepare("SELECT COUNT(*) AS n FROM organizations").get() as unknown as {
    n: number;
  };
  if (orgCount.n === 0) {
    db.prepare(
      `INSERT INTO organizations (id, name, slug, plan, active, created_at)
       VALUES (1, ?, ?, 'standard', 1, ?)`
    ).run("طعمینو", "tameeno", new Date().toISOString());
  }

  // users first: every scoping decision reads the organisation off the session, which
  // reads it off the user row.
  const userOrgCols = db.prepare("PRAGMA table_info(users)").all() as unknown as { name: string }[];
  if (!userOrgCols.some((c) => c.name === "organization_id")) {
    db.exec("ALTER TABLE users ADD COLUMN organization_id INTEGER REFERENCES organizations(id)");
  }
  // Backfilled on every boot rather than only alongside the ALTER. During a rolling
  // deploy an older build is still inserting rows that know nothing about the column, and
  // a row with a null tenant is invisible to every scoped query -- an account that cannot
  // see anything and cannot be told why.
  db.exec("UPDATE users SET organization_id = 1 WHERE organization_id IS NULL");

  // Widen users.role to admit platform_owner: the vendor account, which reads across
  // tenants so support is possible at all. Guarded on the constraint text rather than on
  // a column, because the columns are unchanged -- it is the CHECK that has to move.
  // Same rebuild dance, and the same reasons, as the salesperson widening above.
  const usersPlatformSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersPlatformSchema && !usersPlatformSchema.sql.includes("platform_owner")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_platform_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('platform_owner', 'owner', 'group_manager', 'salesperson', 'driver')),
          group_id INTEGER REFERENCES groups(id),
          organization_id INTEGER REFERENCES organizations(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO users_platform_new
          (id, username, password_hash, display_name, role, group_id, organization_id,
           staff_code, phone, active, token_version, location_consent_at, created_at)
          SELECT id, username, password_hash, display_name, role, group_id, organization_id,
                 staff_code, phone, active, token_version, location_consent_at, created_at
            FROM users;
        DROP TABLE users;
        ALTER TABLE users_platform_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      // Always, including on the failure path: leaving a connection with enforcement off
      // would silently drop referential integrity for every write that followed.
      db.exec("PRAGMA foreign_keys = ON");
    }
  }

  // Phase 0b: widen users.role again to admit rep_manager -- the person who runs the
  // representative network for one organisation. Same rebuild dance and reasons as the
  // platform_owner widening above, guarded on the constraint text.
  const usersRepMgrSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersRepMgrSchema && !usersRepMgrSchema.sql.includes("rep_manager")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_repmgr_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('platform_owner', 'owner', 'group_manager', 'rep_manager', 'salesperson', 'driver')),
          group_id INTEGER REFERENCES groups(id),
          organization_id INTEGER REFERENCES organizations(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO users_repmgr_new
          (id, username, password_hash, display_name, role, group_id, organization_id,
           staff_code, phone, active, token_version, location_consent_at, created_at)
          SELECT id, username, password_hash, display_name, role, group_id, organization_id,
                 staff_code, phone, active, token_version, location_consent_at, created_at
            FROM users;
        DROP TABLE users;
        ALTER TABLE users_repmgr_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }

  // ALTER each table now, up front, and backfill immediately -- both matter here, not
  // just the column. seedFacilities runs later in this same function and relies on
  // "INSERT OR IGNORE" recognising an existing (organization_id, slug) row to skip it;
  // on a database that already has facilities rows from before this migration, those
  // rows still carry organization_id = NULL at the moment seedFacilities runs unless
  // they are backfilled first. Backfilling only *after* seedFacilities -- which is what
  // "runs every boot" originally meant here -- has the steps in the wrong order: it lets
  // seedFacilities insert a fresh (1, slug) row next to the untouched (NULL, slug) row,
  // and then the backfill's own UPDATE collides with the row seedFacilities just made.
  // A second, final sweep further down still runs as a safety net for anything inserted
  // by a migration step that comes after this one.
  for (const table of TENANT_TABLES) {
    const tenantCols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
      name: string;
    }[];
    if (!tenantCols.some((c) => c.name === "organization_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN organization_id INTEGER REFERENCES organizations(id)`);
    }
    db.exec(`UPDATE ${table} SET organization_id = 1 WHERE organization_id IS NULL`);
  }

  // Seven natural keys move from globally unique to unique-per-tenant. Two companies
  // must be able to independently use customer code C001, SKU KR250, district «منطقه ۱»
  // -- without this, the second organisation to try any of those hits a UNIQUE violation
  // that has nothing to do with anything they themselves have done.
  //
  // users.username deliberately does NOT move: there is one login form with no
  // organisation picker, so a username has to identify a person across the whole system.

  rebuildForTenantUnique(
    db,
    "customers",
    "UNIQUE (organization_id, customer_code)",
    `CREATE TABLE customers_tn_new (
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
      status TEXT,
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
      UNIQUE (organization_id, customer_code)
    );`
  );

  rebuildForTenantUnique(
    db,
    "products",
    "UNIQUE (organization_id, sku)",
    `CREATE TABLE products_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT,
      base_unit TEXT NOT NULL DEFAULT 'عدد',
      kg_per_base_unit REAL NOT NULL DEFAULT 0,
      avg_cost_toman INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reorder_point REAL,
      target_stock REAL,
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, sku)
    );`
  );

  // Both of groups' constraints move together -- guarded on the name constraint alone,
  // since a CREATE that changes one and not the other would leave the table half done.
  rebuildForTenantUnique(
    db,
    "groups",
    "UNIQUE (organization_id, name)",
    `CREATE TABLE groups_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      color TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, name),
      UNIQUE (organization_id, slug)
    );`
  );

  rebuildForTenantUnique(
    db,
    "orders",
    "UNIQUE (organization_id, order_no)",
    `CREATE TABLE orders_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      group_id INTEGER REFERENCES groups(id),
      salesperson_user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'delivered', 'cancelled')),
      order_date TEXT NOT NULL,
      delivered_at TEXT,
      payment_status TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
      paid_toman INTEGER NOT NULL DEFAULT 0,
      credit_override_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, order_no)
    );`
  );

  rebuildForTenantUnique(
    db,
    "districts",
    "UNIQUE (organization_id, name, level, parent_name)",
    `CREATE TABLE districts_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('mantaghe', 'mahalle')),
      parent_name TEXT,
      boundary_geojson TEXT NOT NULL,
      coverage_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (coverage_status IN ('visited', 'needs_coverage', 'not_allowed', 'unknown')),
      notes TEXT,
      is_custom INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      assigned_to TEXT,
      centroid_lat REAL,
      centroid_lng REAL,
      group_id INTEGER REFERENCES groups(id),
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, name, level, parent_name)
    );`
  );

  rebuildForTenantUnique(
    db,
    "saved_locations",
    "UNIQUE (organization_id, maps_url)",
    `CREATE TABLE saved_locations_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      maps_url TEXT NOT NULL,
      address TEXT,
      lat REAL,
      lng REAL,
      resolution TEXT NOT NULL DEFAULT 'unresolved'
        CHECK (resolution IN ('direct', 'pluscode', 'nominatim', 'manual', 'unresolved')),
      notes TEXT,
      created_at TEXT NOT NULL,
      status TEXT,
      updated_at TEXT,
      rating_potential INTEGER,
      rating_volume INTEGER,
      rating_ease INTEGER,
      group_id INTEGER REFERENCES groups(id),
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, maps_url)
    );`
  );

  rebuildForTenantUnique(
    db,
    "facilities",
    "UNIQUE (organization_id, slug)",
    `CREATE TABLE facilities_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('warehouse', 'home_base', 'other')),
      name TEXT NOT NULL,
      address TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      maps_url TEXT,
      notes TEXT,
      is_default_origin INTEGER NOT NULL DEFAULT 0,
      owner_username TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      group_id INTEGER REFERENCES groups(id),
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, slug)
    );`
  );

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
  // ALTER a CHECK, so widening it to accept a facility means the standard rebuild:
  // new table, copy every row, drop, rename. Guarded on the constraint text so it runs
  // exactly once. Same dance saved_locations went through above.
  const visitPlansSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='visit_plans'")
    .get() as { sql: string } | undefined;
  if (visitPlansSchema && !visitPlansSchema.sql.includes("'facility'")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE visit_plans_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'facility')),
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

  const districtCentroidCols = db.prepare("PRAGMA table_info(districts)").all() as { name: string }[];
  if (!districtCentroidCols.some((c) => c.name === "centroid_lat")) {
    db.exec("ALTER TABLE districts ADD COLUMN centroid_lat REAL");
    db.exec("ALTER TABLE districts ADD COLUMN centroid_lng REAL");
  }
  backfillDistrictCentroids(db);

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

  // Phase 0b: pins that reached a lead list become customers. Once, guarded on a marker,
  // but foldLeadPinsIntoCustomers is idempotent so a stray re-run is harmless.
  const foldDone = db
    .prepare("SELECT value FROM app_meta WHERE key = 'lead_pin_foldin_done'")
    .get() as { value: string } | undefined;
  if (!foldDone) {
    foldLeadPinsIntoCustomers(db);
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('lead_pin_foldin_done', ?)").run(
      new Date().toISOString()
    );
  }

  seedFacilities(db);

  // A second sweep, run last and every boot. The first one above (right after the
  // ALTER) exists so seedFacilities sees already-backfilled rows and can correctly
  // recognise them as already seeded; this one is the safety net for whatever runs
  // between here and there -- today that is seedFacilities itself, and the point of
  // running this every boot is that it stays correct for whatever gets added later
  // without anyone having to remember to update this comment.
  for (const table of TENANT_TABLES) {
    db.exec(`UPDATE ${table} SET organization_id = 1 WHERE organization_id IS NULL`);
  }

  _db = db;
  return db;
}

export type CoverageStatus = "visited" | "needs_coverage" | "not_allowed" | "unknown";

export interface Customer {
  id: number;
  customer_code: string;
  business_name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  lifecycle: CustomerLifecycle;
  customer_type: CustomerType | null;
  parent_customer_id: number | null;
  payment_terms_days: number;
  hard_credit_block: number;
  credit_limit_toman: number | null;
  qualified_at: string | null;
  first_order_at: string | null;
  salesperson: string | null;
  debt_0_7: number;
  debt_8_30: number;
  debt_30_plus: number;
  notes: string | null;
  synced_at: string;
  last_purchase_date: string | null;
}

export interface District {
  id: number;
  name: string;
  level: "mantaghe" | "mahalle";
  parent_name: string | null;
  boundary_geojson: string;
  coverage_status: CoverageStatus;
  notes: string | null;
  is_custom: number;
  updated_at: string;
  /** Which group holds this territory. NULL means unclaimed -- an owner sees it, no
   *  group manager does. Replaced the free-text assigned_to column, which is retained in
   *  the table only so history written against it stays readable. */
  group_id: number | null;
  /** Area-weighted centre, filled by backfillDistrictCentroids. NULL when the geometry
   *  could not produce one -- callers must treat that as "distance unknown", never 0. */
  centroid_lat: number | null;
  centroid_lng: number | null;
}

export type EntityType = "district" | "customer";

/** visit_plans alone accepts a facility: a restock stop at the warehouse is a genuine
 *  leg of the day's route, unlike a reminder or a photo, which are always attached to a
 *  district or a customer. Kept as its own union so widening the route model does not
 *  quietly loosen every other entity reference in the schema. */
export type PlanEntityType = EntityType | "facility";
/** What activity_log accepts. Same widening as PlanEntityType, for the same reason. */
export type LoggableEntityType = PlanEntityType;
export const PLAN_ENTITY_TYPES: PlanEntityType[] = ["district", "customer", "facility"];

export interface ActivityEntry {
  id: number;
  entity_type: LoggableEntityType;
  entity_id: number;
  event_type: "status_change" | "note" | "assigned";
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  changed_by: string | null;
  /** The acting user's id, so history survives a rename and two people with the same
   *  display name stay distinguishable. NULL on rows written before accounts existed. */
  changed_by_user_id: number | null;
  created_at: string;
}

export interface Reminder {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  due_date: string;
  message: string;
  resolved: number;
  created_at: string;
}

export interface Photo {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  file_stem: string;
  caption: string | null;
  taken_at: string;
  created_at: string;
}

export interface VisitPlan {
  id: number;
  entity_type: PlanEntityType;
  entity_id: number;
  planned_date: string;
  status: "planned" | "done" | "skipped";
  sort_order: number;
  created_at: string;
}

export interface SaleRow {
  id: number;
  order_no: string | null;
  sale_date: string;
  customer_name: string;
  product_name: string | null;
  qty: number | null;
  amount: number;
  payment_status: string | null;
  shipping_status: string | null;
  imported_at: string;
}

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export interface ImportSnapshotRow {
  id: number;
  created_at: string;
  customers_json: string;
  sales_json: string;
}

/** Re-exported from roles.ts so server modules that already import from db.ts keep one
 *  import site, the same arrangement facilityTypes has at the top of this file. The
 *  definition itself has to live outside db.ts because client components need it and
 *  cannot import node:sqlite. */
export type { Role } from "./roles";
export { ROLES, ROLE_LABEL, ROLE_DESCRIPTION } from "./roles";

export interface GroupRow {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  active: number;
  created_at: string;
}

export interface OrganizationRow {
  id: number;
  name: string;
  slug: string;
  plan: string;
  active: number;
  contact_name: string | null;
  contact_phone: string | null;
  created_at: string;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  role: Role;
  group_id: number | null;
  organization_id: number;
  staff_code: string | null;
  phone: string | null;
  active: number;
  token_version: number;
  location_consent_at: string | null;
  created_at: string;
}

export type LocationResolution = "direct" | "pluscode" | "nominatim" | "manual" | "unresolved";
export type LocationStatus = "contacted" | "visited" | "no_answer" | "declined";
export const LOCATION_STATUSES: LocationStatus[] = ["contacted", "visited", "no_answer", "declined"];

export interface SavedLocationRow {
  id: number;
  name: string;
  maps_url: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  resolution: LocationResolution;
  notes: string | null;
  status: LocationStatus | null;
  rating_potential: number | null;
  rating_volume: number | null;
  rating_ease: number | null;
  created_at: string;
  updated_at: string;
}

export interface LeadListRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

/** A list plus its membership, in order. The API always returns them together: a list
 *  without its stops is never useful to a caller, and fetching them separately would
 *  make every page do two round trips to show one thing. */
export interface LeadListWithItems extends LeadListRow {
  location_ids: number[];
}

export function readLeadLists(
  db: DatabaseSync = getDb(),
  groupIds: number[] | "all" = "all"
): LeadListWithItems[] {
  // See readCustomers: an empty scope must read as "nothing", never as "everything".
  if (groupIds !== "all" && groupIds.length === 0) return [];
  const where = groupIds === "all" ? "" : ` WHERE group_id IN (${groupIds.map(() => "?").join(", ")})`;
  const params = groupIds === "all" ? [] : groupIds;
  const lists = db
    .prepare(`SELECT id, name, created_at, updated_at FROM lead_lists${where} ORDER BY created_at`)
    .all(...params) as unknown as LeadListRow[];

  const items = db
    .prepare("SELECT list_id, location_id FROM lead_list_items ORDER BY list_id, sort_order, id")
    .all() as unknown as { list_id: number; location_id: number }[];

  const byList = new Map<number, number[]>();
  for (const it of items) {
    const arr = byList.get(it.list_id);
    if (arr) arr.push(it.location_id);
    else byList.set(it.list_id, [it.location_id]);
  }

  // Rebuilt as object literals rather than passed through: node:sqlite hands back
  // null-prototype rows, which cannot cross into a Client Component.
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    created_at: l.created_at,
    updated_at: l.updated_at,
    location_ids: byList.get(l.id) ?? [],
  }));
}

/** Replaces a list's membership wholesale.
 *
 *  A whole-list write rather than add/remove/reorder endpoints: the order is the point,
 *  every edit changes it, and three endpoints that each have to renumber the others is
 *  three chances to leave the list inconsistent. One statement, one transaction, one
 *  possible outcome.
 */
export function setLeadListItems(db: DatabaseSync, listId: number, locationIds: number[]): void {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM lead_list_items WHERE list_id = ?").run(listId);
    const insert = db.prepare(
      "INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (?, ?, ?, ?)"
    );
    locationIds.forEach((locationId, i) => insert.run(listId, locationId, i, now));
    db.prepare("UPDATE lead_lists SET updated_at = ? WHERE id = ?").run(now, listId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function logActivity(
  db: DatabaseSync,
  entry: Omit<ActivityEntry, "id" | "created_at" | "changed_by_user_id"> & { changed_by_user_id?: number | null }
): void {
  db.prepare(
    `INSERT INTO activity_log (entity_type, entity_id, event_type, old_value, new_value, note, changed_by, changed_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.entity_type,
    entry.entity_id,
    entry.event_type,
    entry.old_value,
    entry.new_value,
    entry.note,
    entry.changed_by,
    entry.changed_by_user_id ?? null,
    new Date().toISOString()
  );
}

// The two sites the business started from, recovered from the Google Maps links they
// shared: the warehouse link was a place record (املاک طاها) whose coordinates came out
// of Google's own place data, the home link carried an explicit dropped pin.
//
// Seeded rather than hard-coded so the user can edit them, and keyed on `slug` so that
// re-running this -- which happens on every boot, and again after any backup restore --
// neither duplicates a row nor reverts an edit. INSERT OR IGNORE, deliberately not
// INSERT OR REPLACE: REPLACE would silently throw away a repositioned pin on the next
// deploy, which is the exact failure this table exists to prevent.
const FACILITY_SEED: Array<Omit<FacilityRow, "id" | "created_at" | "updated_at">> = [
  {
    slug: "warehouse-bakeh",
    kind: "warehouse",
    name: "انبار مرکزی",
    address: "استان تهران، بکه، بلوار رسول اکرم، املاک طاها",
    lat: 35.502669,
    lng: 51.7546255,
    maps_url: "https://maps.app.goo.gl/XYd819ZQiGJzHNKM9",
    notes: "انبار اصلی — تأمین موجودی",
    is_default_origin: 0,
    owner_username: null,
  },
  {
    slug: "home-pardis",
    kind: "home_base",
    name: "خانه (انبار کوچک)",
    address: "تهران، پردیس، فاز ۲، خیابان فهمیده",
    lat: 35.753263,
    lng: 51.798381,
    maps_url: "https://maps.app.goo.gl/ivx6yY69Zb9S9sKu6",
    notes: "شروع مسیر توزیع روزانه از اینجاست",
    // Deliveries start here, so this is the point every distance in the app measures
    // from until the user picks another.
    is_default_origin: 1,
    owner_username: null,
  },
];

export function seedFacilities(db: DatabaseSync): void {
  const now = new Date().toISOString();
  // organization_id pinned to 1: these are the one real company's warehouse and home
  // base, hardcoded above by address. Since the UNIQUE that "OR IGNORE" relies on is
  // now (organization_id, slug), leaving this column out would insert a fresh
  // organization_id = NULL row on every boot -- NULL is distinct from NULL under
  // SQLite's own uniqueness rules, so it would never match the row a previous boot
  // already created, and "idempotent" would quietly stop being true.
  const insert = db.prepare(`
    INSERT OR IGNORE INTO facilities
      (slug, kind, name, address, lat, lng, maps_url, notes, is_default_origin, owner_username, created_at, updated_at, organization_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const f of FACILITY_SEED) {
    insert.run(
      f.slug,
      f.kind,
      f.name,
      f.address,
      f.lat,
      f.lng,
      f.maps_url,
      f.notes,
      f.is_default_origin,
      f.owner_username,
      now,
      now,
      1
    );
  }
}

/** Fills in centroids for districts that have none. Runs on every boot but only touches
 *  rows still NULL, so the ~600KB geometry read happens once after the migration (and
 *  again only for newly drawn districts) rather than on every start.
 *
 *  A district whose geometry cannot produce a centroid is left NULL rather than given a
 *  fake one: NULL sorts to the end of a distance ranking, a wrong coordinate does not. */
export function backfillDistrictCentroids(db: DatabaseSync): void {
  const pending = db
    .prepare("SELECT id, boundary_geojson FROM districts WHERE centroid_lat IS NULL AND boundary_geojson IS NOT NULL")
    .all() as unknown as { id: number; boundary_geojson: string }[];
  if (pending.length === 0) return;

  const update = db.prepare("UPDATE districts SET centroid_lat = ?, centroid_lng = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const row of pending) {
      let centroid: { lat: number; lng: number } | null = null;
      try {
        centroid = polygonCentroid(JSON.parse(row.boundary_geojson) as DistrictGeometry);
      } catch {
        centroid = null; // malformed geometry -- leave it NULL, see the doc comment
      }
      if (centroid) update.run(centroid.lat, centroid.lng, row.id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
