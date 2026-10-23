import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-stockthresh-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct } = await import("@/lib/catalogue");
const { PATCH } = await import("@/app/api/sales/products/[id]/stock-thresholds/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = { owner: 0, manager: 0, product: 0 };

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  ctx.owner = Number(
    (await db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES ('o', 'x', 'مالک', 'owner', NULL, 1, ?)"
      )
      .run(now)).lastInsertRowid
  );
  ctx.manager = Number(
    (await db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES ('m', 'x', 'مدیر', 'group_manager', NULL, 1, ?)"
      )
      .run(now)).lastInsertRowid
  );
  ctx.product = await createProduct(db, { name: "کالای نمونه", kg_per_base_unit: 1, organization_id: 1 });
});

function cookieFor(uid: number, role: "owner" | "group_manager") {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role, gid: null, oid: 1, tv: 0, name: "t" })}`;
}

function patch(id: number | string, cookie: string | null, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost/api/sales/products/${id}/stock-thresholds`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers,
  });
}
const ctxParams = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

describe("PATCH /api/sales/products/[id]/stock-thresholds", () => {
  it("refuses an anonymous caller", async () => {
    const res = await PATCH(patch(ctx.product, null, { reorder_point: 10 }), ctxParams(ctx.product));
    expect(res.status).toBe(401);
  });

  it("refuses a group manager -- this is payroll-adjacent policy, owner only", async () => {
    const res = await PATCH(
      patch(ctx.product, cookieFor(ctx.manager, "group_manager"), { reorder_point: 10 }),
      ctxParams(ctx.product)
    );
    expect(res.status).toBe(403);
  });

  it("lets an owner set both thresholds", async () => {
    const res = await PATCH(
      patch(ctx.product, cookieFor(ctx.owner, "owner"), { reorder_point: 20, target_stock: 80 }),
      ctxParams(ctx.product)
    );
    expect(res.status).toBe(200);
    const row = await getDb().prepare("SELECT reorder_point, target_stock FROM products WHERE id = ?").get(ctx.product) as {
      reorder_point: number;
      target_stock: number;
    };
    expect(row.reorder_point).toBe(20);
    expect(row.target_stock).toBe(80);
  });

  it("clears a threshold when the value is null, without touching the other", async () => {
    const res = await PATCH(
      patch(ctx.product, cookieFor(ctx.owner, "owner"), { reorder_point: null }),
      ctxParams(ctx.product)
    );
    expect(res.status).toBe(200);
    const row = await getDb().prepare("SELECT reorder_point, target_stock FROM products WHERE id = ?").get(ctx.product) as {
      reorder_point: number | null;
      target_stock: number;
    };
    expect(row.reorder_point).toBeNull();
    expect(row.target_stock).toBe(80);
  });

  it("rejects a negative threshold", async () => {
    const res = await PATCH(
      patch(ctx.product, cookieFor(ctx.owner, "owner"), { reorder_point: -5 }),
      ctxParams(ctx.product)
    );
    expect(res.status).toBe(400);
  });

  it("404s for a product that does not exist", async () => {
    const res = await PATCH(patch(999999, cookieFor(ctx.owner, "owner"), { reorder_point: 5 }), ctxParams(999999));
    expect(res.status).toBe(404);
  });

  it("400s for a non-numeric id", async () => {
    const res = await PATCH(patch("abc", cookieFor(ctx.owner, "owner"), { reorder_point: 5 }), ctxParams("abc"));
    expect(res.status).toBe(400);
  });
});
