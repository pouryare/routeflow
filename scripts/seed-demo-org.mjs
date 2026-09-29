#!/usr/bin/env node
/**
 * A SECOND TENANT, so the cross-tenant paths are not untested code.
 *
 * There is exactly one organisation today. Every "a platform_owner may read another
 * tenant" and "may act as any account in any organisation" path would ship unexercised
 * and be discovered broken the day customer two signs up. This creates one: «شرکت پخش
 * پارس», with its own groups, a full set of roles, and ENOUGH HISTORY to be worth
 * testing — a tenant with rows but no past proves nothing about a support tool, which is
 * about time.
 *
 * EVERY statement is keyed on this tenant's own `organization_id`, found by slug. That is
 * the whole discipline: scripts/seed-demo.mjs hardcodes `organization_id = 1` in ~15
 * places, and copying those literals is how demo data ends up in a customer's ledger.
 * If the org is not found by slug, the script refuses rather than inventing an id.
 *
 * Reversible on seed-demo.mjs's terms: `--remove` runs with FK enforcement off and asserts
 * `foreign_key_check` is clean BEFORE committing, so an incomplete teardown rolls back
 * instead of orphaning a real row.
 *
 * Usage:
 *   node scripts/seed-demo-org.mjs            seed it
 *   node scripts/seed-demo-org.mjs --remove   remove it, and nothing else
 */
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.ROUTEFLOW_DB_PATH ?? path.join(ROOT, "data", "routeflow.db");
const REMOVE = process.argv.includes("--remove");
const SLUG = "pars";
const NAME = "شرکت پخش پارس";

const db = new DatabaseSync(DB_PATH, REMOVE ? { enableForeignKeyConstraints: false } : {});

const hasCol = (table, col) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasCol("products", "reorder_point")) db.exec("ALTER TABLE products ADD COLUMN reorder_point REAL");

/* This script opens the database directly, so lib/db.ts's migrations have not run. Every
 * table it depends on that might not exist yet is declared here too — the same statement
 * lib/db.ts uses, and idempotent, so it does not matter which of the two gets there first.
 * Without this, a database that has not booted since user_roles landed says "no such
 * table" and the seed dies. */
if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_roles'").get()) {
  db.exec(`
    CREATE TABLE user_roles (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role    TEXT NOT NULL,
      PRIMARY KEY (user_id, role)
    );
  `);
}

const org = db.prepare("SELECT id FROM organizations WHERE slug = ?").get(SLUG);
const orgId = org ? org.id : null;

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const hash = (pw) => crypto.createHash("sha256").update(pw).digest("hex");

