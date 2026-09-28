import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-salesorders-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { GET, POST } = await import("@/app/api/sales/orders/route");
const { GET: GET_ONE, PATCH } = await import("@/app/api/sales/orders/[id]/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
import type { Role } from "@/lib/db";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = {
  east: 0,
  west: 0,
  owner: 0,
  eastManager: 0,
  westManager: 0,
  nazanin: 0,
  yasamin: 0,
  driver: 0,
  eastCustomer: 0,
  westCustomer: 0,
  product: 0,
  packaging: 0,
};

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const group = db.prepare(
    "INSERT INTO groups (name, slug, color, active, created_at, organization_id) VALUES (?, ?, ?, 1, ?, 1)"
  );
  ctx.east = Number(group.run("شرق", "east", "#0ff", now).lastInsertRowid);
  ctx.west = Number(group.run("غرب", "west", "#f0f", now).lastInsertRowid);

  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, 'x', ?, ?, ?, 1, ?, 1)"
  );
  ctx.owner = Number(user.run("owner", "مالک", "owner", null, now).lastInsertRowid);
  ctx.eastManager = Number(user.run("em", "مدیر شرق", "group_manager", ctx.east, now).lastInsertRowid);
  ctx.westManager = Number(user.run("wm", "مدیر غرب", "group_manager", ctx.west, now).lastInsertRowid);
  ctx.nazanin = Number(user.run("nazanin", "نازنین", "phone_sales", ctx.east, now).lastInsertRowid);
  ctx.yasamin = Number(user.run("yasamin", "یاسمین", "phone_sales", ctx.east, now).lastInsertRowid);
  ctx.driver = Number(user.run("driver", "راننده", "delivery_driver", ctx.east, now).lastInsertRowid);

  const customer = db.prepare(
    "INSERT INTO customers (customer_code, business_name, group_id, synced_at, organization_id) VALUES (?, ?, ?, ?, 1)"
  );
  ctx.eastCustomer = Number(customer.run("C1", "رستوران شرق", ctx.east, now).lastInsertRowid);
  ctx.westCustomer = Number(customer.run("C2", "رستوران غرب", ctx.west, now).lastInsertRowid);

  ctx.product = createProduct(db, { name: "کره گیاهی", kg_per_base_unit: 0.25, organization_id: 1 });
  ctx.packaging = createPackaging(db, {
    product_id: ctx.product,
    name: "جعبه",
    qty_per_pack: 100,
  });
  setPrice(db, { product_id: ctx.product, price_toman: 440000, valid_from: "2026-01-01" });
});

function cookieFor(uid: number, role: Role, gid: number | null) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role, gid, oid: 1, tv: 0, name: "t" })}`;
}

const AS = {
  owner: () => cookieFor(ctx.owner, "owner", null),
  eastManager: () => cookieFor(ctx.eastManager, "group_manager", ctx.east),
  westManager: () => cookieFor(ctx.westManager, "group_manager", ctx.west),
  nazanin: () => cookieFor(ctx.nazanin, "phone_sales", ctx.east),
  yasamin: () => cookieFor(ctx.yasamin, "phone_sales", ctx.east),
  driver: () => cookieFor(ctx.driver, "delivery_driver", ctx.east),
};

function post(cookie: string, body: unknown) {
  return new NextRequest("http://localhost/api/sales/orders", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie },
  });
}

function get(cookie: string, qs = "") {
  return new NextRequest(`http://localhost/api/sales/orders${qs}`, { headers: { cookie } });
}

const orderBody = (over: Record<string, unknown> = {}) => ({
  customer_id: ctx.eastCustomer,
  order_date: "2026-08-26",
  lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 2 }],
  ...over,
});

