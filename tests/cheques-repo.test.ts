import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-cheques-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { recordChequePayment, advanceCheque, listCheques, chequesByStatus, ChequeError } =
  await import("@/lib/repo/cheques");
const { customerDebt } = await import("@/lib/repo/payments");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let userId = 0;
let custId = 0;

function deliveredOrder(total: number, dateISO = "2026-01-01"): number {
  const db = getDb();
  const now = new Date().toISOString();
  const tag = Math.random().toString(36).slice(2);
  const orderId = Number(
    db
      .prepare(
        `INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,created_by,created_at,updated_at,organization_id)
         VALUES (?,?,?,'DELIVERED',?,?,?,?,1)`
      )
      .run(`o-${tag}`, custId, dateISO, dateISO, userId, now, now).lastInsertRowid
  );
  const productId = Number(
    db
      .prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES (?,?,?,?,1)")
      .run(`p${tag}`, `s${tag}`, now, now).lastInsertRowid
  );
  const packId = Number(
    db
      .prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,?,1,?)")
      .run(productId, "box", now).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at)
     VALUES (?,?,?,1,1,?,0,1,1,0,?)`
  ).run(orderId, productId, packId, total, now);
  return orderId;
}

beforeEach(() => {
  const db = getDb();
  /* A cheque that settles an order goes through the payment path, which posts a
     ledger receipt whose AR leg REFERENCES customers(id). The ledger is append-only by
     trigger, so `DELETE FROM customers` below raises FOREIGN KEY constraint failed.
     Children before parents -- see tests/helpers/ledgerTeardown.ts, including its scope
     warning about never making this a global setupFiles hook. */
  clearLedger(db);

  db.exec(
    "DELETE FROM reminders; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM cheques; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id > 0;"
  );
  const now = new Date().toISOString();
  userId = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'group_manager',NULL,1,?,1)"
      )
      .run(`u${Date.now()}`, "x:y", "م", now).lastInsertRowid
  );
  custId = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES (?,?,'RESTAURANT','active','2026-01-01',1)"
      )
      .run(`C${Date.now()}`, "x").lastInsertRowid
  );
});

describe("recordChequePayment", () => {
  it("settles an order while the cheque is live", () => {
    const o1 = deliveredOrder(40_000);
    const { cheque_id } = recordChequePayment(1, {
      customer_id: custId,
      amount_toman: 40_000,
      cheque_no: "123",
      due_date: "2026-03-01",
      received_at: "2026-02-01",
      received_by: userId,
    });
    const db = getDb();
    expect((db.prepare("SELECT status FROM cheques WHERE id=?").get(cheque_id) as { status: string }).status).toBe(
      "in_hand"
    );
    expect(
      (db.prepare("SELECT payment_status FROM orders WHERE id=?").get(o1) as { payment_status: string })
        .payment_status
    ).toBe("paid");
    expect(customerDebt(1, custId).total).toBe(0);
  });

  it("rejects a duplicate cheque_no for the same customer", () => {
    deliveredOrder(1_000);
    recordChequePayment(1, {
      customer_id: custId,
      amount_toman: 1_000,
      cheque_no: "DUP",
      due_date: "2026-03-01",
      received_at: "2026-02-01",
      received_by: userId,
    });
    expect(() =>
      recordChequePayment(1, {
        customer_id: custId,
        amount_toman: 1_000,
        cheque_no: "DUP",
        due_date: "2026-04-01",
        received_at: "2026-02-02",
        received_by: userId,
      })
    ).toThrow(ChequeError);
  });
});

describe("advanceCheque", () => {
  it("rejects an illegal transition", () => {
    const { cheque_id } = recordChequePayment(1, {
      customer_id: custId,
      amount_toman: 1_000,
      cheque_no: "125",
      due_date: "2026-03-01",
      received_at: "2026-02-01",
      received_by: userId,
    });
    expect(() => advanceCheque(1, cheque_id, "cleared", userId)).toThrow(ChequeError);
  });

  it("clears cleanly through deposited -> cleared", () => {
    const { cheque_id } = recordChequePayment(1, {
      customer_id: custId,
      amount_toman: 1_000,
      cheque_no: "126",
      due_date: "2026-03-01",
      received_at: "2026-02-01",
      received_by: userId,
    });
    advanceCheque(1, cheque_id, "deposited", userId);
    advanceCheque(1, cheque_id, "cleared", userId);
    const c = getDb().prepare("SELECT * FROM cheques WHERE id=?").get(cheque_id) as {
      status: string;
      deposited_at: string | null;
      cleared_at: string | null;
    };
    expect(c.status).toBe("cleared");
    expect(c.deposited_at).not.toBeNull();
    expect(c.cleared_at).not.toBeNull();
  });

  it("re-opens exactly the orders a bounced cheque had settled and raises a reminder", () => {
    const o1 = deliveredOrder(40_000);
    const { cheque_id } = recordChequePayment(1, {
      customer_id: custId,
      amount_toman: 40_000,
      cheque_no: "124",
      due_date: "2026-03-01",
      received_at: "2026-02-01",
      received_by: userId,
    });
    advanceCheque(1, cheque_id, "deposited", userId);
    advanceCheque(1, cheque_id, "bounced", userId);
    const db = getDb();
    expect(
      db.prepare("SELECT paid_toman, payment_status FROM orders WHERE id=?").get(o1)
    ).toMatchObject({ paid_toman: 0, payment_status: "unpaid" });
    expect(
      (db.prepare("SELECT voided_at FROM payments WHERE cheque_id=?").get(cheque_id) as {
        voided_at: string | null;
      }).voided_at
    ).not.toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) n FROM reminders WHERE message LIKE '%124%'").get()
    ).toEqual({ n: 1 });
    expect(customerDebt(1, custId).total).toBe(40_000);
  });

  it("replaces a bounced cheque, re-settling the debt with the new one", () => {
    const o1 = deliveredOrder(40_000);
    const { cheque_id } = recordChequePayment(1, {
      customer_id: custId,
      amount_toman: 40_000,
      cheque_no: "200",
      due_date: "2026-03-01",
      received_at: "2026-02-01",
      received_by: userId,
    });
    advanceCheque(1, cheque_id, "bounced", userId);
    advanceCheque(1, cheque_id, "replaced", userId, {
      replacement: { cheque_no: "201", due_date: "2026-04-01" },
    });
    const db = getDb();
    const old = db.prepare("SELECT status, replaced_by_cheque_id FROM cheques WHERE id=?").get(cheque_id) as {
      status: string;
      replaced_by_cheque_id: number | null;
    };
    expect(old.status).toBe("replaced");
    expect(old.replaced_by_cheque_id).not.toBeNull();
    const fresh = db.prepare("SELECT status FROM cheques WHERE id=?").get(old.replaced_by_cheque_id) as {
      status: string;
    };
    expect(fresh.status).toBe("in_hand");
    expect(
      (db.prepare("SELECT payment_status FROM orders WHERE id=?").get(o1) as { payment_status: string })
        .payment_status
    ).toBe("paid");
    expect(customerDebt(1, custId).total).toBe(0);
  });

  it("keeps two orgs' identical cheque_no apart", () => {
    const db = getDb();
    db.prepare("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'Two','two','2026-01-01')").run();
    const c2 = Number(
      db
        .prepare(
          "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('X','x','active','2026-01-01',2)"
        )
        .run().lastInsertRowid
    );
    deliveredOrder(1_000);
    recordChequePayment(1, {
      customer_id: custId,
      amount_toman: 1_000,
      cheque_no: "SHARED",
      due_date: "2026-03-01",
      received_at: "2026-02-01",
      received_by: userId,
    });
    // Same cheque_no, other org -- allowed.
    expect(() =>
      recordChequePayment(2, {
        customer_id: c2,
        amount_toman: 1_000,
        cheque_no: "SHARED",
        due_date: "2026-03-01",
        received_at: "2026-02-01",
        received_by: userId,
      })
    ).not.toThrow();
    expect(listCheques(1).length).toBe(1);
    expect(listCheques(2).length).toBe(1);
    expect(chequesByStatus(1).in_hand.length).toBe(1);
  });
});
