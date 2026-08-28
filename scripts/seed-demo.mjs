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

const DB_PATH = process.env.COVERAGE_DB_PATH ?? path.join(process.cwd(), "data", "coverage.db");
const db = new DatabaseSync(DB_PATH);
const REMOVE = process.argv.includes("--remove");

/* This script opens the database directly, so lib/db.ts's migrations have not run. The
   one column it depends on is added here too — the same statement, and idempotent, so it
   does not matter which of the two gets there first. */
const hasCol = (table, col) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasCol("visit_plans", "purpose")) {
  db.exec("ALTER TABLE visit_plans ADD COLUMN purpose TEXT");
}
const now = new Date().toISOString();

const plain = (rows) => rows.map((r) => ({ ...r }));
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/* ── removal ───────────────────────────────────────────────────────────────── */
if (REMOVE) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const orders = plain(db.prepare("SELECT id FROM orders WHERE order_no LIKE '1404-9%'").all());
    const ids = orders.map((o) => o.id);
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      db.prepare(`DELETE FROM delivery_stops WHERE order_id IN (${marks})`).run(...ids);
      db.prepare(`DELETE FROM order_lines WHERE order_id IN (${marks})`).run(...ids);
      db.prepare(`DELETE FROM orders WHERE id IN (${marks})`).run(...ids);
    }
    db.exec(`DELETE FROM delivery_runs WHERE id NOT IN (SELECT DISTINCT run_id FROM delivery_stops)
             AND created_at >= '2026-01-01' AND notes = 'demo'`);
    db.exec(`DELETE FROM product_prices WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'DEMO-%')`);
    db.exec(`DELETE FROM packagings WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'DEMO-%')`);
    db.exec(`DELETE FROM purchase_lines WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'DEMO-%')`);
    db.exec("DELETE FROM purchases WHERE id NOT IN (SELECT DISTINCT purchase_id FROM purchase_lines)");
    db.exec("DELETE FROM products WHERE sku LIKE 'DEMO-%'");
    db.exec("DELETE FROM commission_rates WHERE salesperson_user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%')");
    db.exec("DELETE FROM visit_plans WHERE purpose IS NOT NULL");
    db.exec("DELETE FROM users WHERE username LIKE 'demo.%'");
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
  { username: "demo.mehdi", name: "مهدی کریمی", role: "salesperson" },
  { username: "demo.reza", name: "رضا مرادی", role: "salesperson" },
  { username: "demo.sara", name: "سارا نجفی", role: "salesperson" },
  { username: "demo.hossein", name: "حسین فلاح", role: "driver" },
];

db.exec("BEGIN IMMEDIATE");
try {
  const staff = {};
  for (const p of PEOPLE) {
    const found = plain(db.prepare("SELECT id FROM users WHERE username = ?").all(p.username))[0];
    if (found) {
      staff[p.username] = found.id;
      continue;
    }
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .run(p.username, LOCKED, p.name, p.role, owner.group_id, now);
    staff[p.username] = Number(lastInsertRowid);
  }
  const sellers = [staff["demo.mehdi"], staff["demo.reza"], staff["demo.sara"]];
  const driver = staff["demo.hossein"];

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

  /* ── customers to sell to ────────────────────────────────────────────────── */
  const customers = plain(
    db.prepare("SELECT id, business_name, group_id FROM customers ORDER BY id LIMIT 14").all()
  );
  if (!customers.length) throw new Error("no customers to attach demo orders to");

  /* ── orders ──────────────────────────────────────────────────────────────── */
  const already = plain(db.prepare("SELECT COUNT(*) c FROM orders WHERE order_no LIKE '1404-9%'").all())[0].c;
  if (already > 0) {
    db.exec("COMMIT");
    console.log(`demo orders already present (${already}) — nothing to do. Use --remove first to reseed.`);
    process.exit(0);
  }

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
  const created = [];
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
      let status = "delivered";
      if (day === 0) status = ["draft", "confirmed", "confirmed", "delivered", "delivered", "confirmed"][k];
      const delivered = status === "delivered";
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
  const onRun = created.filter((o) => o.date === runDate && o.status !== "draft").slice(0, 3);
  onRun.forEach((o, i) => {
    db.prepare(
      `INSERT OR IGNORE INTO delivery_stops (run_id, order_id, sort_order, status, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(runId, o.id, i, o.status === "delivered" ? "delivered" : "pending", now);
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

  /* ── commission rates, so the پورسانت page has statements ────────────────── */
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

  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

const n = (sql) => plain(db.prepare(sql).all())[0].c;
console.log("demo seeded:");
console.log("  products      ", n("SELECT COUNT(*) c FROM products WHERE sku LIKE 'DEMO-%'"));
console.log("  demo staff    ", n("SELECT COUNT(*) c FROM users WHERE username LIKE 'demo.%'"));
console.log("  orders        ", n("SELECT COUNT(*) c FROM orders WHERE order_no LIKE '1404-9%'"));
console.log("  order lines   ", n("SELECT COUNT(*) c FROM order_lines"));
console.log("  delivery stops", n("SELECT COUNT(*) c FROM delivery_stops"));
console.log("  planned visits", n("SELECT COUNT(*) c FROM visit_plans WHERE purpose IS NOT NULL"));
console.log("\nclear it again with:  node scripts/seed-demo.mjs --remove");