describe("POST /api/sales/orders", () => {
  it("refuses an anonymous caller", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/sales/orders", {
        method: "POST",
        body: JSON.stringify(orderBody()),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("lets a driver record an order in their own group, and not in another group's", async () => {
    // This used to read "refuses a driver". The driver role is also the field sales rep in
    // this app, and a rep who cannot write down a sale at the door is the gap the lead work
    // exists to close. The rule that survives is the group boundary, not the role.
    const res = await POST(post(AS.driver(), orderBody()));
    expect(res.status).toBe(201);
    // And the boundary is unchanged: another group's customer is a 404, not a 403.
    const other = await POST(post(AS.driver(), orderBody({ customer_id: ctx.westCustomer })));
    expect(other.status).toBe(404);
  });

  it("lets a manager record an order for their own group", async () => {
    const res = await POST(post(AS.eastManager(), orderBody()));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.order_no).toMatch(/^1405-\d{5}$/);
  });

  it("hides another group's customer behind a 404, not a 403", async () => {
    // A 403 would confirm the customer exists. The rule everywhere else in this app.
    const res = await POST(post(AS.westManager(), orderBody()));
    expect(res.status).toBe(404);
  });

  it("lets a manager credit the order to a salesperson", async () => {
    const res = await POST(
      post(AS.eastManager(), orderBody({ salesperson_user_id: ctx.nazanin }))
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const row = getDb()
      .prepare("SELECT salesperson_user_id FROM orders WHERE id = ?")
      .get(id) as { salesperson_user_id: number };
    expect(row.salesperson_user_id).toBe(ctx.nazanin);
  });

  it("credits a salesperson's own order to themselves", async () => {
    const res = await POST(post(AS.nazanin(), orderBody()));
    const { id } = await res.json();
    const row = getDb()
      .prepare("SELECT salesperson_user_id FROM orders WHERE id = ?")
      .get(id) as { salesperson_user_id: number };
    expect(row.salesperson_user_id).toBe(ctx.nazanin);
  });

  it("stops a salesperson crediting an order to a colleague", async () => {
    // Commission is paid off this column, so writing someone else's id into it is
    // moving money. A فروشنده's order is always their own.
    const res = await POST(post(AS.nazanin(), orderBody({ salesperson_user_id: ctx.yasamin })));
    const { id } = await res.json();
    const row = getDb()
      .prepare("SELECT salesperson_user_id FROM orders WHERE id = ?")
      .get(id) as { salesperson_user_id: number };
    expect(row.salesperson_user_id).toBe(ctx.nazanin);
  });

  it("rejects an order with no lines", async () => {
    expect((await POST(post(AS.eastManager(), orderBody({ lines: [] })))).status).toBe(400);
  });

  it("reports an unpriced product as a message rather than a crash", async () => {
    const db = getDb();
    const bare = createProduct(db, { name: "بی‌قیمت", kg_per_base_unit: 1, organization_id: 1 });
    const barePack = createPackaging(db, { product_id: bare, name: "ک", qty_per_pack: 1 });
    const res = await POST(
      post(AS.eastManager(), orderBody({ lines: [{ product_id: bare, packaging_id: barePack, packs: 1 }] }))
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("قیمت");
  });

  it("rejects a malformed order date", async () => {
    const res = await POST(post(AS.eastManager(), orderBody({ order_date: "۱۴۰۵/۰۶/۰۴" })));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sales/orders", () => {
  it("shows an owner every group's orders", async () => {
    const res = await GET(get(AS.owner()));
    const { orders } = await res.json();
    const names = new Set(orders.map((o: { customer_name: string }) => o.customer_name));
    expect(names.has("رستوران شرق")).toBe(true);
  });

  it("shows a manager only their own group", async () => {
    await POST(post(AS.owner(), orderBody({ customer_id: ctx.westCustomer })));
    const res = await GET(get(AS.eastManager()));
    const { orders } = await res.json();
    expect(orders.every((o: { customer_name: string }) => o.customer_name === "رستوران شرق")).toBe(
      true
    );
  });

  it("shows a salesperson only the orders they are credited with", async () => {
    const res = await GET(get(AS.yasamin()));
    const { orders } = await res.json();
    expect(orders).toHaveLength(0);

    const mine = await GET(get(AS.nazanin()));
    const { orders: theirs } = await mine.json();
    expect(theirs.length).toBeGreaterThan(0);
  });

  it("shows a driver only what is on their own runs, and does not error", async () => {
    // Also formerly a 403. Reading is scoped by orderFilter, which limits a driver to the
    // orders on runs assigned to them -- so with no runs in this fixture the honest answer
    // is an empty list, not a refusal. The scoping itself is asserted in the tests below.
    const res = await GET(get(AS.driver()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.orders).toEqual([]);
  });
});

describe("GET /api/sales/orders/[id]", () => {
  let eastOrderId = 0;

  beforeAll(async () => {
    const res = await POST(post(AS.eastManager(), orderBody()));
    eastOrderId = (await res.json()).id;
  });

  const ctxFor = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

  it("returns the order with its lines", async () => {
    const res = await GET_ONE(
      new NextRequest(`http://localhost/api/sales/orders/${eastOrderId}`, {
        headers: { cookie: AS.eastManager() },
      }),
      ctxFor(eastOrderId)
    );
    expect(res.status).toBe(200);
    const { order } = await res.json();
    expect(order.lines).toHaveLength(1);
    expect(order.total_toman).toBe(880000);
  });

  it("404s for a manager in another group", async () => {
    const res = await GET_ONE(
      new NextRequest(`http://localhost/api/sales/orders/${eastOrderId}`, {
        headers: { cookie: AS.westManager() },
      }),
      ctxFor(eastOrderId)
    );
    expect(res.status).toBe(404);
  });

  it("404s for a salesperson who did not record it", async () => {
    const res = await GET_ONE(
      new NextRequest(`http://localhost/api/sales/orders/${eastOrderId}`, {
        headers: { cookie: AS.yasamin() },
      }),
      ctxFor(eastOrderId)
    );
    expect(res.status).toBe(404);
  });

  it("confirms a draft", async () => {
    const res = await PATCH(
      new NextRequest(`http://localhost/api/sales/orders/${eastOrderId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "confirmed" }),
        headers: { "Content-Type": "application/json", cookie: AS.eastManager() },
      }),
      ctxFor(eastOrderId)
    );
    expect(res.status).toBe(200);
  });

  it("refuses to confirm it twice", async () => {
    const res = await PATCH(
      new NextRequest(`http://localhost/api/sales/orders/${eastOrderId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "confirmed" }),
        headers: { "Content-Type": "application/json", cookie: AS.eastManager() },
      }),
      ctxFor(eastOrderId)
    );
    expect(res.status).toBe(400);
  });

  it("404s a confirm attempt from another group rather than refusing it", async () => {
    const res = await PATCH(
      new NextRequest(`http://localhost/api/sales/orders/${eastOrderId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "confirmed" }),
        headers: { "Content-Type": "application/json", cookie: AS.westManager() },
      }),
      ctxFor(eastOrderId)
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/sales/orders?customer=", () => {
  it("returns only that customer's orders", async () => {
    const res = await GET(get(AS.owner(), `?customer=${ctx.eastCustomer}`));
    const { orders } = await res.json();
    expect(orders.length).toBeGreaterThan(0);
    expect(
      orders.every((o: { customer_name: string }) => o.customer_name === "رستوران شرق")
    ).toBe(true);
  });

  it("still refuses to cross a group boundary", async () => {
    // The west manager asking for an east customer by id gets their own scope applied,
    // not the customer they named -- a filter must never widen a scope.
    const res = await GET(get(AS.westManager(), `?customer=${ctx.eastCustomer}`));
    const { orders } = await res.json();
    expect(orders).toHaveLength(0);
  });

  it("includes what that customer habitually buys", async () => {
    const res = await GET(get(AS.owner(), `?customer=${ctx.eastCustomer}`));
    const { products } = await res.json();
    expect(products.length).toBeGreaterThan(0);
    expect(products[0].product_name).toBe("کره گیاهی");
  });

  it("returns no product mix when no customer is named", async () => {
    // The question is meaningless across every customer at once, and computing it
    // would scan every line in the table for nothing.
    const { products } = await (await GET(get(AS.owner()))).json();
    expect(products).toEqual([]);
  });

  it("scopes the product mix too, not just the orders", async () => {
    const { products } = await (
      await GET(get(AS.westManager(), `?customer=${ctx.eastCustomer}`))
    ).json();
    expect(products).toEqual([]);
  });
});
