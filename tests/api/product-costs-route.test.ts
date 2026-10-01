import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-costs-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { createProduct, createPackaging, setCost } = await import("@/lib/catalogue");
const { POST: setCostRoute } = await import("@/app/api/sales/costs/route");
const { NextRequest } = await import("next/server");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const ctx = { ownerId: 0, sellerId: 0, product: 0, packaging: 0 };

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)").run(
    "سازمان دوم",
    "second-org",
    now
  );
  const u = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at) VALUES (?, ?, ?, ?, 1, ?)"
  );
  ctx.ownerId = Number(u.run("owner", "x:y", "مالک", "owner", now).lastInsertRowid);
  ctx.sellerId = Number(u.run("nazanin", "x:y", "نازنین", "phone_sales", now).lastInsertRowid);
  ctx.product = createProduct(db, {
    name: "دوغ لیوانی",
    kg_per_base_unit: 0.25,
    organization_id: 1,
  });
  ctx.packaging = createPackaging(db, {
    product_id: ctx.product,
    name: "جعبه ۲۴ تایی",
    qty_per_pack: 24,
  });
});

type ReqInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function as(userId: number, role: "owner" | "phone_sales", init: ReqInit = {}) {
  const token = createSessionToken({ uid: userId, role, gid: null, oid: 1, tv: 0, name: "t" });
  return new NextRequest("http://localhost/api/sales/costs", {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: `${COOKIE_NAME}=${token}` },
  });
}

const post = (payload: unknown): ReqInit => ({
  method: "POST",
  body: JSON.stringify(payload),
  headers: { "Content-Type": "application/json" },
});

const valid = {
  product_id: 0,
  packaging_id: null,
  method: "landed",
  cost_toman: 50_000,
  valid_from: "2026-06-01",
};

describe("POST /api/sales/costs", () => {
  it("records a landed cost and returns its id", async () => {
    const res = await setCostRoute(
      as(ctx.ownerId, "owner", post({ ...valid, product_id: ctx.product }))
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    const row = getDb()
      .prepare("SELECT cost_toman, method FROM product_costs WHERE id = ?")
      .get(data.id) as { cost_toman: number; method: string };
    expect(row.cost_toman).toBe(50_000);
    expect(row.method).toBe("landed");
  });

  it("refuses a فروشنده with 403", async () => {
    const res = await setCostRoute(
      as(ctx.sellerId, "phone_sales", post({ ...valid, product_id: ctx.product }))
    );
    expect(res.status).toBe(403);
  });

  it("refuses a fractional cost with 400", async () => {
    const res = await setCostRoute(
      as(ctx.ownerId, "owner", post({ ...valid, product_id: ctx.product, cost_toman: 50_000.5 }))
    );
    expect(res.status).toBe(400);
  });

  it("refuses a negative cost with 400", async () => {
    const res = await setCostRoute(
      as(ctx.ownerId, "owner", post({ ...valid, product_id: ctx.product, cost_toman: -5 }))
    );
    expect(res.status).toBe(400);
  });

  it("refuses an unknown method with 400", async () => {
    const res = await setCostRoute(
      as(ctx.ownerId, "owner", post({ ...valid, product_id: ctx.product, method: "lifo" }))
    );
    expect(res.status).toBe(400);
  });

  it("refuses a Jalali date with 400, because nothing would ever match it", async () => {
    const res = await setCostRoute(
      as(ctx.ownerId, "owner", post({ ...valid, product_id: ctx.product, valid_from: "۱۴۰۵/۰۶/۰۴" }))
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sales/costs — tenancy and shape", () => {
  it("refuses another tenant's product with 404", async () => {
    // product_costs carries no organization_id of its own, so the ONLY thing stopping a
    // cross-tenant write is this join through products. Remove it and this goes green.
    const db = getDb();
    const theirs = createProduct(db, {
      name: "کالای آن‌ها",
      kg_per_base_unit: 1,
      organization_id: 2,
    });
    const res = await setCostRoute(as(ctx.ownerId, "owner", post({ ...valid, product_id: theirs })));
    expect(res.status).toBe(404);
  });

  it("refuses a packaging belonging to another product with 404", async () => {
    const db = getDb();
    const other = createProduct(db, {
      name: "محصول دیگر",
      kg_per_base_unit: 1,
      organization_id: 1,
    });
    const otherPack = createPackaging(db, {
      product_id: other,
      name: "کارتن",
      qty_per_pack: 1,
    });
    const res = await setCostRoute(
      as(ctx.ownerId, "owner", post({ ...valid, product_id: ctx.product, packaging_id: otherPack }))
    );
    expect(res.status).toBe(404);
  });

  it("accepts a packaging belonging to the SAME product", async () => {
    const res = await setCostRoute(
      as(
        ctx.ownerId,
        "owner",
        post({
          ...valid,
          product_id: ctx.product,
          packaging_id: ctx.packaging,
          cost_toman: 1_200_000,
        })
      )
    );
    expect(res.status).toBe(201);
  });

  it("has no PATCH or DELETE, so a cost row cannot be edited", async () => {
    // The absence IS the feature, exactly as on /api/sales/prices. A cost row that could
    // be edited would take every order priced from it with it.
    const mod = await import("@/app/api/sales/costs/route");
    expect("PATCH" in mod).toBe(false);
    expect("DELETE" in mod).toBe(false);
  });

  it("stacks rather than replacing, so history survives", async () => {
    setCost(getDb(), {
      product_id: ctx.product,
      packaging_id: null,
      method: "landed",
      cost_toman: 60_000,
      valid_from: "2026-07-01",
    });
    const rows = getDb()
      .prepare("SELECT COUNT(*) AS n FROM product_costs WHERE product_id = ?")
      .get(ctx.product) as { n: number };
    expect(rows.n).toBeGreaterThan(1);
  });
});
