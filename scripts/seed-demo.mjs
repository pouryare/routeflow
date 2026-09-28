/** Demo data, so every card on every screen has something real to draw.
 *
 *  Reversible on purpose. Everything this creates carries a marker that nothing a person
 *  would type carries:
 *    - products      sku LIKE 'DEMO-%'
 *    - users         username LIKE 'demo.%'
 *    - orders        order_no LIKE '1404-9%'   (real numbering starts at 00001)
 *    - runs/stops    reached through those orders
 *  `node scripts/seed-demo.mjs --remove` deletes exactly that set and nothing else, so
 *  the demo can be cleared without touching a single real row.
 *
 *  Run:    node scripts/seed-demo.mjs
 *  Clear:  node scripts/seed-demo.mjs --remove
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import crypto from "node:crypto";

const DB_PATH = process.env.ROUTEFLOW_DB_PATH ?? path.join(process.cwd(), "data", "routeflow.db");
const REMOVE = process.argv.includes("--remove");
/* Teardown crosses ~15 FK-linked tables (orders -> deliveries -> batches -> stock
   movements -> …). Rather than hand-order every DELETE and re-break on the next schema
   change, --remove runs with FK enforcement off and then asserts `foreign_key_check` is
   clean before it commits — so an incomplete teardown rolls back instead of orphaning a
   real row. Seeding keeps enforcement on. */
const db = new DatabaseSync(DB_PATH, REMOVE ? { enableForeignKeyConstraints: false } : {});

/* This script opens the database directly, so lib/db.ts's migrations have not run. Every
   column it depends on that might not exist yet is added here too — the same statement
   lib/db.ts uses, and idempotent, so it does not matter which of the two gets there
   first. */
const hasCol = (table, col) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasCol("visit_plans", "purpose")) {
  db.exec("ALTER TABLE visit_plans ADD COLUMN purpose TEXT");
}
if (!hasCol("products", "reorder_point")) {
  db.exec("ALTER TABLE products ADD COLUMN reorder_point REAL");
}
if (!hasCol("products", "target_stock")) {
  db.exec("ALTER TABLE products ADD COLUMN target_stock REAL");
}
// Same reasoning, for tables rather than columns: CREATE TABLE IF NOT EXISTS is already
// idempotent against lib/db.ts running first, so these are safe to repeat verbatim.
db.exec(`
  CREATE TABLE IF NOT EXISTS driver_commission_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_user_id INTEGER REFERENCES users(id),
    rate_per_kg_toman INTEGER NOT NULL,
    valid_from TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
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
  CREATE TABLE IF NOT EXISTS manager_commission_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manager_user_id INTEGER REFERENCES users(id),
    override_pct REAL NOT NULL,
    valid_from TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
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
  CREATE TABLE IF NOT EXISTS representative_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    rep_code TEXT NOT NULL,
    manager_user_id INTEGER REFERENCES users(id),
    contract_signed_at TEXT, contract_expires_at TEXT,
    exclusivity_territory_id INTEGER REFERENCES districts(id),
    stage TEXT NOT NULL DEFAULT 'prospect' CHECK (stage IN
      ('prospect','qualified','negotiating','documents','approved','onboarding','active','dormant','terminated')),
    activated_at TEXT, first_order_at TEXT,
    credit_terms_days INTEGER NOT NULL DEFAULT 0,
    discount_tier TEXT, monthly_target_kg REAL, monthly_target_toman INTEGER,
    health_score REAL, health_computed_at TEXT, notes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE (organization_id, customer_id),
    UNIQUE (organization_id, rep_code)
  );
  CREATE TABLE IF NOT EXISTS representative_onboarding_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    representative_id INTEGER NOT NULL REFERENCES representative_profiles(id) ON DELETE CASCADE,
    step_code TEXT NOT NULL, label_fa TEXT NOT NULL,
    required INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT, completed_by INTEGER REFERENCES users(id), notes TEXT,
    UNIQUE (representative_id, step_code)
  );
`);
const now = new Date().toISOString();

const plain = (rows) => rows.map((r) => ({ ...r }));
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/* Gregorian -> Jalali, enough to build the "jy-jm" period string that lib/repo/targets
   and the briefing's currentPeriod() expect. Standard Borkowski conversion. */
