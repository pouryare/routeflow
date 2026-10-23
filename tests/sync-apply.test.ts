import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { IncomingMutation } from "@/lib/repo/syncMutations";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-sync-apply-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop } = await import("@/lib/delivery");
const { deliveryForStop } = await import("@/lib/repo/deliveries");
const { advanceOrder } = await import("@/lib/repo/orders");
const { applyMutations } = await import("@/lib/repo/syncMutations");
const { setRoles } = await import("@/lib/repo/userRoles");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let custId = 0;
let product = 0;
let packaging = 0;

function mut(o: Partial<IncomingMutation> & { client_uuid: string; op: string }): IncomingMutation {
  return {
    payload: {},
    occurred_at: "2026-01-01T10:00:00.000Z",
    clock_skew_ms: 0,
    ...o,
  } as IncomingMutation;
}

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM sync_mutations; DELETE FROM reminders; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM delivery_lines; DELETE FROM deliveries; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM facilities; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number((await u.run(`o${Date.now()}`, "x:y", "م", "owner", now)).lastInsertRowid);
  driver = Number((await u.run(`d${Date.now()}`, "x:y", "ر", "delivery_driver", now)).lastInsertRowid);
  custId = Number(
    (await db
      .prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C1','x','active','2026-01-01',1)")
      .run()).lastInsertRowid
  );
await ensureWarehouse(getDb());
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  await setPrice(db, { product_id: product, price_toman: 1_000, valid_from: "2026-01-01" });
});

