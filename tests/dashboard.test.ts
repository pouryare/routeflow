import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-dashboard-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");
const { salesDashboard, jalaliMonthKey } = await import("@/lib/dashboard");
import type { Session } from "@/lib/session";
import type { Role, UserRow } from "@/lib/db";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = {
  east: 0,
  west: 0,
  owner: 0,
  eastManager: 0,
  nazanin: 0,
  driver: 0,
  eastCustomer: 0,
  westCustomer: 0,
  product: 0,
  packaging: 0,
};

function session(role: Role, uid: number, gid: number | null): Session {
  return { user: { id: uid, role, group_id: gid } as UserRow, role, groupId: gid };
}

const runs = new Map<string, number>();
function runFor(date: string): number {
  const existing = runs.get(date);
  if (existing !== undefined) return existing;
  const id = createRun(getDb(), {
    driver_user_id: ctx.driver,
    run_date: date,
    created_by: ctx.owner,
  });
  runs.set(date, id);
  return id;
}

/** Confirms an order and delivers `deliveredPacks` of `orderedPacks`. */
function sell(opts: {
  customer: number;
  ordered: number;
  delivered: number;
  date: string;
  seller?: number | null;
}) {
  const db = getDb();
  const order = createOrder(db, {
    customer_id: opts.customer,
    order_date: opts.date,
    created_by: ctx.owner,
    salesperson_user_id: opts.seller ?? null,
    lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: opts.ordered }],
  });
  confirmOrder(db, order.id);

  // One run per driver per day -- the schema enforces it, so two orders on the same
  // date share a run rather than each making one.
  const run = runFor(opts.date);
  const stopId = addStop(db, run, order.id);
  const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
  recordDelivery(db, stopId, {
    lines: [{ line_id: stop.lines[0].id, packs_delivered: opts.delivered }],
    collected_toman: 0,
    by: ctx.driver,
  });
  return order.id;
}

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const group = db.prepare(
    "INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)"
  );
  ctx.east = Number(group.run("شرق", "east", "#0ff", now).lastInsertRowid);
  ctx.west = Number(group.run("غرب", "west", "#f0f", now).lastInsertRowid);

  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, 'x', ?, ?, ?, 1, ?)"
  );
  ctx.owner = Number(user.run("o", "مالک", "owner", null, now).lastInsertRowid);
  ctx.eastManager = Number(user.run("em", "مدیر شرق", "group_manager", ctx.east, now).lastInsertRowid);
  ctx.nazanin = Number(user.run("nz", "نازنین", "salesperson", ctx.east, now).lastInsertRowid);
  ctx.driver = Number(user.run("dr", "راننده", "driver", ctx.east, now).lastInsertRowid);

  const customer = db.prepare(
    "INSERT INTO customers (customer_code, business_name, group_id, debt_0_7, debt_8_30, debt_30_plus, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  ctx.eastCustomer = Number(
    customer.run("C1", "رستوران شرق", ctx.east, 100000, 50000, 25000, now).lastInsertRowid
  );
  ctx.westCustomer = Number(
    customer.run("C2", "رستوران غرب", ctx.west, 0, 0, 0, now).lastInsertRowid
  );

  ctx.product = createProduct(db, { name: "کره گیاهی", kg_per_base_unit: 0.25 });
  ctx.packaging = createPackaging(db, { product_id: ctx.product, name: "جعبه", qty_per_pack: 100 });
  setPrice(db, { product_id: ctx.product, price_toman: 1000, valid_from: "2026-01-01" });

  // Mordad 1405 (2026-08-20) and Shahrivar 1405 (2026-08-25).
  sell({ customer: ctx.eastCustomer, ordered: 10, delivered: 8, date: "2026-08-20", seller: ctx.nazanin });
  sell({ customer: ctx.eastCustomer, ordered: 5, delivered: 5, date: "2026-08-25", seller: ctx.nazanin });
  sell({ customer: ctx.westCustomer, ordered: 20, delivered: 20, date: "2026-08-25" });
});