function jalaliYearMonth(d = new Date()) {
  let gy = d.getUTCFullYear();
  const gm = d.getUTCMonth() + 1;
  const gd = d.getUTCDate();
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    gd +
    gdm[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  jy += Math.floor((days - 1) / 365);
  if (days > 365) days = (days - 1) % 365;
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  return `${jy}-${String(jm).padStart(2, "0")}`;
}

const FORCE = process.argv.includes("--force");
if (!REMOVE && !FORCE) {
  // Seeding demo rows onto a live database mixes fake orders into real reporting. Removing
  // them is always safe, so --remove skips this.
  if (process.env.NODE_ENV === "production") {
    console.error("[seed-demo] refusing: NODE_ENV=production. Pass --force if you really mean it.");
    process.exit(1);
  }
  const realOrders = db
    .prepare("SELECT COUNT(*) n FROM orders WHERE order_no NOT LIKE '1404-9%'")
    .get().n;
  if (realOrders > 0) {
    console.error(`[seed-demo] refusing: ${realOrders} real order(s) already exist. Pass --force to override.`);
    process.exit(1);
  }
}

/* ── removal ───────────────────────────────────────────────────────────────── */
if (REMOVE) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const orders = plain(db.prepare("SELECT id FROM orders WHERE order_no LIKE '1404-9%'").all());
    const ids = orders.map((o) => o.id);
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      const inDemo = `IN (${marks})`;
      // Everything hanging off a demo order, deepest FK first. order_lines and
      // order_events cascade with the order; deliveries / batches / allocations do not.
      db.prepare(
        `DELETE FROM delivery_line_batches WHERE delivery_stop_id IN (SELECT id FROM delivery_stops WHERE order_id ${inDemo})
           OR order_line_id IN (SELECT id FROM order_lines WHERE order_id ${inDemo})`
      ).run(...ids, ...ids);
      db.prepare(
        `DELETE FROM delivery_lines WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_id ${inDemo})`
      ).run(...ids);
      db.prepare(
        `UPDATE payments SET delivery_stop_id = NULL WHERE delivery_stop_id IN (SELECT id FROM delivery_stops WHERE order_id ${inDemo})`
      ).run(...ids);
      db.prepare(`UPDATE payment_allocations SET order_id = NULL WHERE order_id ${inDemo}`).run(...ids);
      db.prepare(`DELETE FROM credit_approvals WHERE order_id ${inDemo}`).run(...ids);
      db.prepare(`DELETE FROM quality_complaints WHERE order_id ${inDemo}`).run(...ids);
      db.prepare(`DELETE FROM order_events WHERE order_id ${inDemo}`).run(...ids);
      db.prepare(`DELETE FROM deliveries WHERE order_id ${inDemo}`).run(...ids);
      db.prepare(`DELETE FROM delivery_stops WHERE order_id ${inDemo}`).run(...ids);
      db.prepare(`DELETE FROM order_lines WHERE order_id ${inDemo}`).run(...ids);
      db.prepare(`DELETE FROM orders WHERE id ${inDemo}`).run(...ids);
    }
    db.exec(`DELETE FROM delivery_runs WHERE id NOT IN (SELECT DISTINCT run_id FROM delivery_stops)
             AND created_at >= '2026-01-01' AND notes = 'demo'`);
    // Board / Pocket / briefing rows, all scoped to the demo group or demo users.
    const dg = plain(db.prepare("SELECT id FROM groups WHERE slug = 'demo-team'").all())[0];
    if (dg) {
      db.prepare("DELETE FROM tasks WHERE group_id = ?").run(dg.id);
      db.prepare("DELETE FROM task_recurrences WHERE group_id = ?").run(dg.id);
      db.prepare(
        "DELETE FROM targets WHERE group_id = ? OR user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%')"
      ).run(dg.id);
    }
    db.exec("DELETE FROM cheques WHERE cheque_no LIKE 'DEMO-CHK-%'");
    db.exec("DELETE FROM quality_complaints WHERE description LIKE 'دمو:%'");
    db.exec("DELETE FROM lesson_progress WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%')");
    db.exec(`DELETE FROM product_prices WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'DEMO-%')`);
    db.exec(`DELETE FROM packagings WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'DEMO-%')`);
    // Stock/batch rows that hang off a DEMO product (or a batch of one), deepest first.
    const demoProd = "(SELECT id FROM products WHERE sku LIKE 'DEMO-%')";
    const demoBatch = `(SELECT id FROM batches WHERE product_id IN ${demoProd})`;
    db.exec(`DELETE FROM delivery_line_batches WHERE batch_id IN ${demoBatch}`);
    db.exec(`DELETE FROM stock_movements WHERE product_id IN ${demoProd} OR batch_id IN ${demoBatch}`);
    db.exec(`DELETE FROM stock_reservations WHERE product_id IN ${demoProd} OR batch_id IN ${demoBatch}`);
    db.exec(`DELETE FROM quality_complaints WHERE product_id IN ${demoProd} OR batch_id IN ${demoBatch}`);
    db.exec(`DELETE FROM batches WHERE product_id IN ${demoProd}`);
    db.exec(`DELETE FROM purchase_lines WHERE product_id IN ${demoProd}`);
    db.exec("DELETE FROM purchases WHERE id NOT IN (SELECT DISTINCT purchase_id FROM purchase_lines)");
    db.exec("DELETE FROM products WHERE sku LIKE 'DEMO-%'");
    db.exec("DELETE FROM commission_rates WHERE salesperson_user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%')");
    db.exec("DELETE FROM driver_commission_rates WHERE driver_user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%')");
    db.exec("DELETE FROM driver_commission_payments WHERE driver_user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%')");
    db.exec("DELETE FROM manager_commission_overrides WHERE manager_user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%')");
    db.exec("DELETE FROM manager_commission_payments WHERE manager_user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%')");
    db.exec("DELETE FROM visit_plans WHERE purpose IS NOT NULL");
    db.exec(
      "DELETE FROM representative_onboarding_steps WHERE representative_id IN (SELECT id FROM representative_profiles WHERE rep_code LIKE 'DEMO-%')"
    );
    db.exec("DELETE FROM credit_approvals WHERE order_id NOT IN (SELECT id FROM orders)");
    db.exec("DELETE FROM representative_profiles WHERE rep_code LIKE 'DEMO-%'");
    // user_roles first, keyed on the SAME marker the users use. This transaction runs with
    // FK enforcement off, so `ON DELETE CASCADE` does not fire and these rows would survive
    // their user — then foreign_key_check below aborts the teardown with "it would orphan
    // N rows". The guard is doing its job; this is the arm it was not pointing at.
    //
    // Deliberately NOT `WHERE user_id NOT IN (SELECT id FROM users)`: that runs BEFORE the
    // delete below, so every demo user still exists and nothing matches. First attempt at
    // this fix used it and the teardown still aborted.
    db.exec(
      "DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%')"
    );
    db.exec("DELETE FROM users WHERE username LIKE 'demo.%'");
    // The group only ever exists to hold those users -- deleted after them, so nothing
    // still references it, and guarded by the same slug it was created under.
    db.exec("DELETE FROM groups WHERE slug = 'demo-team'");

    // FK enforcement is off for this transaction: verify we left nothing dangling before
    // committing. If we did, roll back and say where, rather than orphan a real row.
    const dangling = db.prepare("PRAGMA foreign_key_check").all();
    if (dangling.length) {
      db.exec("ROLLBACK");
      console.error(`[seed-demo] --remove aborted: it would orphan ${dangling.length} row(s):`);
      for (const d of dangling.slice(0, 12)) console.error("  ", JSON.stringify(d));
      process.exit(1);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  console.log("demo data removed");
  process.exit(0);
}

