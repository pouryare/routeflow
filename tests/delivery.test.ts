import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-delivery-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder, readOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery, DeliveryError, readDriverRuns, deferStop } = await import(
  "@/lib/delivery"
);
const { orderFilter } = await import("@/lib/session");
import type { Session } from "@/lib/session";
import type { Role, UserRow } from "@/lib/db";

import { mapSeq } from "@/lib/seq";
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
    organizationId: 1, roles: [role], hasRole: (x) => x === role 
  };
}

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();

  ctx.group = Number(
    (await db
      .prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("شرق", "east", "#0ff", now)).lastInsertRowid
  );
  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, 'x', ?, ?, ?, 1, ?)"
  );
  ctx.owner = Number((await user.run("o", "مالک", "owner", null, now)).lastInsertRowid);
  ctx.driver = Number((await user.run("d1", "راننده یک", "delivery_driver", ctx.group, now)).lastInsertRowid);
  ctx.otherDriver = Number((await user.run("d2", "راننده دو", "delivery_driver", ctx.group, now)).lastInsertRowid);

  ctx.customer = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)"
      )
      .run("C1", "رستوران نمونه", ctx.group, now)).lastInsertRowid
  );

  ctx.product = await createProduct(db, { name: "کره گیاهی", kg_per_base_unit: 0.25, organization_id: 1 });
  ctx.packaging = await createPackaging(db, {
    product_id: ctx.product,
    name: "جعبه",
    qty_per_pack: 100,
  });
  await setPrice(db, { product_id: ctx.product, price_toman: 440000, valid_from: "2026-01-01" });

  const order = await createOrder(db, {
    customer_id: ctx.customer,
    order_date: "2026-08-26",
    created_by: ctx.owner,
    organization_id: 1,
    lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 3 }],
  });
  ctx.order = order.id;
  await confirmOrder(db, ctx.order);

  ctx.run = await createRun(db, {
    driver_user_id: ctx.driver,
    run_date: "2026-08-26",
    created_by: ctx.owner,
    organization_id: 1,
  });
  await addStop(db, ctx.run, ctx.order);
});

describe("createRun", () => {
  it("refuses a second run for the same driver on the same day", async () => {
    await expect((async () =>
      await createRun(getDb(), {
        driver_user_id: ctx.driver,
        run_date: "2026-08-26",
        created_by: ctx.owner,
        organization_id: 1,
      }))()).rejects.toThrow();
  });

  it("refuses a user who is not a driver", async () => {
    await expect((async () =>
      await createRun(getDb(), {
        driver_user_id: ctx.owner,
        run_date: "2026-09-01",
        created_by: ctx.owner,
        organization_id: 1,
      }))()).rejects.toThrow(DeliveryError);
  });
});

describe("addStop", () => {
  it("refuses to add the same order to a run twice", async () => {
    await expect((async () => await addStop(getDb(), ctx.run, ctx.order))()).rejects.toThrow();
  });

  it("refuses a draft order, which nobody has agreed to yet", async () => {
    const db = getDb();
    const draft = await createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-26",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 }],
    });
    await expect((async () => await addStop(db, ctx.run, draft.id))()).rejects.toThrow(DeliveryError);
  });
});

describe("what a driver can see", () => {
  it("shows a driver the orders on their own run", async () => {
    const f = orderFilter(session("delivery_driver", ctx.driver, ctx.group));
    const rows = await getDb()
      .prepare(`SELECT o.id FROM orders o WHERE 1 = 1${f.sql}`)
      .all(...f.params) as { id: number }[];
    expect(rows.map((r) => r.id)).toContain(ctx.order);
  });

  it("hides the same order from a different driver", async () => {
    const f = orderFilter(session("delivery_driver", ctx.otherDriver, ctx.group));
    const rows = await getDb()
      .prepare(`SELECT o.id FROM orders o WHERE 1 = 1${f.sql}`)
      .all(...f.params) as { id: number }[];
    expect(rows.map((r) => r.id)).not.toContain(ctx.order);
  });

  it("shows a driver with no run at all nothing", async () => {
    const f = orderFilter(session("delivery_driver", ctx.otherDriver, ctx.group));
    const rows = await getDb()
      .prepare(`SELECT o.id FROM orders o WHERE 1 = 1${f.sql}`)
      .all(...f.params) as { id: number }[];
    expect(rows).toHaveLength(0);
  });
});