describe("applyMutations", () => {
  it("applies an offline order then its dependent payment, resolving the client ref", async () => {
    const res = await applyMutations(1, owner, [
      mut({
        client_uuid: "o1",
        op: "order.draftCreate",
        payload: {
          customer_id: custId,
          order_date: "2026-01-01",
          lines: [{ product_id: product, packaging_id: packaging, packs: 2 }],
        },
      }),
      mut({
        client_uuid: "p1",
        op: "payment.record",
        depends_on: ["o1"],
        payload: {
          customer_id: custId,
          amount_toman: 2000,
          method: "CASH",
          order_ref: "o1",
          allocations: [{ order_id: 0, amount_toman: 2000 }],
        },
      }),
    ]);
    expect(res.o1.status).toBe("applied");
    expect(res.p1.status).toBe("applied");
    const orderId = (res.o1 as { server_id: number }).server_id;
    const alloc = await getDb()
      .prepare(
        "SELECT pa.order_id FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE p.client_uuid = 'p1'"
      )
      .get() as { order_id: number };
    expect(alloc.order_id).toBe(orderId);
  });

  it("is idempotent -- replaying the batch makes no new rows", async () => {
    const batch: IncomingMutation[] = [
      mut({
        client_uuid: "o2",
        op: "order.draftCreate",
        payload: {
          customer_id: custId,
          order_date: "2026-01-01",
          lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
        },
      }),
    ];
    await applyMutations(1, owner, batch);
    const first = await getDb().prepare("SELECT COUNT(*) n FROM orders").get() as { n: number };
    const res2 = await applyMutations(1, owner, batch);
    expect(res2.o2.status).toBe("duplicate");
    expect((await getDb().prepare("SELECT COUNT(*) n FROM orders").get() as { n: number }).n).toBe(first.n);
  });

  it("conflicts a delivery.complete for an order the server has cancelled, and raises a reminder", async () => {
    const db = getDb();
    const o = await createOrder(db, {
      customer_id: custId,
      order_date: "2026-01-01",
      created_by: owner,
      organization_id: 1,
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    });
    await confirmOrder(db, o.id);
    const run = await createRun(db, { driver_user_id: driver, run_date: "2026-01-02", created_by: owner, organization_id: 1 });
    const stopId = await addStop(db, run, o.id);
    const deliveryId = (await deliveryForStop(1, stopId))!.id;
    await advanceOrder(1, o.id, "unplan", { id: owner, role: "owner" });
    await advanceOrder(1, o.id, "cancel", { id: owner, role: "owner" });

    const res = await applyMutations(1, driver, [
      mut({
        client_uuid: "d1",
        op: "delivery.complete",
        payload: { delivery_id: deliveryId, outcome: "delivered", collected_toman: 1000 },
      }),
    ]);
    expect(res.d1.status).toBe("conflict");
    expect((await db.prepare("SELECT COUNT(*) n FROM reminders").get() as { n: number }).n).toBe(1);
    expect(
      (await db.prepare("SELECT status FROM sync_mutations WHERE client_uuid='d1'").get() as { status: string }).status
    ).toBe("conflict");
  });

  it("fails a bad payment with the PaymentError message and stamps the mutation failed", async () => {
    const res = await applyMutations(1, owner, [
      mut({
        client_uuid: "bad1",
        op: "payment.record",
        payload: { customer_id: custId, amount_toman: 12.5, method: "CASH" },
      }),
    ]);
    expect(res.bad1.status).toBe("failed");
    expect(
      (await getDb().prepare("SELECT status FROM sync_mutations WHERE client_uuid='bad1'").get() as { status: string }).status
    ).toBe("failed");
  });

  it("lets a DUAL-HAT driver deliver offline, with field_rep as their primary", async () => {
    // The sharpest edge in the whole design, and the one the spec says the two-tier model
    // breaks: this person's primary is field_rep, so the old single-role lookup authorised
    // them as field_rep, the delivery edge refused, no error reached the van, and the stop
    // was simply never marked. Here they HOLD delivery_driver too, so it must apply.
    const db = getDb();
    await setRoles(driver, ["field_rep", "delivery_driver"]);
    await db.prepare("UPDATE users SET role = 'field_rep' WHERE id = ?").run(driver);

    const o = await createOrder(db, {
      customer_id: custId,
      order_date: "2026-01-01",
      created_by: owner,
      organization_id: 1,
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    });
    await confirmOrder(db, o.id);
    const run = await createRun(db, { driver_user_id: driver, run_date: "2026-01-02", created_by: owner, organization_id: 1 });
    const stopId = await addStop(db, run, o.id);
    const deliveryId = (await deliveryForStop(1, stopId))!.id;

    const res = await applyMutations(1, driver, [
      mut({
        client_uuid: "dual1",
        op: "delivery.complete",
        payload: { delivery_id: deliveryId, outcome: "delivered", collected_toman: 1000 },
      }),
    ]);

    // The point of the test: the mutation APPLIED. The resulting status is CLOSED, not
    // DELIVERED — a fully-collected order settles. I first asserted DELIVERED and the
    // failure was the assertion, not the code: the guard had already stopped refusing.
    expect(res.dual1.status).toBe("applied");
    const st = await db.prepare("SELECT status FROM orders WHERE id = ?").get(o.id) as { status: string };
    expect(st.status).toBe("CLOSED");
  });

  it("records a delivery.complete from a NON-driver without complaint (pre-existing gap)", async () => {
    // NOT a regression, and deliberately NOT asserted as a fix. `completeDelivery` takes
    // only { id } and never checks a role, so any account with a session can complete a
    // delivery through the sync endpoint. That is pre-existing behaviour in both the online
    // and offline paths, it is the same in the committed code before this task, and
    // tightening it is a separate change with its own blast radius.
    //
    // Recorded here so the gap is visible and this test does not quietly become the thing
    // that "proves" the offline path is role-safe. The role-5 test that DOES prove it is
    // the dual-hat case above, which failed before the set was threaded through.
    const db = getDb();
    const o = await createOrder(db, {
      customer_id: custId,
      order_date: "2026-01-01",
      created_by: owner,
      organization_id: 1,
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    });
    await confirmOrder(db, o.id);
    const run = await createRun(db, { driver_user_id: driver, run_date: "2026-01-02", created_by: owner, organization_id: 1 });
    const stopId = await addStop(db, run, o.id);
    const deliveryId = (await deliveryForStop(1, stopId))!.id;

    const res = await applyMutations(1, owner, [
      mut({
        client_uuid: "notadriver",
        op: "delivery.complete",
        payload: { delivery_id: deliveryId, outcome: "delivered", collected_toman: 1000 },
      }),
    ]);
    // Documenting today's behaviour, not endorsing it. See the comment above.
    expect(res.notadriver.status).toBe("applied");
  });

  describe("cheque and complaint facts made offline", () => {
    const today = () => new Date().toISOString().slice(0, 10);
    const cheque = (extra: Record<string, unknown> = {}) => ({
      customer_id: custId,
      amount_toman: 5_000_000,
      cheque_no: "123456",
      bank_name: "ملی",
      due_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      received_at: new Date().toISOString(),
      ...extra,
    });
    it("a manager's cheque lands once, and replaying the batch adds nothing", async () => {
      const batch = [mut({ client_uuid: "ch1", op: "cheque.record", payload: cheque() })];
      expect((await applyMutations(1, owner, batch)).ch1.status).toBe("applied");
      await applyMutations(1, owner, batch);
      expect((await getDb().prepare("SELECT COUNT(*) AS n FROM cheques").get() as { n: number }).n).toBe(1);
    });
    it("a cheque from someone who may not record cheques, or with bad data, is refused", async () => {
      expect((await applyMutations(1, driver, [mut({ client_uuid: "ch2", op: "cheque.record", payload: cheque() })])).ch2.status).toBe("failed");
      expect((await applyMutations(1, owner, [mut({ client_uuid: "ch3", op: "cheque.record", payload: cheque({ amount_toman: 12.5 }) })])).ch3.status).toBe("failed");
      expect((await applyMutations(1, owner, [mut({ client_uuid: "ch4", op: "cheque.record", payload: cheque({ due_date: "zzz" }) })])).ch4.status).toBe("failed");
    });
    it("a complaint is filed once; an unknown category is refused", async () => {
      const ok = mut({ client_uuid: "cp1", op: "complaint.record", payload: { customer_id: custId, category: "spoilage", severity: "high", description: "بد بو" } });
      expect((await applyMutations(1, owner, [ok])).cp1.status).toBe("applied");
      await applyMutations(1, owner, [ok]);
      expect((await getDb().prepare("SELECT COUNT(*) AS n FROM quality_complaints").get() as { n: number }).n).toBe(1);
      expect((await applyMutations(1, owner, [mut({ client_uuid: "cp2", op: "complaint.record", payload: { category: "nope" } })])).cp2.status).toBe("failed");
      void today;
    });
  });
});
