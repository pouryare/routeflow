import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-runs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { GET, POST } = await import("@/app/api/sales/runs/route");
const { POST: ADD_STOP } = await import("@/app/api/sales/runs/[id]/stops/route");
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
  eastDriver: 0,
  westDriver: 0,
  eastOrder: 0,
  westOrder: 0,
  eastRun: 0,
};

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
  ctx.westManager = Number(user.run("wm", "مدیر غرب", "group_manager", ctx.west, now).lastInsertRowid);
  ctx.eastDriver = Number(user.run("ed", "راننده شرق", "driver", ctx.east, now).lastInsertRowid);
  ctx.westDriver = Number(user.run("wd", "راننده غرب", "driver", ctx.west, now).lastInsertRowid);

  const customer = db.prepare(
    "INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)"
  );
  const eastCustomer = Number(customer.run("C1", "رستوران شرق", ctx.east, now).lastInsertRowid);
  const westCustomer = Number(customer.run("C2", "رستوران غرب", ctx.west, now).lastInsertRowid);

  const product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  const packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 100 });
  setPrice(db, { product_id: product, price_toman: 440000, valid_from: "2026-01-01" });

  for (const [customerId, key] of [
    [eastCustomer, "eastOrder"],
    [westCustomer, "westOrder"],
  ] as const) {
    const order = createOrder(db, {
      customer_id: customerId,
      order_date: "2026-08-26",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    });
    confirmOrder(db, order.id);
    ctx[key] = order.id;
  }
});

function cookie(uid: number, role: Role, gid: number | null) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role, gid, oid: 1, tv: 0, name: "t" })}`;
}

function post(url: string, c: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie: c },
  });
}

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("POST /api/sales/runs", () => {
  it("refuses a driver, who does not plan their own day", async () => {
    const res = await POST(
      post("/api/sales/runs", cookie(ctx.eastDriver, "driver", ctx.east), {
        driver_user_id: ctx.eastDriver,
        run_date: "2026-08-26",
      })
    );
    expect(res.status).toBe(403);
  });

  it("lets a manager create a run for their own driver", async () => {
    const res = await POST(
      post("/api/sales/runs", cookie(ctx.eastManager, "group_manager", ctx.east), {
        driver_user_id: ctx.eastDriver,
        run_date: "2026-08-26",
      })
    );
    expect(res.status).toBe(201);
    ctx.eastRun = (await res.json()).id;
  });

  it("hides a driver from another group behind a 404", async () => {
    const res = await POST(
      post("/api/sales/runs", cookie(ctx.eastManager, "group_manager", ctx.east), {
        driver_user_id: ctx.westDriver,
        run_date: "2026-08-26",
      })
    );
    expect(res.status).toBe(404);
  });

  it("rejects a malformed date", async () => {
    const res = await POST(
      post("/api/sales/runs", cookie(ctx.owner, "owner", null), {
        driver_user_id: ctx.eastDriver,
        run_date: "۱۴۰۵/۰۶/۰۴",
      })
    );
    expect(res.status).toBe(400);
  });

  it("reports a duplicate run as a message rather than a crash", async () => {
    const res = await POST(
      post("/api/sales/runs", cookie(ctx.eastManager, "group_manager", ctx.east), {
        driver_user_id: ctx.eastDriver,
        run_date: "2026-08-26",
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sales/runs/[id]/stops", () => {
  it("adds a confirmed order to the run", async () => {
    const res = await ADD_STOP(
      post(`/api/sales/runs/${ctx.eastRun}/stops`, cookie(ctx.eastManager, "group_manager", ctx.east), {
        order_id: ctx.eastOrder,
      }),
      params(ctx.eastRun)
    );
    expect(res.status).toBe(201);
  });

  it("refuses an order from another group", async () => {
    // Loading another territory's order onto this van would move goods across a
    // boundary the whole scoping model exists to keep.
    const res = await ADD_STOP(
      post(`/api/sales/runs/${ctx.eastRun}/stops`, cookie(ctx.eastManager, "group_manager", ctx.east), {
        order_id: ctx.westOrder,
      }),
      params(ctx.eastRun)
    );
    expect(res.status).toBe(404);
  });

  it("404s a manager working on another group's run", async () => {
    const res = await ADD_STOP(
      post(`/api/sales/runs/${ctx.eastRun}/stops`, cookie(ctx.westManager, "group_manager", ctx.west), {
        order_id: ctx.westOrder,
      }),
      params(ctx.eastRun)
    );
    expect(res.status).toBe(404);
  });

  it("reports the same order added twice rather than crashing", async () => {
    const res = await ADD_STOP(
      post(`/api/sales/runs/${ctx.eastRun}/stops`, cookie(ctx.eastManager, "group_manager", ctx.east), {
        order_id: ctx.eastOrder,
      }),
      params(ctx.eastRun)
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sales/runs", () => {
  it("shows a manager their own group's runs", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/sales/runs", {
        headers: { cookie: cookie(ctx.eastManager, "group_manager", ctx.east) },
      })
    );
    const { runs } = await res.json();
    expect(runs.length).toBeGreaterThan(0);
  });

  it("hides them from a manager in another group", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/sales/runs", {
        headers: { cookie: cookie(ctx.westManager, "group_manager", ctx.west) },
      })
    );
    expect((await res.json()).runs).toHaveLength(0);
  });
});
