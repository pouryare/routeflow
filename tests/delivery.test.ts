import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-delivery-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder, readOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery, DeliveryError, readDriverRuns } = await import(
  "@/lib/delivery"
);
const { orderFilter } = await import("@/lib/session");
import type { Session } from "@/lib/session";
import type { Role, UserRow } from "@/lib/db";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = {
  group: 0,
  owner: 0,
  driver: 0,
  otherDriver: 0,
  customer: 0,
  product: 0,
  packaging: 0,
  order: 0,
  run: 0,
};

function session(role: Role, uid: number, gid: number | null): Session {
  return {
    user: { id: uid, role, group_id: gid, organization_id: 1 } as UserRow,
    role,
    groupId: gid,
    organizationId: 1,
  };
}

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();

  ctx.group = Number(
    db
      .prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("شرق", "east", "#0ff", now).lastInsertRowid
  );
  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, 'x', ?, ?, ?, 1, ?)"
  );
  ctx.owner = Number(user.run("o", "مالک", "owner", null, now).lastInsertRowid);
  ctx.driver = Number(user.run("d1", "راننده یک", "driver", ctx.group, now).lastInsertRowid);
  ctx.otherDriver = Number(user.run("d2", "راننده دو", "driver", ctx.group, now).lastInsertRowid);

  ctx.customer = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)"
      )
      .run("C1", "رستوران نمونه", ctx.group, now).lastInsertRowid
  );

  ctx.product = createProduct(db, { name: "کره گیاهی", kg_per_base_unit: 0.25, organization_id: 1 });
  ctx.packaging = createPackaging(db, {
    product_id: ctx.product,
    name: "جعبه",
    qty_per_pack: 100,
  });
  setPrice(db, { product_id: ctx.product, price_toman: 440000, valid_from: "2026-01-01" });

  const order = createOrder(db, {
    customer_id: ctx.customer,
    order_date: "2026-08-26",
    created_by: ctx.owner,
    organization_id: 1,
    lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 3 }],
  });
  ctx.order = order.id;
  confirmOrder(db, ctx.order);

  ctx.run = createRun(db, {
    driver_user_id: ctx.driver,
    run_date: "2026-08-26",
    created_by: ctx.owner,
    organization_id: 1,
  });
  addStop(db, ctx.run, ctx.order);
});

describe("createRun", () => {
  it("refuses a second run for the same driver on the same day", () => {
    expect(() =>
      createRun(getDb(), {
        driver_user_id: ctx.driver,
        run_date: "2026-08-26",
        created_by: ctx.owner,
        organization_id: 1,
      })
    ).toThrow();
  });

  it("refuses a user who is not a driver", () => {
    expect(() =>
      createRun(getDb(), {
        driver_user_id: ctx.owner,
        run_date: "2026-09-01",
        created_by: ctx.owner,
        organization_id: 1,
      })
    ).toThrow(DeliveryError);
  });
});

describe("addStop", () => {
  it("refuses to add the same order to a run twice", () => {
    expect(() => addStop(getDb(), ctx.run, ctx.order)).toThrow();
  });

  it("refuses a draft order, which nobody has agreed to yet", () => {
    const db = getDb();
    const draft = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-26",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 }],
    });
    expect(() => addStop(db, ctx.run, draft.id)).toThrow(DeliveryError);
  });
});

describe("what a driver can see", () => {
  it("shows a driver the orders on their own run", () => {
    const f = orderFilter(session("driver", ctx.driver, ctx.group));
    const rows = getDb()
      .prepare(`SELECT o.id FROM orders o WHERE 1 = 1${f.sql}`)
      .all(...f.params) as { id: number }[];
    expect(rows.map((r) => r.id)).toContain(ctx.order);
  });

  it("hides the same order from a different driver", () => {
    const f = orderFilter(session("driver", ctx.otherDriver, ctx.group));
    const rows = getDb()
      .prepare(`SELECT o.id FROM orders o WHERE 1 = 1${f.sql}`)
      .all(...f.params) as { id: number }[];
    expect(rows.map((r) => r.id)).not.toContain(ctx.order);
  });

  it("shows a driver with no run at all nothing", () => {
    const f = orderFilter(session("driver", ctx.otherDriver, ctx.group));
    const rows = getDb()
      .prepare(`SELECT o.id FROM orders o WHERE 1 = 1${f.sql}`)
      .all(...f.params) as { id: number }[];
    expect(rows).toHaveLength(0);
  });
});

describe("readRun", () => {
  it("returns the stops with their orders and totals", () => {
    const run = readRun(getDb(), ctx.run)!;
    expect(run.stops).toHaveLength(1);
    expect(run.stops[0].customer_name).toBe("رستوران نمونه");
    expect(run.stops[0].total_toman).toBe(1320000); // 3 x 440000
  });

  it("reports what is still to collect", () => {
    const run = readRun(getDb(), ctx.run)!;
    expect(run.to_collect_toman).toBe(1320000);
    expect(run.remaining).toBe(1);
  });
});