describe("readRun", () => {
  it("returns the stops with their orders and totals", async () => {
    const run = (await readRun(getDb(), ctx.run))!;
    expect(run.stops).toHaveLength(1);
    expect(run.stops[0].customer_name).toBe("رستوران نمونه");
    expect(run.stops[0].total_toman).toBe(1320000); // 3 x 440000
  });

  it("reports what is still to collect", async () => {
    const run = (await readRun(getDb(), ctx.run))!;
    expect(run.to_collect_toman).toBe(1320000);
    expect(run.remaining).toBe(1);
  });
});

describe("recordDelivery", () => {
  it("writes the delivered quantity onto the line", async () => {
    const db = getDb();
    const run = (await readRun(db, ctx.run))!;
    const stop = run.stops[0];
    await recordDelivery(db, stop.id, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 2 }],
      collected_toman: 880000,
      by: ctx.driver,
    });

    const order = (await readOrder(db, ctx.order))!;
    expect(order.lines[0].packs_delivered).toBe(2);
  });

  it("reprices the order from what was delivered, not what was ordered", async () => {
    // The customer took two of the three boxes. The invoice, the weight and the
    // commission all follow the two.
    const order = (await readOrder(getDb(), ctx.order))!;
    expect(order.total_toman).toBe(880000);
    expect(order.kg).toBe(50); // 2 x 100 x 0.25
  });

  it("marks the order delivered and records the payment", async () => {
    const row = await getDb()
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

  it("calls a short payment partial rather than paid", async () => {
    const db = getDb();
    const order = await createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-27",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 }],
    });
    await confirmOrder(db, order.id);
    const run = await createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-08-27",
      created_by: ctx.owner,
      organization_id: 1,
    });
    const stopId = await addStop(db, run, order.id);
    const stop = (await readRun(db, run))!.stops[0];

    await recordDelivery(db, stopId, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 1 }],
      collected_toman: 100000,
      by: ctx.driver,
    });

    const row = await db
      .prepare("SELECT payment_status, paid_toman FROM orders WHERE id = ?")
      .get(order.id) as { payment_status: string; paid_toman: number };
    expect(row.payment_status).toBe("partial");
    expect(row.paid_toman).toBe(100000);
  });

  it("treats a delivery of nothing as a refusal, not a delivery", async () => {
    const db = getDb();
    const order = await createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-28",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 }],
    });
    await confirmOrder(db, order.id);
    const run = await createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-08-28",
      created_by: ctx.owner,
      organization_id: 1,
    });
    const stopId = await addStop(db, run, order.id);
    const stop = (await readRun(db, run))!.stops[0];

    await recordDelivery(db, stopId, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 0 }],
      collected_toman: 0,
      by: ctx.driver,
    });

    const stopRow = await db.prepare("SELECT status FROM delivery_stops WHERE id = ?").get(stopId) as {
      status: string;
    };
    expect(stopRow.status).toBe("refused");
    const orderRow = await db.prepare("SELECT status FROM orders WHERE id = ?").get(order.id) as {
      status: string;
    };
    // Phase 3: nothing taken at the door is a retryable failure, not a cancellation.
    expect(orderRow.status).toBe("DELIVERY_FAILED");
  });

  it("is idempotent, so a queued delivery can be retried safely", async () => {
    // The offline queue will replay whatever it could not send. Every write in
    // recordDelivery is an assignment rather than an increment, so replaying one is a
    // no-op -- which is the property that makes retrying safe without a dedupe table.
    const db = getDb();
    const order = await createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-09-02",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 4 }],
    });
    await confirmOrder(db, order.id);
    const run = await createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-09-02",
      created_by: ctx.owner,
      organization_id: 1,
    });
    const stopId = await addStop(db, run, order.id);
    const stop = (await readRun(db, run))!.stops[0];

    const payload = {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 3 }],
      collected_toman: 500000,
      by: ctx.driver,
    };
    await recordDelivery(db, stopId, payload);
    const first = await db
      .prepare("SELECT status, paid_toman, payment_status FROM orders WHERE id = ?")
      .get(order.id);

    await recordDelivery(db, stopId, payload);
    const second = await db
      .prepare("SELECT status, paid_toman, payment_status FROM orders WHERE id = ?")
      .get(order.id);

    expect(second).toEqual(first);
    expect((await readOrder(db, order.id))!.lines[0].packs_delivered).toBe(3);
  });

  it("refuses to deliver a line that belongs to another order", async () => {
    const db = getDb();
    const run = (await readRun(db, ctx.run))!;
    await expect((async () =>
      await recordDelivery(db, run.stops[0].id, {
        lines: [{ line_id: 999999, packs_delivered: 1 }],
        collected_toman: 0,
        by: ctx.driver,
      }))()).rejects.toThrow(DeliveryError);
  });

  it("refuses to deliver more than was ordered", async () => {
    // Not a hard rule anywhere else, but at the door it is almost always a typo, and
    // the number goes straight into an invoice.
    const db = getDb();
    const order = await createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-29",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 }],
    });
    await confirmOrder(db, order.id);
    const run = await createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-08-29",
      created_by: ctx.owner,
      organization_id: 1,
    });
    const stopId = await addStop(db, run, order.id);
    const stop = (await readRun(db, run))!.stops[0];

    await expect((async () =>
      await recordDelivery(db, stopId, {
        lines: [{ line_id: stop.lines[0].id, packs_delivered: 5 }],
        collected_toman: 0,
        by: ctx.driver,
      }))()).rejects.toThrow(DeliveryError);
  });
});

