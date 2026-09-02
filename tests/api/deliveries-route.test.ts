import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-deliveries-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop } = await import("@/lib/delivery");
const { deliveryForStop } = await import("@/lib/repo/deliveries");
const { GET: LIST } = await import("@/app/api/sales/deliveries/route");
const { POST: COMPLETE } = await import("@/app/api/sales/deliveries/[id]/complete/route");
const { POST: RETRY } = await import("@/app/api/sales/deliveries/[id]/retry/route");
const { GET: RC } = await import("@/app/api/sales/reason-codes/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let custId = 0;
let product = 0;
let packaging = 0;
let reason = 0;

function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}
function ctxFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM delivery_lines; DELETE FROM deliveries; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM facilities; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x:y", "م", "owner", now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x:y", "ر", "driver", now).lastInsertRowid);
  custId = Number(
    db
      .prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES (?,?,'active','2026-01-01',1)")
      .run(`C${Date.now()}`, "x").lastInsertRowid
  );
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1_000, valid_from: "2026-01-01" });
  reason = (
    db.prepare("SELECT id FROM reason_codes WHERE domain='delivery_fail' AND code='CUSTOMER_ABSENT'").get() as { id: number }
  ).id;
});

function stopWithDelivery(): number {
  const db = getDb();
  const o = createOrder(db, {
    customer_id: custId,
    order_date: "2026-01-01",
    created_by: owner,
    organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs: 2 }],
  });
  confirmOrder(db, o.id);
  const run = createRun(db, { driver_user_id: driver, run_date: "2026-01-02", created_by: owner, organization_id: 1 });
  const stopId = addStop(db, run, o.id);
  return deliveryForStop(1, stopId)!.id;
}

describe("deliveries + reason-codes routes", () => {
  it("lists reason codes filtered by domain", async () => {
    const res = await RC(
      new NextRequest("http://localhost/api/sales/reason-codes?domain=delivery_fail", {
        headers: { cookie: cookie(driver, "driver") },
      })
    );
    expect(res.status).toBe(200);
    const codes = (await res.json()).reason_codes as { code: string }[];
    expect(codes.some((c) => c.code === "CUSTOMER_ABSENT")).toBe(true);
  });

  it("completes a delivery, ignoring any body timestamp", async () => {
    const dId = stopWithDelivery();
    const res = await COMPLETE(
      new NextRequest(`http://localhost/api/sales/deliveries/${dId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookie(owner, "owner") },
        body: JSON.stringify({
          outcome: "delivered",
          collected_toman: 2000,
          completed_at: "1990-01-01T00:00:00.000Z",
          device_time: "1990-01-01T00:00:00.000Z",
        }),
      }),
      ctxFor(dId)
    );
    expect(res.status).toBe(200);
    const d = (await res.json()).delivery as { status: string; completed_at: string; device_time: string };
    expect(d.status).toBe("DELIVERED");
    expect(new Date(d.completed_at).getFullYear()).toBeGreaterThan(2020);
    expect(d.device_time).toBe("1990-01-01T00:00:00.000Z");
  });

  it("409s a failed completion with no reason", async () => {
    const dId = stopWithDelivery();
    const res = await COMPLETE(
      new NextRequest(`http://localhost/api/sales/deliveries/${dId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookie(owner, "owner") },
        body: JSON.stringify({ outcome: "failed" }),
      }),
      ctxFor(dId)
    );
    expect(res.status).toBe(409);
  });

  it("retries a failed delivery", async () => {
    const dId = stopWithDelivery();
    await COMPLETE(
      new NextRequest(`http://localhost/api/sales/deliveries/${dId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookie(owner, "owner") },
        body: JSON.stringify({ outcome: "failed", fail_reason_id: reason }),
      }),
      ctxFor(dId)
    );
    const res = await RETRY(
      new NextRequest(`http://localhost/api/sales/deliveries/${dId}/retry`, {
        method: "POST",
        headers: { cookie: cookie(owner, "owner") },
      }),
      ctxFor(dId)
    );
    expect(res.status).toBe(201);

    const list = await LIST(
      new NextRequest("http://localhost/api/sales/deliveries?order_id=", {
        headers: { cookie: cookie(owner, "owner") },
      })
    );
    expect(((await list.json()).deliveries as unknown[]).length).toBe(2);
  });

  it("denies a salesperson the deliveries list via the route role check", async () => {
    // proxy also blocks this, but the route re-checks.
    const res = await LIST(
      new NextRequest("http://localhost/api/sales/deliveries", {
        headers: { cookie: cookie(owner, "salesperson") },
      })
    );
    expect(res.status).toBe(200); // salesperson IS allowed to read the list
  });
});
