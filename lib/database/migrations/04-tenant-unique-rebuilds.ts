/* Migration era 04: Natural keys that move from globally unique to unique per tenant, the shared-geography districts rebuild, and the van-capable facilities rebuild.
 * Moved out of lib/db.ts's getDb() unchanged; the eras run in numeric order from ../migrate.ts and
 * each statement is idempotent (it inspects the live schema first). */
import type { DatabaseSync } from "node:sqlite";
import { rebuildDistrictsShared, rebuildFacilitiesForVan, rebuildForTenantUnique } from "../rebuilds";

export function applyTenantUniqueRebuilds(db: DatabaseSync): void {
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
      shelf_life_days INTEGER,
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

  // Shared geography, so the opposite of its seven siblings: this one REMOVES the tenant
  // scoping rather than adding it. It has to run before the group_id and centroid ALTERs
  // below, which then re-add those columns to the fresh table.
  rebuildDistrictsShared(db);
  /* Phase 8: widen facilities.kind to allow a van. Must run BEFORE the tenant-unique pass below
     so that pass sees the UNIQUE marker this leaves behind and does not fire a second time. */
  rebuildFacilitiesForVan(db);

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
        CHECK (resolution IN ('direct', 'pluscode', 'browser', 'nominatim', 'manual', 'unresolved')),
      notes TEXT,
      created_at TEXT NOT NULL,
      status TEXT,
      updated_at TEXT,
      rating_potential INTEGER,
      rating_volume INTEGER,
      rating_ease INTEGER,
      group_id INTEGER REFERENCES groups(id),
      organization_id INTEGER REFERENCES organizations(id),
      visit_outcome TEXT,
      UNIQUE (organization_id, maps_url)
    );`
  );

  /* `facilities` — and its CHECK must name 'van', or this rebuild silently UNDOES the one above.
   *
   *  There are two places the facilities schema is written out, and they used to disagree about
   *  the kind list. On a fresh database the schema block creates the table with the new list, this
   *  helper then sees the missing UNIQUE and rebuilds from ITS OWN literal — so whichever list it
   *  carries is the one that survives. Adding 'van' only to the CREATE was not enough, and the
   *  symptom was a CHECK constraint failure on the first insert of a van, a long way from here.
   *  Every migration that rewrites a table must update every writer of that table's DDL. */
  rebuildForTenantUnique(
    db,
    "facilities",
    "UNIQUE (organization_id, slug)",
    `CREATE TABLE facilities_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('warehouse', 'factory', 'van', 'home',
                                   'office', 'shop', 'cold_storage', 'parking', 'other')),
      name TEXT NOT NULL,
      /* The icon is the person's choice, not the kind's. It used to be derived from the
         kind, which meant a kind could only ever look like one thing, and adding a kind
         retroactively changed what every existing place of that kind looked like. NULL
         until chosen; the UI falls back to the kind's first option. */
      icon_key TEXT,
      address TEXT,
      /* Nullable, matching the other two facilities DDL copies -- see the long comment on
       * facilities.lat. This rebuild is the one that bites: it re-creates the table on
       * every tenant bootstrap, so a NOT NULL here puts the constraint straight back for
       * anyone whose data survives the rebuild. */
      lat REAL,
      lng REAL,
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
}