describe("readDriverRuns", () => {
  it("returns only that driver's runs", async () => {
    const mine = await readDriverRuns(getDb(), ctx.driver);
    expect(mine.length).toBeGreaterThan(0);
    expect(await readDriverRuns(getDb(), ctx.otherDriver)).toHaveLength(0);
  });

  it("puts the most recent run first", async () => {
    const runs = await readDriverRuns(getDb(), ctx.driver);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i - 1].run_date >= runs[i].run_date).toBe(true);
    }
  });
});


describe("deferStop («later»)", () => {
  const mkOrder = async () => {
    const db = getDb();
    const o = await createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-26",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 }],
    });
    await confirmOrder(db, o.id);
    return o.id;
  };
  it("sends a pending stop to the end of its run and leaves the others in order", async () => {
    const db = getDb();
    const run = await createRun(db, { driver_user_id: ctx.otherDriver, run_date: "2026-08-27", created_by: ctx.owner, organization_id: 1 });
    const stops = await mapSeq([await mkOrder(), await mkOrder(), await mkOrder()], async (o) => await addStop(db, run, o));
    const ids = async () => (await readRun(db, run))!.stops.map((s) => s.id);
    const before = await ids();
    expect(before).toHaveLength(3);
    expect(await deferStop(db, before[0])).toEqual({ moved: true });
    expect(await ids()).toEqual([before[1], before[2], before[0]]);
    // already last: nothing moves
    expect(await deferStop(db, before[0])).toEqual({ moved: false });
    expect(await ids()).toEqual([before[1], before[2], before[0]]);
    void stops;
  });
  it("a stop that already has an outcome cannot be deferred, and an unknown stop is refused", async () => {
    const db = getDb();
    await db.prepare("UPDATE delivery_stops SET status = 'delivered' WHERE id = (SELECT id FROM delivery_stops ORDER BY id LIMIT 1)").run();
    const done = await db.prepare("SELECT id FROM delivery_stops WHERE status = 'delivered' LIMIT 1").get() as { id: number };
    await expect((async () => await deferStop(db, done.id))()).rejects.toThrow(DeliveryError);
    await expect((async () => await deferStop(db, 999999))()).rejects.toThrow(DeliveryError);
  });
});