/* ── who ───────────────────────────────────────────────────────────────────── */
const owner = plain(db.prepare("SELECT id, group_id FROM users ORDER BY id LIMIT 1").all())[0];
if (!owner) throw new Error("no user in the database to attribute demo rows to");

/** A password nobody can use. These accounts exist to be *named* on orders — the cradle
 *  avatars, the assignee chips, the commission statements — not to be signed into. */
const LOCKED = `demo!${crypto.randomBytes(24).toString("hex")}`;

const PEOPLE = [
  { username: "demo.mehdi", name: "مهدی کریمی", role: "phone_sales" },
  { username: "demo.reza", name: "رضا مرادی", role: "phone_sales" },
  { username: "demo.sara", name: "سارا نجفی", role: "phone_sales" },
  { username: "demo.hossein", name: "حسین فلاح", role: "driver" },
  // A مدیر گروه to demonstrate the third پورسانت ledger. Needs a real group with real
  // فروشنده‌ها in it -- a manager's override is a percentage of their group's total, so
  // one attached to owner.group_id (usually null) would always show zero.
  { username: "demo.manager", name: "الهام صادقی", role: "group_manager" },
];

db.exec("BEGIN IMMEDIATE");
try {
  const demoGroup = plain(db.prepare("SELECT id FROM groups WHERE slug = 'demo-team'").all())[0];
  const demoGroupId = demoGroup
    ? demoGroup.id
    : Number(
        db
          .prepare(
            "INSERT INTO groups (name, slug, color, active, created_at) VALUES ('تیم دمو', 'demo-team', '#8b6fd6', 1, ?)"
          )
          .run(now).lastInsertRowid
      );

  const staff = {};
  for (const p of PEOPLE) {
    const found = plain(db.prepare("SELECT id FROM users WHERE username = ?").all(p.username))[0];
    if (found) {
      staff[p.username] = found.id;
      // Reassigned every run, not just on creation -- an earlier version of this script
      // put these accounts under owner.group_id, and a stale group_id would leave the
      // مدیر گروه ledger seeing an empty team on a database seeded before this existed.
      db.prepare("UPDATE users SET group_id = ? WHERE id = ?").run(demoGroupId, found.id);
      continue;
    }
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .run(p.username, LOCKED, p.name, p.role, demoGroupId, now);
    staff[p.username] = Number(lastInsertRowid);
  }
  const sellers = [staff["demo.mehdi"], staff["demo.reza"], staff["demo.sara"]];
  const driver = staff["demo.hossein"];
  const manager = staff["demo.manager"];

  /* ── catalogue ───────────────────────────────────────────────────────────── */
  const PRODUCTS = [
    { name: "پنیر سفید ۴۰۰ گرمی", sku: "DEMO-PN400", kg: 0.4, cost: 120_000, pack: "کارتن ۲۴ عددی", per: 24, price: 185_000 },
    { name: "ماست پرچرب ۲ کیلویی", sku: "DEMO-MS2K", kg: 2, cost: 62_000, pack: "شرینک ۶ عددی", per: 6, price: 98_000 },
    { name: "خامه صبحانه ۲۰۰ گرمی", sku: "DEMO-KH200", kg: 0.2, cost: 48_000, pack: "کارتن ۳۶ عددی", per: 36, price: 76_000 },
    { name: "کره حیوانی ۲۵۰ گرمی", sku: "DEMO-KR250", kg: 0.25, cost: 210_000, pack: "کارتن ۲۰ عددی", per: 20, price: 310_000 },
    { name: "دوغ گازدار ۱٫۵ لیتری", sku: "DEMO-DG15", kg: 1.5, cost: 26_000, pack: "شرینک ۶ عددی", per: 6, price: 42_000 },
    { name: "شیر پرچرب ۱ لیتری", sku: "DEMO-SH1L", kg: 1, cost: 31_000, pack: "شرینک ۱۲ عددی", per: 12, price: 47_000 },
  ];

  const made = [];
  for (const p of PRODUCTS) {
    let row = plain(db.prepare("SELECT id FROM products WHERE sku = ?").all(p.sku))[0];
    let pid;
    if (row) {
      pid = row.id;
    } else {
      pid = Number(
        db
          .prepare(
            `INSERT INTO products (name, sku, base_unit, kg_per_base_unit, avg_cost_toman, active, created_at, updated_at)
             VALUES (?, ?, 'عدد', ?, ?, 1, ?, ?)`
          )
          .run(p.name, p.sku, p.kg, p.cost, now, now).lastInsertRowid
      );
    }
    let pack = plain(db.prepare("SELECT id FROM packagings WHERE product_id = ? LIMIT 1").all(pid))[0];
    const packId = pack
      ? pack.id
      : Number(
          db
            .prepare(
              `INSERT INTO packagings (product_id, name, qty_per_pack, active, created_at) VALUES (?, ?, ?, 1, ?)`
            )
            .run(pid, p.pack, p.per, now).lastInsertRowid
        );
    // A second, earlier row at a lower price -- so تاریخچه قیمت‌ها has an actual history
    // to chart rather than one point sitting alone. Guarded on its own valid_from, same
    // as the current price below, so re-running the seed does not duplicate it.
    const olderFrom = iso(600);
    const olderPrice = Math.round((p.price * 0.88) / 1000) * 1000;
    if (!plain(db.prepare("SELECT id FROM product_prices WHERE packaging_id = ? AND valid_from = ?").all(packId, olderFrom))[0]) {
      db.prepare(
        `INSERT INTO product_prices (product_id, packaging_id, price_toman, valid_from, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(pid, packId, olderPrice, olderFrom, owner.id, now);
    }

    let price = plain(db.prepare("SELECT id FROM product_prices WHERE packaging_id = ? AND valid_from = ?").all(packId, iso(400)))[0];
    const priceId = price
      ? price.id
      : Number(
          db
            .prepare(
              `INSERT INTO product_prices (product_id, packaging_id, price_toman, valid_from, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(pid, packId, p.price, iso(400), owner.id, now).lastInsertRowid
        );
    made.push({ ...p, pid, packId, priceId });
  }

  /* ── commission rates for all four ledgers, so every پورسانت card has something to
     show -- placed here, before the order-count check below can exit the process, so
     it still runs (idempotently) on a database that already has its 45 demo orders. */
  for (const uid of sellers) {
    const has = plain(
      db.prepare("SELECT id FROM commission_rates WHERE salesperson_user_id = ? LIMIT 1").all(uid)
    )[0];
    if (!has) {
      db.prepare(
        `INSERT INTO commission_rates (salesperson_user_id, rate_per_kg_toman, valid_from, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(uid, 1500, iso(400), owner.id, now);
    }
  }
  const hasDriverRate = plain(
    db.prepare("SELECT id FROM driver_commission_rates WHERE driver_user_id = ? LIMIT 1").all(driver)
  )[0];
  if (!hasDriverRate) {
    db.prepare(
      `INSERT INTO driver_commission_rates (driver_user_id, rate_per_kg_toman, valid_from, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(driver, 800, iso(400), owner.id, now);
  }
  const hasOverride = plain(
    db.prepare("SELECT id FROM manager_commission_overrides WHERE manager_user_id = ? LIMIT 1").all(manager)
  )[0];
  if (!hasOverride) {
    db.prepare(
      `INSERT INTO manager_commission_overrides (manager_user_id, override_pct, valid_from, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(manager, 8, iso(400), owner.id, now);
  }

  /* ── reorder policy, so انبار پیشرفته has a real spread of بحرانی/کم‌موجود/سالم/مازاد
     to show rather than "سالم" on every card -- chosen against each product's actual
     on-hand position at seed time, not round numbers picked blind. Only set once: an
     owner who has since edited these through the UI must not have their change undone
     by a later reseed. */
  const THRESHOLDS = {
    "DEMO-PN400": { reorder: 800, target: 2000 }, // usually overstocked -- مازاد
    "DEMO-MS2K": { reorder: 300, target: 900 }, // سالم
    "DEMO-KH200": { reorder: 1000, target: 3000 }, // سالم
    "DEMO-KR250": { reorder: 300, target: 800 }, // usually close to the line -- کم‌موجود
    "DEMO-DG15": { reorder: 200, target: 500 }, // usually below it -- بحرانی
    "DEMO-SH1L": { reorder: 200, target: 700 }, // سالم
  };
  const updateThresholds = db.prepare(
    "UPDATE products SET reorder_point = ?, target_stock = ? WHERE id = ? AND reorder_point IS NULL AND target_stock IS NULL"
  );
  for (const m of made) {
    const t = THRESHOLDS[m.sku];
    if (t) updateThresholds.run(t.reorder, t.target, m.pid);
  }

  /* ── customers to sell to ────────────────────────────────────────────────── */
  const customers = plain(
    db.prepare("SELECT id, business_name, group_id FROM customers ORDER BY id LIMIT 14").all()
  );
  if (!customers.length) throw new Error("no customers to attach demo orders to");

  /* ── orders ──────────────────────────────────────────────────────────────── */
  const already = plain(db.prepare("SELECT COUNT(*) c FROM orders WHERE order_no LIKE '1404-9%'").all())[0].c;
  // The order/run/visit/purchase blocks below build the demo's *history* and only run on
  // a clean slate. Everything after them (targets, tasks, cheques, …) is idempotent and
  // runs every time, so a reseed can enrich a database that already has its 45 orders.
  const seedOrders = already === 0;
  if (!seedOrders) console.log(`demo orders already present (${already}) — enriching the rest.`);

  let created = [];
  if (seedOrders) {
  const insOrder = db.prepare(
    `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status,
       order_date, delivered_at, payment_status, paid_toman, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insLine = db.prepare(
    `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, packs_delivered,
       unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit, price_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );

  let seq = 90_001;
  /* Fourteen days of history so the seven-day curve has a previous week to compare with,
     then today's spread across four statuses so the board has a card in every column. */
  for (let day = 13; day >= 0; day--) {
    const date = iso(day);
    const howMany = day === 0 ? 6 : 2 + (day % 3);
    for (let k = 0; k < howMany; k++) {
      const cust = customers[(day * 3 + k) % customers.length];
      const seller = sellers[(day + k) % sellers.length];
      const lines = [
        [made[(day + k) % made.length], 4 + ((day * 5 + k * 3) % 26)],
        ...(k % 2 === 0 ? [[made[(day + k + 2) % made.length], 3 + ((day + k) % 12)]] : []),
      ];
      const total = lines.reduce((s, [m, packs]) => s + m.price * packs, 0);

      // today spreads across the pipeline; everything older has completed
      let status = "DELIVERED";
      if (day === 0) status = ["DRAFT", "CONFIRMED", "CONFIRMED", "DELIVERED", "DELIVERED", "CONFIRMED"][k];
      const delivered = status === "DELIVERED";
      const partial = delivered && (day + k) % 5 === 0;

      const id = Number(
        insOrder.run(
          `1404-${seq++}`,
          cust.id,
          cust.group_id,
          seller,
          status,
          date,
          delivered ? `${date}T13:00:00.000Z` : null,
          delivered ? (partial ? "partial" : "paid") : "unpaid",
          delivered ? (partial ? Math.round(total * 0.5) : total) : 0,
          owner.id,
          now,
          now
        ).lastInsertRowid
      );
      for (const [m, packs] of lines) {
        insLine.run(id, m.pid, m.packId, packs, delivered ? packs : null, m.price, m.cost, m.per, m.kg, m.priceId, now);
      }
      created.push({ id, status, date });
    }
  }

  /* ── a delivery run today, so some orders carry a route sheet ────────────── */
  const runDate = iso(0);
  let run = plain(
    db.prepare("SELECT id FROM delivery_runs WHERE driver_user_id = ? AND run_date = ?").all(driver, runDate)
  )[0];
  const runId = run
    ? run.id
    : Number(
        db
          .prepare(
            `INSERT INTO delivery_runs (driver_user_id, group_id, run_date, status, notes, created_by, created_at, updated_at)
             VALUES (?, ?, ?, 'in_progress', 'demo', ?, ?, ?)`
          )
          .run(driver, owner.group_id, runDate, owner.id, now, now).lastInsertRowid
      );
  const onRun = created.filter((o) => o.date === runDate && o.status !== "DRAFT").slice(0, 3);
  onRun.forEach((o, i) => {
    db.prepare(
      `INSERT OR IGNORE INTO delivery_stops (run_id, order_id, sort_order, status, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(runId, o.id, i, o.status === "DELIVERED" ? "delivered" : "pending", now);
  });

  /* ── planned visits, so برنامهٔ روز has something to colour ───────────────── */
  const PURPOSES = ["first_visit", "sample", "delivery", "collect"];
  {
    const insVisit = db.prepare(
      `INSERT INTO visit_plans (entity_type, entity_id, planned_date, status, sort_order, purpose, created_at)
       VALUES ('customer', ?, ?, ?, ?, ?, ?)`
    );
    for (let day = 6; day >= -3; day--) {
      const date = iso(day);
      const howMany = day === 0 ? 4 : 1 + (Math.abs(day) % 3);
      for (let k = 0; k < howMany; k++) {
        const cust = customers[(day * 5 + k * 2 + 20) % customers.length];
        insVisit.run(
          cust.id,
          date,
          day > 0 ? (k % 4 === 0 ? "skipped" : "done") : "planned",
          k,
          PURPOSES[(day + k + 4) % PURPOSES.length],
          now
        );
      }
    }
  }

  /* ── a purchase, so انبار shows stock rather than every line negative ────── */
  const purchase = Number(
    db
      .prepare(
        `INSERT INTO purchases (supplier, invoice_no, purchase_date, notes, created_by, created_at)
         VALUES ('تأمین‌کنندهٔ نمونه', 'DEMO-INV-1', ?, 'demo', ?, ?)`
      )
      .run(iso(20), owner.id, now).lastInsertRowid
  );
  for (const m of made) {
    db.prepare(
      /* base_qty is in the product's base unit (عدد), not in packs — see lib/db.ts. */
      `INSERT INTO purchase_lines (purchase_id, product_id, base_qty, unit_cost_toman, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(purchase, m.pid, 200 * m.per, m.cost, now);
  }

  /* ── a representative mid-onboarding, so /sales/admin/representatives has a row ─── */
  const repCust = plain(db.prepare("SELECT id FROM customers ORDER BY id LIMIT 1").all())[0];
  if (repCust) {
    const repId = Number(
      db
        .prepare(
          `INSERT INTO representative_profiles
             (organization_id, customer_id, rep_code, stage, credit_terms_days, created_at, updated_at)
           VALUES (1, ?, 'DEMO-REP-01', 'onboarding', 30, ?, ?)
           ON CONFLICT DO NOTHING`
        )
        .run(repCust.id, now, now).lastInsertRowid
    );
    if (repId) {
      const steps = [
        ["contract_signed", "امضای قرارداد", 1, 1],
        ["territory_assigned", "تخصیص منطقهٔ فعالیت", 1, 2],
        ["price_list_assigned", "تعیین لیست قیمت نماینده", 1, 3],
        ["credit_terms_set", "تعیین شرایط پرداخت", 1, 4],
        ["first_stock_order", "ثبت اولین سفارش تأمین", 1, 5],
        ["training_module_6", "گذراندن دورهٔ آموزش نماینده", 0, 6],
      ];
      const stepStmt = db.prepare(
        `INSERT INTO representative_onboarding_steps (representative_id, step_code, label_fa, required, sort_order, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const [code, label, req, order] of steps) {
        stepStmt.run(repId, code, label, req, order, order <= 2 ? now : null);
      }
    }
  }
  } else {
    // Reseed onto a database that already has its demo orders: load them so the blocks
    // below (delivery history, complaints) can still attach to real rows.
    created = plain(
      db.prepare("SELECT id, status, order_date AS date FROM orders WHERE order_no LIKE '1404-9%'").all()
    );
  }

  /* ═══ enrichment — idempotent, runs on every seed ═══════════════════════════ */

  /* ── targets, so «هدف این ماه» on the briefing has a bar to fill ─────────── */
  {
    const period = jalaliYearMonth();
    const insTarget = db.prepare(
      `INSERT INTO targets (organization_id, user_id, group_id, period, metric, target_value, created_by, created_at)
       VALUES (1, ?, ?, ?, 'revenue_toman', ?, ?, ?)`
    );
    const seen = (uid, gid) =>
      plain(
        db
          .prepare(
            "SELECT 1 x FROM targets WHERE organization_id=1 AND period=? AND metric='revenue_toman' AND user_id IS ? AND group_id IS ?"
          )
          .all(period, uid, gid)
      )[0];
    const SELLER_TARGET = [420_000_000, 360_000_000, 300_000_000];
    sellers.forEach((uid, i) => {
      if (!seen(uid, null)) insTarget.run(uid, null, period, SELLER_TARGET[i] ?? 300_000_000, owner.id, now);
    });
    if (!seen(null, demoGroupId)) insTarget.run(null, demoGroupId, period, 1_100_000_000, owner.id, now);
  }

  /* ── tasks across every kind / stage / lane, for the Board and the Pocket ── */
  {
    const have = plain(db.prepare("SELECT COUNT(*) c FROM tasks WHERE group_id = ?").all(demoGroupId))[0].c;
    if (have === 0) {
      const insTask = db.prepare(
        `INSERT INTO tasks (organization_id, assignee_user_id, role_hint, group_id, kind, title,
           entity_type, entity_id, due_at, priority, status, outcome_code, stage, started_at, created_by, created_at, done_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const c = (i) => customers[i % customers.length];
      const add = (o) =>
        insTask.run(
          o.assignee ?? null,
          o.role ?? null,
          demoGroupId,
          o.kind,
          o.title,
          o.cust ? "customer" : null,
          o.cust ?? null,
          o.due ?? null,
          o.priority ?? "NORMAL",
          o.status ?? "open",
          o.outcome ?? null,
          o.stage ?? null,
          o.started ?? null,
          owner.id,
          now,
          o.done ?? null
        );
      const S = sellers;
      const TASKS = [
        { kind: "outreach", title: `تماس با ${c(0).business_name} برای معرفی محصول تازه`, cust: c(0).id, assignee: S[0], due: iso(0), stage: "call", priority: "HIGH" },
        { kind: "outreach", title: `پیگیری نمونهٔ کره با ${c(1).business_name}`, cust: c(1).id, assignee: S[1], due: iso(-1), stage: "waiting", started: now },
        { kind: "outreach", title: `هماهنگی جلسهٔ حضوری با ${c(2).business_name}`, cust: c(2).id, assignee: S[0], due: iso(-3), stage: "scheduled", started: now, priority: "HIGH" },
        { kind: "outreach", title: `تماس با ${c(3).business_name}`, cust: c(3).id, assignee: S[2], due: iso(4), stage: "call", priority: "LOW" },
        { kind: "outreach", title: `تماس فروش با ${c(4).business_name}`, cust: c(4).id, assignee: S[1], due: iso(2), status: "done", outcome: "ORDERED", stage: "done", done: now },
        { kind: "outreach", title: `پیگیری ${c(5).business_name} — بی‌نتیجه`, cust: c(5).id, assignee: S[2], due: iso(6), status: "done", outcome: "CONTACTED", stage: "done", done: now },
        { kind: "order", title: `آماده‌سازی سفارش ${c(6).business_name}`, cust: c(6).id, assignee: S[0], due: iso(0), stage: "pending", priority: "HIGH" },
        { kind: "order", title: `بارگیری سفارش ${c(7).business_name}`, cust: c(7).id, assignee: S[1], due: iso(0), stage: "ready", started: now },
        { kind: "order", title: `در مسیر تحویل — ${c(8).business_name}`, cust: c(8).id, assignee: S[2], due: iso(0), stage: "transit", started: now },
        { kind: "visit", title: `بازدید حضوری ${c(9).business_name}`, cust: c(9).id, assignee: S[0], due: iso(1), stage: "plan" },
        { kind: "visit", title: `تحویل نمونه به ${c(10).business_name}`, cust: c(10).id, assignee: S[1], due: iso(3), stage: "plan", priority: "LOW" },
        { kind: "visit", title: `وصول چک ${c(11).business_name}`, cust: c(11).id, assignee: S[2], due: iso(0), stage: "enroute", started: now, priority: "HIGH" },
        { kind: "admin", title: "بستن گزارش فروش هفته", assignee: manager, due: iso(-1), priority: "HIGH" },
        { kind: "admin", title: "بازبینی سقف اعتبار مشتری‌های راکد", assignee: manager, due: iso(5) },
        { kind: "admin", title: "پیگیری تسویهٔ راننده", role: "rep_manager", due: iso(2) },
        { kind: "reminder", title: `یادآوری: تماس با ${c(12).business_name} دوشنبه`, cust: c(12).id, assignee: S[0], due: iso(3) },
        { kind: "reminder", title: `یادآوری: ارسال لیست قیمت به ${c(13).business_name}`, cust: c(13).id, assignee: S[1], due: iso(0), priority: "HIGH" },
        { kind: "note", title: `${c(0).business_name} فقط صبح‌ها جواب می‌دهد` , cust: c(0).id, assignee: S[0] },
        { kind: "note", title: "نمایشگاه صنایع غذایی ماه بعد — غرفه رزرو شود", assignee: manager },
      ];
      for (const t of TASKS) add(t);
    }
  }

  /* ── recurring tasks, seeded through the same engine the sweep spawns from ── */
  {
    const insRec = db.prepare(
      `INSERT INTO task_recurrences (organization_id, title, kind, assignee_user_id, role_hint, group_id, priority, rrule, active, created_by, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    );
    const recSeen = (title) =>
      plain(db.prepare("SELECT 1 x FROM task_recurrences WHERE organization_id=1 AND title=?").all(title))[0];
    const RECS = [
      ["پیدا کردن مشتری جدید در منطقهٔ ۴ تهران", "outreach", null, "phone_sales", "weekly:sat", "NORMAL"],
      ["بازبینی موجودی انبار و ثبت سفارش تأمین", "admin", manager, null, "weekly:sun", "HIGH"],
      ["پیگیری چک‌های سررسید این هفته", "admin", manager, null, "weekly:wed", "HIGH"],
      ["تماس با مشتری‌های راکد (بدون خرید ۱۴ روز)", "outreach", null, "phone_sales", "weekly:mon", "NORMAL"],
    ];
    for (const [title, kind, assignee, role, rrule, prio] of RECS) {
      if (!recSeen(title)) insRec.run(title, kind, assignee, role, demoGroupId, prio, rrule, owner.id, now, now);
    }
  }

  /* ── delivery history, so مسیر تحویل / تحویل‌ها are not a single row ──────── */
  {
    const insRun = db.prepare(
      `INSERT INTO delivery_runs (driver_user_id, group_id, run_date, status, started_at, finished_at, notes,
         actual_distance_km, actual_duration_min, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'done', ?, ?, 'demo', ?, ?, ?, ?, ?)`
    );
    const insStop = db.prepare(
      `INSERT OR IGNORE INTO delivery_stops (run_id, order_id, sort_order, status, delivered_at, created_at)
       VALUES (?, ?, ?, 'delivered', ?, ?)`
    );
    for (const d of [2, 4, 6, 9, 12]) {
      const rd = iso(d);
      if (plain(db.prepare("SELECT 1 x FROM delivery_runs WHERE driver_user_id=? AND run_date=?").all(driver, rd))[0]) continue;
      const rid = Number(
        insRun.run(driver, demoGroupId, rd, `${rd}T06:30:00.000Z`, `${rd}T13:10:00.000Z`, 40 + d * 3, 180 + d * 8, owner.id, now, now)
          .lastInsertRowid
      );
      created
        .filter((o) => o.date === rd && o.status === "DELIVERED")
        .slice(0, 5)
        .forEach((o, i) => insStop.run(rid, o.id, i, `${rd}T${String(9 + i).padStart(2, "0")}:00:00.000Z`, now));
    }
  }

  /* ── cheques in every state, so /sales/cheques has a real spread ─────────── */
  {
    if (plain(db.prepare("SELECT COUNT(*) c FROM cheques WHERE cheque_no LIKE 'DEMO-CHK-%'").all())[0].c === 0) {
      const insChq = db.prepare(
        `INSERT INTO cheques (organization_id, customer_id, amount_toman, cheque_no, bank_name, due_date, status,
           received_at, received_by, deposited_at, cleared_at, bounced_at, note, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const BANKS = ["ملت", "صادرات", "پاسارگاد", "سامان", "ملی"];
      const ROWS = [
        { amt: 48_000_000, due: iso(-10), status: "in_hand" },
        { amt: 32_500_000, due: iso(-3), status: "deposited", dep: iso(2) },
        { amt: 71_000_000, due: iso(9), status: "cleared", dep: iso(14), clr: iso(8) },
        { amt: 25_000_000, due: iso(18), status: "bounced", dep: iso(23), bnc: iso(17) },
        { amt: 55_500_000, due: iso(-28), status: "in_hand" },
      ];
      ROWS.forEach((r, i) =>
        insChq.run(
          customers[(i * 2) % customers.length].id,
          r.amt,
          `DEMO-CHK-${1001 + i}`,
          BANKS[i % BANKS.length],
          r.due,
          r.status,
          iso(30),
          owner.id,
          r.dep ?? null,
          r.clr ?? null,
          r.bnc ?? null,
          null,
          now,
          now
        )
      );
    }
  }

  /* ── quality complaints, so /sales/complaints has cases open and closed ──── */
  {
    if (plain(db.prepare("SELECT COUNT(*) c FROM quality_complaints WHERE description LIKE 'دمو:%'").all())[0].c === 0) {
      const insQc = db.prepare(
        `INSERT INTO quality_complaints (organization_id, customer_id, order_id, product_id, reported_at, reported_by,
           category, severity, description, status, resolution, resolved_at, resolved_by, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const dOrders = plain(
        db.prepare("SELECT id, customer_id FROM orders WHERE order_no LIKE '1404-9%' ORDER BY id").all()
      );
      const pid = made[0].pid;
      const Q = [
        { cat: "spoilage", sev: "high", st: "investigating", desc: "دمو: ماست پیش از تاریخ انقضا کپک زده بود." },
        { cat: "packaging", sev: "medium", st: "resolved", desc: "دمو: درب ظرف خامه هنگام تحویل باز بود.", res: "مرجوعی کامل و ارسال جایگزین." },
        { cat: "short_weight", sev: "low", st: "open", desc: "دمو: وزن کرهٔ تحویلی کمتر از درج روی بسته بود." },
      ];
      Q.forEach((q, i) => {
        const o = dOrders[i % Math.max(1, dOrders.length)] ?? {};
        insQc.run(
          o.customer_id ?? customers[i].id,
          o.id ?? null,
          pid,
          iso(5 + i * 3),
          sellers[i % sellers.length],
          q.cat,
          q.sev,
          q.desc,
          q.st,
          q.res ?? null,
          q.st === "resolved" ? now : null,
          q.st === "resolved" ? manager : null,
          now
        );
      });
    }
  }

  /* ── one pending credit approval, so the owner's briefing panel lights up ── */
  {
    const oc = plain(
      db
        .prepare("SELECT id, customer_id FROM orders WHERE order_no LIKE '1404-9%' AND status='CONFIRMED' ORDER BY id LIMIT 1")
        .all()
    )[0];
    if (oc && plain(db.prepare("SELECT COUNT(*) c FROM credit_approvals WHERE order_id=?").all(oc.id))[0].c === 0) {
      db.prepare(
        `INSERT INTO credit_approvals (organization_id, order_id, requested_by, requested_at,
           customer_balance_toman, credit_limit_toman, overage_toman, status)
         VALUES (1, ?, ?, ?, ?, ?, ?, 'pending')`
      ).run(oc.id, sellers[0], now, 92_000_000, 60_000_000, 32_000_000);
    }
  }

  /* ── academy progress, so /sales/academy shows lessons ticked ───────────── */
  {
    const insLp = db.prepare(
      `INSERT INTO lesson_progress (organization_id, user_id, lesson_slug, completed_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT (organization_id, user_id, lesson_slug) DO NOTHING`
    );
    sellers.forEach((uid, i) => {
      insLp.run(uid, "01-market-and-customer", `${iso(20 - i * 4)}T10:00:00.000Z`);
      if (i < 2) insLp.run(uid, "02-phone-sales", `${iso(10 - i * 3)}T10:00:00.000Z`);
    });
  }

  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

const n = (sql) => plain(db.prepare(sql).all())[0].c;
const dgId = (plain(db.prepare("SELECT id FROM groups WHERE slug='demo-team'").all())[0] ?? {}).id ?? -1;
console.log("demo seeded:");
console.log("  products       ", n("SELECT COUNT(*) c FROM products WHERE sku LIKE 'DEMO-%'"));
console.log("  demo staff     ", n("SELECT COUNT(*) c FROM users WHERE username LIKE 'demo.%'"));
console.log("  orders         ", n("SELECT COUNT(*) c FROM orders WHERE order_no LIKE '1404-9%'"));
console.log("  order lines    ", n("SELECT COUNT(*) c FROM order_lines"));
console.log("  delivery runs  ", n("SELECT COUNT(*) c FROM delivery_runs WHERE notes='demo'"));
console.log("  delivery stops ", n("SELECT COUNT(*) c FROM delivery_stops"));
console.log("  planned visits ", n("SELECT COUNT(*) c FROM visit_plans WHERE purpose IS NOT NULL"));
console.log("  tasks          ", n(`SELECT COUNT(*) c FROM tasks WHERE group_id=${dgId}`));
console.log("  task recurrences", n(`SELECT COUNT(*) c FROM task_recurrences WHERE group_id=${dgId}`));
console.log("  targets        ", n(`SELECT COUNT(*) c FROM targets WHERE group_id=${dgId} OR user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%')`));
console.log("  cheques        ", n("SELECT COUNT(*) c FROM cheques WHERE cheque_no LIKE 'DEMO-CHK-%'"));
console.log("  complaints     ", n("SELECT COUNT(*) c FROM quality_complaints WHERE description LIKE 'دمو:%'"));
console.log("  academy done   ", n("SELECT COUNT(*) c FROM lesson_progress WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%')"));
console.log("\nclear it again with:  node scripts/seed-demo.mjs --remove");
