import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* Relative, not a fixed date: the routes only plan a day near today, so a hard-coded date goes stale. */
const TODAY = new Date().toISOString().slice(0, 10);

const testDbPath = path.join(
  os.tmpdir(),
  `rf-routing-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { planDelivery } = await import("@/lib/repo/deliveries");
const { GET: V_GET, POST: V_POST } = await import("@/app/api/sales/vehicles/route");
const { POST: PLAN } = await import("@/app/api/sales/routing/plan/route");
const { POST: COMMIT } = await import("@/app/api/sales/routing/commit/route");
const { POST: FREEZE } = await import("@/app/api/sales/runs/[id]/freeze/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let seller = 0;
let product = 0;
let packaging = 0;

function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}
function jreq(url: string, body: unknown, role = "owner", uid = owner) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookie(uid, role) },
    body: JSON.stringify(body),
  });
}
function ctxFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM deliveries; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM route_schedules; DELETE FROM route_templates; DELETE FROM vehicles; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM facilities; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number((await u.run(`o${Date.now()}`, "x:y", "م", "owner", now)).lastInsertRowid);
  driver = Number((await u.run(`d${Date.now()}`, "x:y", "ر", "delivery_driver", now)).lastInsertRowid);
  seller = Number((await u.run(`s${Date.now()}`, "x:y", "ف", "phone_sales", now)).lastInsertRowid);
  await db.prepare(
    "INSERT INTO facilities (slug,kind,name,lat,lng,updated_at,organization_id,created_at) VALUES ('wh','warehouse','ا',35.7,51.4,?,1,?)"
  ).run(now, now);
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  await setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
});

async function seedOrder(lat: number, lng: number) {
  const db = getDb();
  const cust = Number(
    (await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,lat,lng,organization_id) VALUES ('c'||abs(random()),'x','active',?,?,?,1)").run(new Date().toISOString(), lat, lng)).lastInsertRowid
  );
  const o = await createOrder(db, {
    customer_id: cust,
    order_date: TODAY,
    created_by: owner,
    organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
  });
  await confirmOrder(db, o.id);
  await planDelivery(1, o.id, {});
}

describe("routing routes", () => {
  it("creates a vehicle and lists it", async () => {
    const res = await V_POST(jreq("/api/sales/vehicles", { name: "وانت", plate: "PL-9", driver_default_id: driver }));
    expect(res.status).toBe(201);
    const list = await (await V_GET(new NextRequest("http://localhost/api/sales/vehicles", { headers: { cookie: cookie(owner, "owner") } }))).json();
    expect(list.vehicles).toHaveLength(1);
  });

  it("403s a salesperson", async () => {
    const res = await V_POST(jreq("/api/sales/vehicles", { name: "x" }, "phone_sales", seller));
    expect(res.status).toBe(403);
  });

  it("plans, commits and freezes", async () => {
    await seedOrder(35.705, 51.405);
    await seedOrder(35.73, 51.43);
    await V_POST(jreq("/api/sales/vehicles", { name: "وانت", driver_default_id: driver }));

    const planRes = await PLAN(jreq("/api/sales/routing/plan", { date: TODAY }));
    const { plan } = await planRes.json();
    expect(planRes.status).toBe(200);
    expect(plan.assignments.length).toBeGreaterThan(0);

    const commitRes = await COMMIT(jreq("/api/sales/routing/commit", { plan }));
    const { run_ids } = await commitRes.json();
    expect(run_ids).toHaveLength(1);

    const freezeRes = await FREEZE(
      new NextRequest(`http://localhost/api/sales/runs/${run_ids[0]}/freeze`, {
        method: "POST",
        headers: { cookie: cookie(owner, "owner") },
      }),
      ctxFor(run_ids[0])
    );
    expect(freezeRes.status).toBe(200);
    expect(
      (await getDb().prepare("SELECT frozen_at FROM delivery_runs WHERE id = ?").get(run_ids[0]) as { frozen_at: string | null }).frozen_at
    ).not.toBeNull();
  });
});
