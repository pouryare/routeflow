import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-stockapi-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct } = await import("@/lib/catalogue");
const { GET } = await import("@/app/api/sales/stock/route");
const { POST } = await import("@/app/api/sales/purchases/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
import type { Role } from "@/lib/db";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = { group: 0, owner: 0, manager: 0, seller: 0, driver: 0, product: 0 };

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
  ctx.manager = Number(user.run("m", "مدیر", "group_manager", ctx.group, now).lastInsertRowid);
  ctx.seller = Number(user.run("s", "نازنین", "salesperson", ctx.group, now).lastInsertRowid);
  ctx.driver = Number(user.run("d", "راننده", "driver", ctx.group, now).lastInsertRowid);
  ctx.product = createProduct(db, { name: "کره گیاهی", kg_per_base_unit: 0.25, organization_id: 1 });
});

const cookieFor = (uid: number, role: Role, gid: number | null) =>
  `${COOKIE_NAME}=${createSessionToken({ uid, role, gid, oid: 1, tv: 0, name: "t" })}`;

const AS = {
  owner: () => cookieFor(ctx.owner, "owner", null),
  manager: () => cookieFor(ctx.manager, "group_manager", ctx.group),
  seller: () => cookieFor(ctx.seller, "salesperson", ctx.group),
  driver: () => cookieFor(ctx.driver, "driver", ctx.group),
};

const get = (cookie: string | null) =>
  new NextRequest("http://localhost/api/sales/stock", { headers: cookie ? { cookie } : {} });

const post = (cookie: string, body: unknown) =>
  new NextRequest("http://localhost/api/sales/purchases", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie },
  });

describe("GET /api/sales/stock", () => {
  it("refuses an anonymous caller", async () => {
    expect((await GET(get(null))).status).toBe(401);
  });

  it("refuses a driver", async () => {
    expect((await GET(get(AS.driver()))).status).toBe(403);
  });

  it("lets an owner read the position", async () => {
    const res = await GET(get(AS.owner()));
    expect(res.status).toBe(200);
    const { stock } = await res.json();
    expect(Array.isArray(stock)).toBe(true);
  });

  it("lets a salesperson read it, because knowing what is in the warehouse is selling", async () => {
    expect((await GET(get(AS.seller()))).status).toBe(200);
  });
});

describe("POST /api/sales/purchases", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    supplier: "کارخانه مرحبا",
    purchase_date: "2026-05-01",
    lines: [{ product_id: ctx.product, base_qty: 1000, unit_cost_toman: 3000 }],
    ...over,
  });

  it("refuses a manager", async () => {
    // Buying stock is spending company money, not running a territory.
    expect((await POST(post(AS.manager(), body()))).status).toBe(403);
  });

  it("refuses a salesperson", async () => {
    expect((await POST(post(AS.seller(), body()))).status).toBe(403);
  });

  it("lets an owner record a receipt", async () => {
    const res = await POST(post(AS.owner(), body()));
    expect(res.status).toBe(201);
  });

  it("rolls the average cost", async () => {
    const row = getDb()
      .prepare("SELECT avg_cost_toman FROM products WHERE id = ?")
      .get(ctx.product) as { avg_cost_toman: number };
    expect(row.avg_cost_toman).toBe(3000);
  });

  it("rejects a receipt with no lines", async () => {
    expect((await POST(post(AS.owner(), body({ lines: [] })))).status).toBe(400);
  });

  it("rejects a malformed date", async () => {
    expect(
      (await POST(post(AS.owner(), body({ purchase_date: "۱۴۰۵/۰۲/۱۱" })))).status
    ).toBe(400);
  });

  it("rejects a fractional unit cost", async () => {
    const res = await POST(
      post(AS.owner(), body({ lines: [{ product_id: ctx.product, base_qty: 1, unit_cost_toman: 1.5 }] }))
    );
    expect(res.status).toBe(400);
  });

  it("rejects a quantity of zero", async () => {
    const res = await POST(
      post(AS.owner(), body({ lines: [{ product_id: ctx.product, base_qty: 0, unit_cost_toman: 100 }] }))
    );
    expect(res.status).toBe(400);
  });

  it("404s a product that does not exist", async () => {
    const res = await POST(
      post(AS.owner(), body({ lines: [{ product_id: 999999, base_qty: 1, unit_cost_toman: 100 }] }))
    );
    expect(res.status).toBe(400);
  });
});
