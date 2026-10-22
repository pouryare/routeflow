/* Backfills that getDb() runs on every boot after the schema is in place: they derive rows or
 * columns that older databases lack (ledger postings for legacy payments, the stock ledger, order
 * events, reminder tasks, folded lead pins). Each is idempotent. Moved out of lib/db.ts unchanged;
 * lib/db.ts re-exports the public ones (`export * from "./database/backfills"`). */
import type { DatabaseSync } from "node:sqlite";
import { indexStatementsOf } from "./rebuilds";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "../orderStateMachine";
import { postJournal } from "../repo/ledgerCore";

/** Phase 1: before this deploy, a delivery stamped `orders.paid_toman` directly. After
 *  it, that column is a cache recomputed from `payment_allocations` -- so every legacy
 *  order with `paid_toman > 0` and no allocation needs a synthetic payment behind it,
 *  or the first `recomputeOrderPayment` on that customer would silently reset it to 0.
 *
 *  One CASH payment per such order, dated `delivered_at` (or the order date), attributed
 *  to `created_by`, allocated wholly to the order. If the recorded amount exceeds the
 *  order's own line total (bad legacy data) it is capped and the note says so. Guarded
 *  on an app_meta marker and self-guarded by the `NOT EXISTS` clause, so a re-run is a
 *  no-op. */