describe("recordDelivery", () => {
  it("writes the delivered quantity onto the line", () => {
    const db = getDb();
    const run = readRun(db, ctx.run)!;
    const stop = run.stops[0];
    recordDelivery(db, stop.id, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 2 }],
      collected_toman: 880000,
      by: ctx.driver,
    });

    const order = readOrder(db, ctx.order)!;
    expect(order.lines[0].packs_delivered).toBe(2);
  });

  it("reprices the order from what was delivered, not what was ordered", () => {
    // The customer took two of the three boxes. The invoice, the weight and the
    // commission all follow the two.
    const order = readOrder(getDb(), ctx.order)!;
    expect(order.total_toman).toBe(880000);
    expect(order.kg).toBe(50); // 2 x 100 x 0.25
  });

  it("marks the order delivered and records the payment", () => {
    const row = getDb()
      .prepare("SELECT status, payment_status, paid_toman, delivered_at FROM orders WHERE id = ?")
      .get(ctx.order) as {
      status: string;
      payment_status: string;
      paid_toman: number;
      delivered_at: string;
    };
    // Phase 3: delivered AND fully settled -> the order closes itself.
    expect(row.status).toBe("CLOSED");
    expect(row.payment_status).toBe("paid");
    expect(row.paid_toman).toBe(880000);
    expect(row.delivered_at).not.toBeNull();
  });

  it("calls a short payment partial rather than paid", () => {
    const db = getDb();
    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-27",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-08-27",
      created_by: ctx.owner,
      organization_id: 1,
    });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops[0];

    recordDelivery(db, stopId, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 1 }],
      collected_toman: 100000,
      by: ctx.driver,
    });

    const row = db
      .prepare("SELECT payment_status, paid_toman FROM orders WHERE id = ?")
      .get(order.id) as { payment_status: string; paid_toman: number };
    expect(row.payment_status).toBe("partial");
    expect(row.paid_toman).toBe(100000);
  });

  it("treats a delivery of nothing as a refusal, not a delivery", () => {
    const db = getDb();
    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-28",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-08-28",
      created_by: ctx.owner,
      organization_id: 1,
    });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops[0];

    recordDelivery(db, stopId, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 0 }],
      collected_toman: 0,
      by: ctx.driver,
    });

    const stopRow = db.prepare("SELECT status FROM delivery_stops WHERE id = ?").get(stopId) as {
      status: string;
    };
    expect(stopRow.status).toBe("refused");
    const orderRow = db.prepare("SELECT status FROM orders WHERE id = ?").get(order.id) as {
      status: string;
    };
    // Phase 3: nothing taken at the door is a retryable failure, not a cancellation.
    expect(orderRow.status).toBe("DELIVERY_FAILED");
  });

  it("is idempotent, so a queued delivery can be retried safely", () => {
    // The offline queue will replay whatever it could not send. Every write in
    // recordDelivery is an assignment rather than an increment, so replaying one is a
    // no-op -- which is the property that makes retrying safe without a dedupe table.
    const db = getDb();
    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-09-02",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 4 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-09-02",
      created_by: ctx.owner,
      organization_id: 1,
    });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops[0];

    const payload = {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 3 }],
      collected_toman: 500000,
      by: ctx.driver,
    };
    recordDelivery(db, stopId, payload);
    const first = db
      .prepare("SELECT status, paid_toman, payment_status FROM orders WHERE id = ?")
      .get(order.id);

    recordDelivery(db, stopId, payload);
    const second = db
      .prepare("SELECT status, paid_toman, payment_status FROM orders WHERE id = ?")
      .get(order.id);

    expect(second).toEqual(first);
    expect(readOrder(db, order.id)!.lines[0].packs_delivered).toBe(3);
  });

  it("refuses to deliver a line that belongs to another order", () => {
    const db = getDb();
    const run = readRun(db, ctx.run)!;
    expect(() =>
      recordDelivery(db, run.stops[0].id, {
        lines: [{ line_id: 999999, packs_delivered: 1 }],
        collected_toman: 0,
        by: ctx.driver,
      })
    ).toThrow(DeliveryError);
  });

  it("refuses to deliver more than was ordered", () => {
    // Not a hard rule anywhere else, but at the door it is almost always a typo, and
    // the number goes straight into an invoice.
    const db = getDb();
    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-29",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-08-29",
      created_by: ctx.owner,
      organization_id: 1,
    });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops[0];

    expect(() =>
      recordDelivery(db, stopId, {
        lines: [{ line_id: stop.lines[0].id, packs_delivered: 5 }],
        collected_toman: 0,
        by: ctx.driver,
      })
    ).toThrow(DeliveryError);
  });
});

describe("readDriverRuns", () => {
  it("returns only that driver's runs", () => {
    const mine = readDriverRuns(getDb(), ctx.driver);
    expect(mine.length).toBeGreaterThan(0);
    expect(readDriverRuns(getDb(), ctx.otherDriver)).toHaveLength(0);
  });

  it("puts the most recent run first", () => {
    const runs = readDriverRuns(getDb(), ctx.driver);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i - 1].run_date >= runs[i].run_date).toBe(true);
    }
  });
});