describe("jalaliMonthKey", () => {
  it("buckets by the Persian month, not the Gregorian one", () => {
    // Both dates are August 2026, but they are in different Persian months -- which is
    // the whole reason this cannot be a strftime('%Y-%m').
    expect(jalaliMonthKey("2026-08-20")).toBe("1405-05");
    expect(jalaliMonthKey("2026-08-25")).toBe("1405-06");
  });

  it("handles a full timestamp", () => {
    expect(jalaliMonthKey("2026-08-25T09:00:00.000Z")).toBe("1405-06");
  });
});

describe("salesDashboard", () => {
  it("counts revenue on what was delivered, not ordered", () => {
    // Price is per pack, not per عدد. East: (8 + 5) packs x 1000 = 13,000.
    // Ordered would have been 15,000.
    const d = salesDashboard(getDb(), session("group_manager", ctx.eastManager, ctx.east));
    expect(d.revenue_toman).toBe(13000);
  });

  it("scopes a manager to their own group", () => {
    const east = salesDashboard(getDb(), session("group_manager", ctx.eastManager, ctx.east));
    const owner = salesDashboard(getDb(), session("owner", ctx.owner, null));
    // Owner also sees the west order of 20 packs x 1000 = 20,000.
    expect(owner.revenue_toman).toBe(east.revenue_toman + 20000);
  });

  it("reports fill rate as delivered over ordered", () => {
    // East ordered 15 packs, delivered 13.
    const d = salesDashboard(getDb(), session("group_manager", ctx.eastManager, ctx.east));
    expect(d.fill_rate).toBeCloseTo(13 / 15, 5);
  });

  it("buckets revenue into Persian months", () => {
    const d = salesDashboard(getDb(), session("group_manager", ctx.eastManager, ctx.east));
    const keys = d.revenue_by_month.map((p) => p.key);
    expect(keys).toContain("1405-05");
    expect(keys).toContain("1405-06");
    const mordad = d.revenue_by_month.find((p) => p.key === "1405-05")!;
    expect(mordad.value).toBe(8000); // 8 packs only
  });

  it("attributes revenue to the salesperson credited", () => {
    const d = salesDashboard(getDb(), session("owner", ctx.owner, null));
    const row = d.revenue_by_salesperson.find((r) => r.label === "نازنین")!;
    expect(row.value).toBe(13000);
  });

  it("sums debt from the customer ledger, scoped", () => {
    const east = salesDashboard(getDb(), session("group_manager", ctx.eastManager, ctx.east));
    expect(east.debt.total).toBe(175000);
    expect(east.debt.over_30).toBe(25000);
  });

  it("gives a salesperson only their own figures", () => {
    const d = salesDashboard(getDb(), session("salesperson", ctx.nazanin, ctx.east));
    expect(d.revenue_toman).toBe(13000);
    // The west order is not hers, and neither is the group total.
    expect(d.revenue_by_salesperson.every((r) => r.label === "نازنین")).toBe(true);
  });

  it("counts orders and averages them", () => {
    const d = salesDashboard(getDb(), session("group_manager", ctx.eastManager, ctx.east));
    expect(d.order_count).toBe(2);
    expect(d.average_order_toman).toBe(6500);
  });

  it("returns zeroes rather than NaN when there is nothing", () => {
    // A manager with no group reaches nothing. Every figure must still be a number --
    // a NaN in a chart path makes the whole SVG vanish with no error.
    const d = salesDashboard(getDb(), session("group_manager", 999, null));
    expect(d.revenue_toman).toBe(0);
    expect(d.order_count).toBe(0);
    expect(d.average_order_toman).toBe(0);
    expect(d.fill_rate).toBe(0);
    expect(Number.isNaN(d.fill_rate)).toBe(false);
    expect(d.revenue_by_month).toEqual([]);
  });

  it("lists top customers by revenue", () => {
    const d = salesDashboard(getDb(), session("owner", ctx.owner, null));
    expect(d.top_customers[0].label).toBe("رستوران غرب"); // 20 packs x 1000
    expect(d.top_customers[0].value).toBe(20000);
  });
});