if (REMOVE) {
  if (orgId === null) {
    console.log(`no organisation "${SLUG}" — nothing to remove`);
    process.exit(0);
  }
  /* Child-first, and every statement names the org. Even a mistake here cannot reach
     طعمینو's rows, which is the property that matters most.

     The last two are the ones that DO NOT have organization_id: packagings and
     product_prices reach the tenant through product_id, and order_lines through order_id.
     Deleting them by product id AFTER the org's own products are gone is the point — the
     first --remove attempt correctly aborted on five orphaned rows, because
     foreign_key_check ran before anything had cleaned them. The guard did its job; the
     teardown was incomplete. */
  /* Capture the child-parent ids BEFORE deleting the parents. A subquery evaluated after
     the parent rows are gone matches nothing — which is why two earlier attempts deleted
     orders and runs first and then found delivery_stops orphaned by exactly those rows. */
  const captured = {
    runs: db.prepare("SELECT id FROM delivery_runs WHERE organization_id = ?").all(orgId).map((r) => r.id),
    orders: db.prepare("SELECT id FROM orders WHERE organization_id = ?").all(orgId).map((r) => r.id),
    products: db.prepare("SELECT id FROM products WHERE organization_id = ?").all(orgId).map((r) => r.id),
    /* user_roles has no organization_id either: it reaches the tenant through user_id.
       FK enforcement is OFF during this teardown, so ON DELETE CASCADE never fires and
       these rows would outlive their user — the third abort was on exactly this. */
    users: db.prepare("SELECT id FROM users WHERE organization_id = ?").all(orgId).map((r) => r.id),
  };
  const inList = (xs) => (xs.length ? xs.join(",") : "-1");

  db.exec("BEGIN");
  try {
    /* delivery_stops, order_lines, product_prices and packagings carry NO organization_id
       — they reach the tenant through a parent. Captured ids, deleted first. */
    db.exec(`DELETE FROM delivery_stops WHERE run_id IN (${inList(captured.runs)}) OR order_id IN (${inList(captured.orders)})`);
    db.exec(`DELETE FROM order_lines WHERE order_id IN (${inList(captured.orders)}) OR product_id IN (${inList(captured.products)})`);
    db.exec(`DELETE FROM product_prices WHERE product_id IN (${inList(captured.products)})`);
    db.exec(`DELETE FROM packagings WHERE product_id IN (${inList(captured.products)})`);
    db.exec(`DELETE FROM user_roles WHERE user_id IN (${inList(captured.users)})`);

    for (const t of [
      "deliveries", "delivery_runs", "order_events", "orders", "products",
      "saved_locations", "customers", "visit_plans", "tasks", "users", "groups",
    ]) {
      if (!hasCol(t, "organization_id")) continue;
      db.exec(`DELETE FROM ${t} WHERE organization_id = ${orgId}`);
    }
    db.exec(`DELETE FROM organizations WHERE id = ${orgId}`);

    const dangling = db.prepare("PRAGMA foreign_key_check").all();
    if (dangling.length) {
      db.exec("ROLLBACK");
      console.error(`[seed-demo-org] --remove aborted: it would orphan ${dangling.length} row(s):`);
      for (const d of dangling.slice(0, 12)) console.error("  ", JSON.stringify(d));
      process.exit(1);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  console.log(`removed ${NAME}`);
  process.exit(0);
}

// Idempotent: a second run says so and changes nothing, rather than creating a tenant
// with the same slug (which is UNIQUE and would throw).
if (orgId !== null) {
  console.log(`"${SLUG}" already exists (id ${orgId}) — nothing to do. Use --remove first.`);
  process.exit(0);
}

const c = { org: 0, groups: 0, users: 0, customers: 0, pins: 0, orders: 0, runs: 0 };
db.exec("BEGIN IMMEDIATE");
try {
  const newOrg = Number(
    db
      .prepare("INSERT INTO organizations (name, slug, plan, active, created_at) VALUES (?,?,?,1,?)")
      .run(NAME, SLUG, "standard", new Date().toISOString()).lastInsertRowid
  );
  c.org = newOrg;

  const groups = {};
  for (const [key, label, color] of [["north", "شمال", "#2E6382"], ["south", "جنوب", "#7A4B2A"]]) {
    groups[key] = Number(
      db
        .prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?,?,?,1,?)")
        .run(label, `${SLUG}-${key}`, color, new Date().toISOString()).lastInsertRowid
    );
    c.groups++;
  }

  /* Every role, so the cross-tenant switcher has something of each to show and
     "a platform_owner may act as anyone" has real targets. */
  const uid = {};
  for (const [username, display, role, gid] of [
    ["pars.owner", "حسین کریمی", "owner", null],
    ["pars.gm", "مریم نوری", "group_manager", groups.north],
    ["pars.rep", "رضا صادقی", "rep_manager", groups.south],
    ["pars.sales", "سارا امینی", "phone_sales", groups.north],
    ["pars.field", "امیر حسینی", "field_rep", groups.south],
    ["pars.driver1", "نگار شریفی", "delivery_driver", groups.north],
    ["pars.driver2", "پویا رستمی", "delivery_driver", groups.south],
  ]) {
    uid[username] = Number(
      db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, active, token_version, created_at)
           VALUES (?,?,?,?,?,?,1,0,?)`
        )
        .run(username, hash("demo1234:" + username), display, role, gid, newOrg, new Date().toISOString())
        .lastInsertRowid
    );
    // The insert trigger does this too; written explicitly so the seed is legible alone.
    db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?,?)").run(uid[username], role);
    c.users++;
  }

  /* A dual-hat driver: the person the multi-role work exists for, and the one a
     single-column list cannot show. */
  db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?,?)").run(uid["pars.driver1"], "field_rep");

  const product = Number(
    db
      .prepare("INSERT INTO products (sku, name, kg_per_base_unit, organization_id, created_at, updated_at) VALUES (?,?,?,?,?,?)")
      .run("PARS-1", "شربت", 0.25, newOrg, new Date().toISOString(), new Date().toISOString()).lastInsertRowid
  );
  /* packagings and product_prices carry NO organization_id — they reach the tenant
     through product_id. Three of my first four statements named a column that does not
     exist, which SQLite reports only as "constraint failed" with no column named. The
     shapes are read from the live schema rather than assumed, because a seed script that
     guesses a column list is a seed script that dies on someone else's database. */
  const packaging = Number(
    db
      .prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?,?,?,?)")
      .run(product, "کارتن", 12, new Date().toISOString()).lastInsertRowid
  );
  db.prepare("INSERT INTO product_prices (product_id, packaging_id, price_toman, valid_from, created_at) VALUES (?,?,?,?,?)")
    .run(product, packaging, 950_000, iso(120), new Date().toISOString());

  const customers = [];
  for (let i = 1; i <= 12; i++) {
    customers.push(Number(
      db
        .prepare(
          `INSERT INTO customers (customer_code, business_name, customer_type, lifecycle, synced_at, organization_id, owner_user_id)
           VALUES (?,?,?,'active',?,?,?)`
        )
        .run(`PARS-${i}`, `مشتری ${i}`, i % 3 === 0 ? "RETAIL" : "WHOLESALE", iso(90 - i), newOrg, uid["pars.sales"])
        .lastInsertRowid
    ));
    c.customers++;
  }

  /* Orders across four weeks. HISTORY, not rows: "switch in and see their last month"
     is the thing being tested, and a tenant with no past cannot answer it. */
  const orderIds = [];
  for (let w = 0; w < 4; w++) {
    for (const cust of customers.slice(0, 3)) {
      const when = iso(w * 7 + 1);
      const oid = Number(
        db
          .prepare(
            `INSERT INTO orders (order_no, customer_id, order_date, status, payment_status, paid_toman, organization_id, created_by, created_at, updated_at)
             VALUES (?,?,?,'CONFIRMED','paid',?,?,?,?,?)`
          )
          .run(`P-${w}-${cust}`, cust, when.slice(0, 10), 2_400_000, newOrg, uid["pars.gm"], when, when)
          .lastInsertRowid
      );
      /* Shapes read off the live schema, not assumed:
         - order_lines has NO organization_id and no `total_toman`; it stores
           packs_ordered / qty_per_pack and reaches the tenant through order_id.
         - delivery_stops has NO delivery_id and NO organization_id; a stop points at
           order_id and sort_order, and reaches the tenant through the run.
         Guessing these cost three rounds of "no such column", which SQLite at least
         names — unlike the CHECK/NOT NULL failures, which say only "constraint failed". */
      db.prepare(
        `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, packs_delivered,
                                  qty_per_pack, kg_per_base_unit, unit_price_toman, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(oid, product, packaging, 2, 0, 12, 3, 950_000, new Date().toISOString());
      orderIds.push(oid);
      c.orders++;
    }
  }

  for (let i = 0; i < 6; i++) {
    db.prepare(
      `INSERT INTO saved_locations (name, maps_url, address, lat, lng, resolution, organization_id, group_id, created_at)
       VALUES (?,?,?,?,?,'manual',?,?,?)`
    ).run(`پین ${i}`, `https://maps.example/p/pars-${i}`, `تهران، منطقهٔ ${i}`, 35.70 + i * 0.01, 51.40 + i * 0.01, newOrg, groups.north, iso(30 - i));
    c.pins++;
  }

  /* A live round, so /driver under this account is not an empty page — which is the whole
     reason the founder cannot see a driver's day without switching. */
  const run = Number(
    db
      .prepare(
        `INSERT INTO delivery_runs (run_date, status, driver_user_id, organization_id, group_id, created_by, created_at, updated_at)
         VALUES (?,'ready',?,?,?,?,?,?)`
      )
      .run(new Date().toISOString().slice(0, 10), uid["pars.driver1"], newOrg, groups.north, uid["pars.gm"], new Date().toISOString(), new Date().toISOString())
      .lastInsertRowid
  );
  c.runs++;
  /* deliveries.status is a CHECK over the delivery state machine — 'PLANNED', 'ASSIGNED',
     'LOADED', 'IN_TRANSIT', … — NOT the delivery_stops vocabulary ('pending', 'delivered').
     The two look alike and are not, which is why a lowercase 'pending' fails with nothing
     but "CHECK constraint failed: status IN". seq is UNIQUE per order, so each gets its own. */
  let seq = 1;
  for (const oid of orderIds.slice(0, 2)) {
    db.prepare("INSERT INTO deliveries (order_id, organization_id, seq, status, created_at) VALUES (?,?,?,?,?)")
      .run(oid, newOrg, seq++, "PLANNED", new Date().toISOString());
    db.prepare("INSERT INTO delivery_stops (run_id, order_id, sort_order, status, created_at) VALUES (?,?,?,'pending',?)")
      .run(run, oid, seq, new Date().toISOString());
  }

  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

console.log(
  `seeded ${NAME}: org ${c.org}, ${c.groups} groups, ${c.users} users, ` +
    `${c.customers} customers, ${c.pins} pins, ${c.orders} orders, ${c.runs} run`
);
console.log("remove with: node scripts/seed-demo-org.mjs --remove");