export function backfillLegacyPayments(db: DatabaseSync): void {
  const done = db
    .prepare("SELECT value FROM app_meta WHERE key = 'legacy_payment_backfill_done'")
    .get() as { value: string } | undefined;
  if (done) return;

  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT o.id, o.customer_id, o.organization_id, o.created_by, o.paid_toman,
              COALESCE(o.delivered_at, o.order_date) AS when_paid,
              COALESCE((
                SELECT SUM(ROUND(COALESCE(ol.packs_delivered, ol.packs_ordered) * ol.unit_price_toman))
                  FROM order_lines ol WHERE ol.order_id = o.id
              ), 0) AS total_toman
         FROM orders o
        WHERE o.paid_toman > 0
          AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.order_id = o.id)`
    )
    .all() as Array<{
    id: number;
    customer_id: number;
    organization_id: number | null;
    created_by: number;
    paid_toman: number;
    when_paid: string;
    total_toman: number;
  }>;

  db.exec("BEGIN IMMEDIATE");
  try {
    const insPay = db.prepare(
      `INSERT INTO payments
         (organization_id, customer_id, amount_toman, method, received_at, received_by, note, created_at)
       VALUES (?, ?, ?, 'CASH', ?, ?, ?, ?)`
    );
    const insAlloc = db.prepare(
      "INSERT INTO payment_allocations (payment_id, order_id, amount_toman, created_at) VALUES (?, ?, ?, ?)"
    );
    for (const o of rows) {
      const cap = o.total_toman > 0 ? Math.min(o.paid_toman, o.total_toman) : o.paid_toman;
      const note =
        cap < o.paid_toman
          ? "انتقال از سیستم قبلی (سقف‌گذاری‌شده)"
          : "انتقال از سیستم قبلی";
      const paymentId = Number(
        insPay.run(o.organization_id ?? 1, o.customer_id, cap, o.when_paid, o.created_by, note, now)
          .lastInsertRowid
      );
      insAlloc.run(paymentId, o.id, cap, now);
    }
    db.prepare(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('legacy_payment_backfill_done', ?)"
    ).run(now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Phase 2: turn the legacy derived-stock world into a movement ledger. Every purchase
 *  line becomes a batch (LEGACY-PL<id>, undated) plus a PURCHASE_IN; every delivered
 *  order line becomes DELIVERY_OUT movements against those batches, oldest first. The
 *  invariant this preserves is per-product on-hand -- after the run,
 *  SUM(stock_movements.base_qty) for a product equals the old purchased minus delivered.
 *  Guarded on an app_meta marker and by per-row existence checks, so a re-run is a
 *  no-op. Pure SQL here rather than lib/repo to avoid a db.ts <-> repo import cycle. */
export function seedAccounts(db: DatabaseSync): void {
  /* The leading digit carries the statement, so a code can be read without opening the
     row: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx revenue, 5xxx expenses. The
     first draft of the spec numbered equity 22xx and revenue 41xx while the group headers
     claimed 3000 and 4000 -- each sitting inside the previous category's block, which is
     exactly what a code exists to prevent. tests/ledger-schema.test.ts asserts the
     invariant so it cannot drift back.

     Idempotent by code, so it runs on every boot. is_system=1 marks these as the shared
     taxonomy rather than a tenant's own additions: a user may ADD accounts, never edit
     these, and retiring one is active=0, never a delete (see accounts_no_delete). */
  const rows: ReadonlyArray<readonly [string, string, string, string, string, number]> = [
    // code,   name_fa,               name_en,               type,        normal_balance, is_postable
    ["1000", "دارایی‌ها", "Assets", "ASSET", "DEBIT", 0],
    ["1101", "صندوق", "Cash on hand", "ASSET", "DEBIT", 1],
    ["1102", "بانک", "Bank account", "ASSET", "DEBIT", 1],
    ["1103", "تنخواه گردان", "Petty cash", "ASSET", "DEBIT", 1],
    ["1201", "حساب‌های دریافتنی", "Accounts receivable", "ASSET", "DEBIT", 1],
    ["1202", "چک‌های دریافتنی", "Cheques receivable", "ASSET", "DEBIT", 1],
    ["1203", "موجودی کالا", "Inventory", "ASSET", "DEBIT", 1],
    ["1301", "پیش‌پرداخت", "Prepayments", "ASSET", "DEBIT", 1],
    ["2000", "بدهی‌ها", "Liabilities", "LIABILITY", "CREDIT", 0],
    ["2101", "حساب‌های پرداختنی", "Accounts payable", "LIABILITY", "CREDIT", 1],
    ["2102", "چک‌های پرداختنی", "Cheques payable", "LIABILITY", "CREDIT", 1],
    /* 2103 exists because the commission subsystem already knows what a rep is owed.
       Without a liability here, commission is invisible on the balance sheet: the app
       knows the number and the books do not. */
    ["2103", "تعهدات کمیسیون", "Commission payable", "LIABILITY", "CREDIT", 1],
    /* 2104 is seeded and never written in this slice. It is the seam for the tax reporting
       Q2 deferred: a VAT line can later map to an account that has existed since day one,
       rather than a schema change on posted history. */
    ["2104", "مالیات پرداختنی", "Taxes payable", "LIABILITY", "CREDIT", 1],
    ["3000", "سرمایه", "Equity", "EQUITY", "CREDIT", 0],
    ["3101", "سرمایه اولیه", "Capital", "EQUITY", "CREDIT", 1],
    ["3102", "برداشت و اضافه‌برداشت", "Owner's drawings", "EQUITY", "DEBIT", 1],
    ["3103", "سود انباشته", "Retained earnings", "EQUITY", "CREDIT", 1],
    ["4000", "درآمدها", "Revenue", "REVENUE", "CREDIT", 0],
    ["4101", "فروش", "Sales revenue", "REVENUE", "CREDIT", 1],
    ["4102", "برگشت از فروش", "Sales returns", "REVENUE", "DEBIT", 1],
    ["5000", "هزینه‌ها", "Expenses", "EXPENSE", "DEBIT", 0],
    /* 5101 is COGS and is posted by delivery recognition, never entered by hand. It is
       excluded from the expense dropdown: a manual expense against it would double-count
       the cost of goods already recognised on the sale. */
    ["5101", "بهای تمام‌شده", "Cost of goods sold", "EXPENSE", "DEBIT", 1],
    ["5102", "اجاره", "Rent", "EXPENSE", "DEBIT", 1],
    ["5103", "حقوق", "Salary", "EXPENSE", "DEBIT", 1],
    ["5104", "سوخت و حمل", "Fuel and delivery", "EXPENSE", "DEBIT", 1],
    ["5105", "تلفن و اینترنت", "Phone and internet", "EXPENSE", "DEBIT", 1],
    ["5106", "سایر", "Other expenses", "EXPENSE", "DEBIT", 1],
  ];
  const ins = db.prepare(
    `INSERT INTO accounts (code, name_fa, name_en, type, normal_balance, is_postable, is_system, active)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1)
     ON CONFLICT(code) DO NOTHING`
  );
  for (const r of rows) ins.run(r[0], r[1], r[2], r[3], r[4], r[5]);
}

/** Turn existing payments into ledger postings.
 *
 *  There is deliberately NO app_meta marker here, and
 *  tests/no-one-shot-data-migration.test.ts is why. A marker is the right tool when a
 *  migration converts an old REPRESENTATION that stops existing afterwards -- the three
 *  exemptions in that file are all of that kind, where `paid_toman` is dropped and a row
 *  arriving later is already in the new shape.
 *
 *  This is not that. A `payments` row survives the backfill and is the screen's own
 *  source of truth, so "have I posted it yet" is a fact about a ROW, not about time.
 *  Guarded on a marker, every receipt taken after the first boot would be silently
 *  unposted -- which is precisely the quiet divergence the ledger section exists to
 *  prevent. My first draft had the marker and was caught by that test.
 *
 *  So the predicate is per-row and lives in the query: `NOT EXISTS` on
 *  (source_type, source_id) is both the work list and the idempotency proof. Running on
 *  every boot is cheap -- it is one indexed anti-join over payments -- and it is correct
 *  by construction rather than correct-until-someone-adds-a-payment.
 *
 *  Voided payments are skipped: they have a reversal, not a receipt. Historical orders
 *  are NOT recognised for revenue here, because product_costs is effective-dated and new
 *  and today's average is not what the goods cost then -- a wrong number that looks
 *  right is worse than an absent one. That P&L is labelled cost-incomplete.
 *
 *  The receipt is ONLY cash/bank vs receivables. It does not recognise revenue even when
 *  the payment is allocated to orders: the cash arrived and the debt fell, which is a
 *  different event from the goods moving. Recognition posts on delivery (Task 7). */
export function backfillLedger(db: DatabaseSync): void {
  const acct = (code: string) =>
    db.prepare("SELECT id FROM accounts WHERE code = ?").get(code) as { id: number } | undefined;
  const cash = acct("1101");
  const bank = acct("1102");
  const ar = acct("1201");
  // The chart has not been seeded yet; leave the marker unset so a later boot does the work.
  if (!cash || !bank || !ar) return;

  const rows = db
    .prepare(
      `SELECT p.id, p.organization_id, p.customer_id, p.amount_toman, p.method,
              p.received_at, p.received_by
         FROM payments p
        WHERE p.voided_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM journals j
             WHERE j.source_type = 'PAYMENT' AND j.source_id = p.id
          )`
    )
    .all() as Array<{
    id: number;
    organization_id: number | null;
    customer_id: number;
    amount_toman: number;
    method: string;
    received_at: string;
    received_by: number;
  }>;

  /* CREDIT_NOTE and OTHER are NOT silently treated as bank. A credit note is not money
     received, and 'OTHER' says nothing about where the value went; posting either to
     1102 invents a fact. They are recorded as UNMAPPED for a human instead -- see
     unmappedBackfillPayments() -- and the reconciliation test asserts the count, so the
     gap between payments and the ledger is visible rather than quiet. */
  const mappable = rows.filter((p) => p.method !== "CREDIT_NOTE" && p.method !== "OTHER");

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const p of mappable) {
      const cashAccount = p.method === "CASH" ? cash.id : bank.id;
      postJournal(db, {
        organizationId: p.organization_id ?? 1,
        postedAt: p.received_at,
        sourceType: "PAYMENT",
        sourceId: p.id,
        createdBy: p.received_by,
        memo: "انتقال از سیستم قبلی",
        legs: [
          { accountId: cashAccount, side: "D", amountToman: p.amount_toman },
          {
            accountId: ar.id,
            side: "C",
            amountToman: p.amount_toman,
            customerId: p.customer_id,
          },
        ],
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Payments the backfill deliberately did NOT post, because no account honestly holds
 *  them. Returned rather than logged so the reconciliation gate can assert on the number
 *  and a future report can offer a human a list to fix. */
export function unmappedBackfillPayments(db: DatabaseSync): {
  id: number;
  amount_toman: number;
  method: string;
  received_at: string;
}[] {
  return db
    .prepare(
      `SELECT p.id, p.amount_toman, p.method, p.received_at
         FROM payments p
        WHERE p.voided_at IS NULL
          AND p.method IN ('CREDIT_NOTE','OTHER')
          AND NOT EXISTS (
            SELECT 1 FROM journals j
             WHERE j.source_type = 'PAYMENT' AND j.source_id = p.id
          )`
    )
    .all() as { id: number; amount_toman: number; method: string; received_at: string }[];
}

/** Fold the free-text purchases.supplier into real supplier rows and give purchases a
 *  supplier_id.
 *
 *  Rebuild-and-copy, because SQLite cannot add a foreign key to an existing table --
 *  the same reason payments.cheque_id has none. Idempotent two ways: the PRAGMA check
 *  short-circuits a re-run, and INSERT OR IGNORE on the unique index is the guard that
 *  keeps a re-run from creating duplicate suppliers.
 *
 *  The legacy `supplier` TEXT column is KEPT. It is the only record of the original
 *  string when two suppliers normalise to the same name after trimming, and dropping it
 *  buys tidiness at the price of irreversible data loss.
 *
 *  `organization_id` is carried through as-is: the boot backfill stamps it before this
 *  runs, and COALESCE only covers a hand-seeded row. */
export function migratePurchaseSuppliers(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(purchases)").all() as { name: string }[];
  if (cols.some((c) => c.name === "supplier_id")) return; // already migrated

  const now = new Date().toISOString();
  const purchaseIndexes = indexStatementsOf(db, "purchases");
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchases_tn_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier TEXT,
        supplier_id INTEGER REFERENCES suppliers(id),
        purchase_date TEXT NOT NULL,
        invoice_no TEXT,
        notes TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        organization_id INTEGER
      );
      INSERT INTO purchases_tn_new
        (id, supplier, purchase_date, invoice_no, notes, created_by, created_at, organization_id)
      SELECT id, supplier, purchase_date, invoice_no, notes, created_by, created_at, organization_id
        FROM purchases;
      DROP TABLE purchases;
      ALTER TABLE purchases_tn_new RENAME TO purchases;
    `);
    for (const sql of purchaseIndexes) db.exec(sql);
    /* OR IGNORE against ux_suppliers_org_name, and the name is TRIM'd because two
       spellings with stray whitespace are the same vendor far more often than not. */
    db.prepare(
      `INSERT OR IGNORE INTO suppliers (organization_id, name, created_at)
       SELECT DISTINCT COALESCE(organization_id, 1), TRIM(supplier), ?
         FROM purchases WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''`
    ).run(now);
    db.prepare(
      `UPDATE purchases SET supplier_id = (
         SELECT s.id FROM suppliers s
          WHERE s.name = TRIM(purchases.supplier)
            AND s.organization_id = COALESCE(purchases.organization_id, 1))
       WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''`
    ).run();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

