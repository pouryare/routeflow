import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import type { FacilityRow } from "./facilityTypes";
import { polygonCentroid } from "./simplify";
import type { DistrictGeometry } from "./simplify";

// Re-exported so server modules that already import from db.ts keep one import site.
export type { FacilityKind, FacilityRow } from "./facilityTypes";
export { FACILITY_KINDS } from "./facilityTypes";

const DB_PATH = process.env.COVERAGE_DB_PATH || path.join(process.cwd(), "data", "coverage.db");

let _db: DatabaseSync | null = null;

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

    CREATE TABLE IF NOT EXISTS import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_at TEXT NOT NULL,
      customers_upserted INTEGER NOT NULL,
      source_filename TEXT
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

    CREATE TABLE IF NOT EXISTS import_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      customers_json TEXT NOT NULL,
      sales_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
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
  `);

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

  seedFacilities(db);

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
  status: string | null;
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
  assigned_to: string | null;
  /** Area-weighted centre, filled by backfillDistrictCentroids. NULL when the geometry
   *  could not produce one -- callers must treat that as "distance unknown", never 0. */
  centroid_lat: number | null;
  centroid_lng: number | null;
}

export type EntityType = "district" | "customer";

export interface ActivityEntry {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  event_type: "status_change" | "note" | "assigned";
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  changed_by: string | null;
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
  entity_type: EntityType;
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

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
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
  created_at: string;
  updated_at: string;
}

export function logActivity(
  db: DatabaseSync,
  entry: Omit<ActivityEntry, "id" | "created_at">
): void {
  db.prepare(
    `INSERT INTO activity_log (entity_type, entity_id, event_type, old_value, new_value, note, changed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.entity_type,
    entry.entity_id,
    entry.event_type,
    entry.old_value,
    entry.new_value,
    entry.note,
    entry.changed_by,
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
  const insert = db.prepare(`
    INSERT OR IGNORE INTO facilities
      (slug, kind, name, address, lat, lng, maps_url, notes, is_default_origin, owner_username, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      now
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
