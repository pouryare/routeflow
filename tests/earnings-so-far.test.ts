import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Session } from "@/lib/session";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-earnings-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");
const { setRate } = await import("@/lib/commissionLedger");
const { earningsSoFar, jalaliMonthSoFar } = await import("@/lib/repo/earningsSoFar");
const { default: EarningsCard } = await import("@/components/today/EarningsCard");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const ids = { owner: 0, seller: 0, idle: 0, driver: 0, customer: 0, product: 0, packaging: 0 };
const sess = (id: number, role: string): Session =>
  ({ user: { id } as never, role: role as never, groupId: null, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;
// 28 Mehr 1405: the month runs from 1 Mehr (2026-09-23).
const NOW = "2026-10-20T08:00:00Z";

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const user = db.prepare("INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES (?, 'x', ?, ?, 1, ?, 1)");
  ids.owner = Number(user.run("o", "مالک", "owner", now).lastInsertRowid);
  ids.seller = Number(user.run("s", "نازنین", "phone_sales", now).lastInsertRowid);
  ids.idle = Number(user.run("i", "یاسمین", "phone_sales", now).lastInsertRowid);
  ids.driver = Number(user.run("d", "راننده", "delivery_driver", now).lastInsertRowid);
  ids.customer = Number(db.prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES ('C1', 'رستوران', ?)").run(now).lastInsertRowid);
  ids.product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  ids.packaging = createPackaging(db, { product_id: ids.product, name: "جعبه", qty_per_pack: 100 });
  setPrice(db, { product_id: ids.product, price_toman: 440000, valid_from: "2026-01-01" });
  setRate(db, { rate_per_kg_toman: 2000, valid_from: "2026-01-01", created_by: ids.owner });

  for (const date of ["2026-10-10", "2026-09-10"]) {
    const order = createOrder(db, {
      customer_id: ids.customer, order_date: date, created_by: ids.owner, organization_id: 1, salesperson_user_id: ids.seller,
      lines: [{ product_id: ids.product, packaging_id: ids.packaging, packs: 2 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, { driver_user_id: ids.driver, run_date: date, created_by: ids.owner, organization_id: 1 });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
    recordDelivery(db, stopId, { lines: stop.lines.map((l) => ({ line_id: l.id, packs_delivered: 2 })), collected_toman: 0, by: ids.driver });
  }
});

describe("earningsSoFar (F19)", () => {
  it("uses the Jalali month up to today", () => {
    expect(jalaliMonthSoFar(NOW)).toEqual({ from: "2026-09-23", to: "2026-10-20" });
  });

  it("is the seller's own statement for this month, from the commission engine", () => {
    const e = earningsSoFar(sess(ids.seller, "phone_sales"), NOW)!;
    // One order in the month: 2 packs x 100 x 0.25kg = 50kg at 2000.
    expect(e).toMatchObject({ orders: 1, kg: 50, accrued_toman: 100000, paid_toman: 0, owed_toman: 200000 });
    const html = renderToStaticMarkup(createElement(EarningsCard, { e }));
    expect(html).toContain("پورسانت این ماه تا امروز");
    expect(html).toContain("/sales/commission");
  });

  it("is hidden for a seller with nothing, and for roles that do not sell", () => {
    expect(earningsSoFar(sess(ids.idle, "phone_sales"), NOW)).toBeNull();
    expect(earningsSoFar(sess(ids.owner, "owner"), NOW)).toBeNull();
  });
});