export function backfillStockLedger(db: DatabaseSync): void {
  const done = db
    .prepare("SELECT value FROM app_meta WHERE key = 'stock_ledger_backfill_done'")
    .get() as { value: string } | undefined;
  if (done) return;

  const facility = db
    .prepare(
      "SELECT id FROM facilities ORDER BY (kind <> 'warehouse'), (kind <> 'home_base'), id LIMIT 1"
    )
    .get() as { id: number } | undefined;
  if (!facility) {
    // No facility to attach stock to yet -- seedFacilities has not run. Leave the marker
    // unset so the next boot (after seeding) does the work.
    return;
  }
  const facilityId = facility.id;
  const now = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    // --- purchases -> batches + PURCHASE_IN -----------------------------------------
    const purchaseLines = db
      .prepare(
        `SELECT pl.id, pl.product_id, pl.base_qty, pl.unit_cost_toman,
                pu.purchase_date, COALESCE(pu.organization_id, 1) AS org
           FROM purchase_lines pl JOIN purchases pu ON pu.id = pl.purchase_id
          WHERE NOT EXISTS (SELECT 1 FROM batches b WHERE b.purchase_line_id = pl.id)`
      )
      .all() as Array<{
      id: number;
      product_id: number;
      base_qty: number;
      unit_cost_toman: number;
      purchase_date: string;
      org: number;
    }>;

    const insBatch = db.prepare(
      `INSERT INTO batches
         (organization_id, product_id, batch_code, purchase_line_id, produced_at, expiry_date,
          qty_received_base, unit_cost_toman, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'active', ?, ?)`
    );
    const insMove = db.prepare(
      `INSERT INTO stock_movements
         (organization_id, facility_id, product_id, batch_id, base_qty, kind, ref_type, ref_id,
          occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const pl of purchaseLines) {
      const batchId = Number(
        insBatch.run(
          pl.org,
          pl.product_id,
          `LEGACY-PL${pl.id}`,
          pl.id,
          pl.purchase_date,
          pl.base_qty,
          pl.unit_cost_toman,
          now,
          now
        ).lastInsertRowid
      );
      insMove.run(
        pl.org,
        facilityId,
        pl.product_id,
        batchId,
        pl.base_qty,
        "PURCHASE_IN",
        "purchase_line",
        pl.id,
        pl.purchase_date,
        now
      );
    }

    // --- deliveries -> DELIVERY_OUT (oldest batch first) --------------------------
    const deliveredLines = db
      .prepare(
        `SELECT ol.id, ol.product_id, ol.order_id,
                (COALESCE(ol.packs_delivered, 0) * ol.qty_per_pack) AS base_qty,
                COALESCE(o.delivered_at, o.order_date) AS occurred_at,
                COALESCE(o.organization_id, 1) AS org
           FROM order_lines ol JOIN orders o ON o.id = ol.order_id
          WHERE o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)}) AND COALESCE(ol.packs_delivered, 0) > 0
            AND NOT EXISTS (SELECT 1 FROM delivery_line_batches d WHERE d.order_line_id = ol.id)
            AND NOT EXISTS (SELECT 1 FROM stock_movements m
                             WHERE m.ref_type = 'order_line' AND m.ref_id = ol.id AND m.kind = 'DELIVERY_OUT')
          ORDER BY occurred_at, ol.id`
      )
      .all() as Array<{
      id: number;
      product_id: number;
      order_id: number;
      base_qty: number;
      occurred_at: string;
      org: number;
    }>;

    const insDlb = db.prepare(
      `INSERT INTO delivery_line_batches
         (organization_id, delivery_stop_id, order_line_id, batch_id, base_qty, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const stopForOrder = db.prepare(
      "SELECT id FROM delivery_stops WHERE order_id = ? ORDER BY id LIMIT 1"
    );

    // Running on-hand per batch, seeded from the PURCHASE_IN rows just written.
    const onHandByBatch = new Map<number, number>();
    for (const r of db
      .prepare(
        "SELECT batch_id, COALESCE(SUM(base_qty), 0) AS n FROM stock_movements WHERE batch_id IS NOT NULL GROUP BY batch_id"
      )
      .all() as Array<{ batch_id: number; n: number }>) {
      onHandByBatch.set(r.batch_id, r.n);
    }

    const batchesForProduct = db.prepare(
      `SELECT id FROM batches WHERE product_id = ? AND organization_id = ?
        ORDER BY (expiry_date IS NULL), expiry_date, id`
    );

    for (const dl of deliveredLines) {
      let left = dl.base_qty;
      const stop = stopForOrder.get(dl.order_id) as { id: number } | undefined;
      const batchIds = (batchesForProduct.all(dl.product_id, dl.org) as Array<{ id: number }>).map(
        (b) => b.id
      );

      for (const bId of batchIds) {
        if (left <= 1e-9) break;
        const avail = onHandByBatch.get(bId) ?? 0;
        if (avail <= 0) continue;
        const take = Math.min(left, avail);
        insMove.run(
          dl.org,
          facilityId,
          dl.product_id,
          bId,
          -take,
          "DELIVERY_OUT",
          "order_line",
          dl.id,
          dl.occurred_at,
          now
        );
        if (stop) insDlb.run(dl.org, stop.id, dl.id, bId, take, now);
        onHandByBatch.set(bId, avail - take);
        left -= take;
      }

      if (left > 1e-9) {
        // Oversold beyond every batch -- an unbatched shortfall, so on-hand still goes
        // negative rather than the delivery vanishing.
        insMove.run(
          dl.org,
          facilityId,
          dl.product_id,
          null,
          -left,
          "DELIVERY_OUT",
          "order_line",
          dl.id,
          dl.occurred_at,
          now
        );
        if (stop) insDlb.run(dl.org, stop.id, dl.id, null, left, now);
      }
    }

    db.prepare(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('stock_ledger_backfill_done', ?)"
    ).run(now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Phase 3: the order machine's audit view reads `order_events`. Legacy orders predate
 *  the table, so give each one a single synthetic `create` row -- `from_status` NULL,
 *  `to_status` its current status, dated and attributed from the order itself -- so the
 *  timeline is never blank. Guarded on an app_meta marker; the `NOT EXISTS` clause makes
 *  a stray re-run a no-op too. Pure SQL, same reason as backfillStockLedger. */
export function backfillOrderEvents(db: DatabaseSync): void {
  const done = db
    .prepare("SELECT value FROM app_meta WHERE key = 'order_events_backfill_done'")
    .get() as { value: string } | undefined;
  if (done) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      INSERT INTO order_events
        (organization_id, order_id, from_status, to_status, action, actor_user_id,
         reason_code_id, note, device_time, created_at)
      SELECT COALESCE(o.organization_id, 1), o.id, NULL, o.status, 'create', o.created_by,
             NULL, NULL, NULL, o.created_at
        FROM orders o
       WHERE NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id);
    `);
    db.prepare(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('order_events_backfill_done', ?)"
    ).run(new Date().toISOString());
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Board & Pocket: fold every customer-scoped `reminders` row into the Phase 7 `tasks`
 *  spine as `kind='reminder'`, so the Pocket and the Board see it and new customer
 *  reminders can route through `tasks` from here on. District reminders stay on the map.
 *  Guarded on an app_meta marker; the `NOT EXISTS` clause makes a stray re-run a no-op
 *  too. organization_id / group_id come from the customer. */
export function backfillReminderTasks(db: DatabaseSync): void {
  const done = db
    .prepare("SELECT value FROM app_meta WHERE key = 'board_pocket_reminders_folded'")
    .get() as { value: string } | undefined;
  if (done) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      INSERT INTO tasks
        (organization_id, assignee_user_id, role_hint, group_id, kind, title,
         entity_type, entity_id, due_at, priority, status, outcome_code, outcome_note,
         created_by, created_at, done_at, stage)
      SELECT c.organization_id, NULL, 'salesperson', c.group_id, 'reminder', r.message,
             'customer', r.entity_id, r.due_date, 'NORMAL',
             CASE WHEN r.resolved = 1 THEN 'done' ELSE 'open' END, NULL, NULL,
             NULL, r.created_at,
             CASE WHEN r.resolved = 1 THEN r.created_at ELSE NULL END, NULL
        FROM reminders r
        JOIN customers c ON c.id = r.entity_id
       WHERE r.entity_type = 'customer'
         AND NOT EXISTS (
           SELECT 1 FROM tasks t
            WHERE t.kind = 'reminder' AND t.entity_type = 'customer'
              AND t.entity_id = r.entity_id AND t.title = r.message
              AND t.created_at = r.created_at
         );
    `);
    db.prepare(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('board_pocket_reminders_folded', ?)"
    ).run("1");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Phase 0b: a pin that made it into a lead list is a relationship worth tracking, not
 *  just a dot on the map. Promote each such saved_location to a `customers` row
 *  (`lifecycle='lead'`, code `LEAD-<id>` -- the same scheme /api/locations/[id]/convert
 *  uses, so it cannot collide with a manually-converted pin) and delete the pin and its
 *  list membership. Pins in no list stay as pins. Idempotent: `ON CONFLICT DO NOTHING`
 *  on the code, so a second run is a no-op. */
/** What one pass of the fold did. Returned, not merely logged, because the whole failure
 *  mode of this migration is silence: a pin silently not promoted, a stop silently
 *  destroyed. A test can assert a return value; it cannot assert a log line. */
export interface LeadPinFoldResult {
  /** Pins promoted to `customers` and deleted from `saved_locations`. */
  promoted: number[];
  /** Pins left alone because a `lead_run_stops` row points at them. */
  skipped: number[];
}

export function foldLeadPinsIntoCustomers(db: DatabaseSync): LeadPinFoldResult {
  /* NOT EXISTS is the whole precondition, and it is unconditional.
   *
   * lead_run_stops.location_id is `REFERENCES saved_locations(id) ON DELETE CASCADE`
   * (schema), and the loop below issues a hand-written `DELETE FROM saved_locations`.
   * So promoting a pin that is on a run would delete the pin, the cascade would take the
   * stop with it, and SQLite would call the whole transaction correct. A driver's
   * assigned work — a promise the office made that morning — gone, silently.
   *
   * The count of affected rows cannot be measured in advance: on a dev database it is a
   * handful, on a real one it is zero or every run in the business. So the guard does not
   * depend on the count.
   *
   * A finished run releases its leads. The join and the `status != 'done'` are the same
   * rule `readLeadRunAssignments` already reasons about (lib/repo/leadRuns.ts:149), not a
   * new one invented here — so the pin is promoted on a later boot rather than never. The
   * migration is eventually consistent with the runs, not destructive to them.
   *
   * The join is what makes that work. Checking only `lead_run_stops` would skip the pin
   * FOREVER, because the stop row outlives the run's status: a run that finished still
   * has its stops, and a stop is the thing whose deletion we are avoiding.
   *
   * `lead_import_items` is here too, and it is the one that bites. A pasted import row
   * carries `saved_location_id INTEGER REFERENCES saved_locations(id)` (lib/db.ts:1069) —
   * no CASCADE, no NOT NULL, so `PRAGMA foreign_key_check` reports nothing for it, and a
   * read of the schema's CASCADE clauses alone would miss it too. Deleting such a pin
   * raises FOREIGN KEY constraint failed and aborts the whole transaction, which on a real
   * database meant /leads could not boot at all. Every referrer gets a vote, because the
   * question is "does any row still point at this pin", not "does any row CASCADE". */
  const pins = db
    .prepare(
      `SELECT DISTINCT s.id, s.name, s.address, s.lat, s.lng, s.notes, s.group_id, s.organization_id
         FROM saved_locations s
         JOIN lead_list_items i ON i.location_id = s.id
        WHERE NOT EXISTS (
                SELECT 1 FROM lead_run_stops st
                  JOIN delivery_runs r ON r.id = st.run_id
                 WHERE st.location_id = s.id AND r.status != 'done')
          AND NOT EXISTS (
                SELECT 1 FROM lead_import_items ii WHERE ii.saved_location_id = s.id)`
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
  /* Every pin that is in a list AND still pointed at by something — the SAME predicate
     the SELECT above uses, so the two cannot disagree. Counted before the loop so the
     number reported is the number DECLINED, not merely what is left over: a skipped pin
     is still a pin, and the operator is the one who needs to hear about it. */
  const skipped = (
    db
      .prepare(
        `SELECT s.id FROM saved_locations s
           JOIN lead_list_items i ON i.location_id = s.id
          WHERE EXISTS (
                  SELECT 1 FROM lead_run_stops st
                    JOIN delivery_runs r ON r.id = st.run_id
                   WHERE st.location_id = s.id AND r.status != 'done')
             OR EXISTS (
                  SELECT 1 FROM lead_import_items ii WHERE ii.saved_location_id = s.id)`,
      )
      .all() as unknown as { id: number }[]
  ).map((r) => r.id);

  if (pins.length === 0) {
    if (skipped.length > 0) reportFold(0, skipped);
    return { promoted: [], skipped };
  }

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

  const promotedIds = pins.map((p) => p.id);
  reportFold(promotedIds, skipped);
  return { promoted: promotedIds, skipped };
}

/** One line, so an operator can see a fold that declined work without opening a log file.
 *  Silent is the failure mode this whole migration is about. */
function reportFold(promoted: number | number[], skipped: number[]): void {
  const n = typeof promoted === "number" ? promoted : promoted.length;
  if (n === 0 && skipped.length === 0) return;
  console.log(
    `[lead-pin-fold] ${n} promoted, ${skipped.length} waiting on a run` +
      (skipped.length ? ` (${skipped.join(", ")})` : ""),
  );
}
