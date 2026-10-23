import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-salescat-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/sales/products/route");
const { POST: POST_PACKAGING } = await import("@/app/api/sales/packagings/route");
const { POST: POST_PRICE } = await import("@/app/api/sales/prices/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { ROLES } = await import("@/lib/roles");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ids: Record<string, number> = {};

beforeAll(async () => {
  const db = getDb();
  await db.prepare(
    "INSERT INTO groups (name, slug, color, active, created_at) VALUES ('گروه شرق', 'east', '#2DE0E6', 1, ?)"
  ).run(new Date().toISOString());

  for (const role of ROLES) {
    ids[role] = Number(
      (await db
        .prepare(
          "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, 'x:y', ?, ?, ?, 1, ?)"
        )
        .run(`cat-${role}`, role, role, role === "owner" ? null : 1, new Date().toISOString()))
        .lastInsertRowid
    );
  }
});

function cookieFor(role: string) {
  const token = createSessionToken({
    uid: ids[role],
    role: role as "owner",
    gid: role === "owner" ? null : 1,
    oid: 1,
    tv: 0,
    name: role,
  });
  return `${COOKIE_NAME}=${token}`;
}

function req(url: string, role: string | null, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (role) headers.cookie = cookieFor(role);
  return new NextRequest(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  });
}

describe("GET /api/sales/products", () => {
  it("refuses an anonymous caller", async () => {
    expect((await GET(req("/api/sales/products", null))).status).toBe(401);
  });

  it("lets a driver read prices, because a driver is also the field rep", async () => {
    // This used to read "refuses a driver -- a driver sees the run they are on, not the
    // price list". In this app the driver role is also the field sales rep, and a rep who
    // cannot read a price cannot quote one at the door, which is the whole point of letting
    // them close a sale on a visit. The catalogue is company-wide, so there is no group
    // filter here; writing a price is still owner-only.
    const res = await GET(req("/api/sales/products", "delivery_driver"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.products)).toBe(true);
  });

  it("lets an owner read the catalogue", async () => {
    const res = await GET(req("/api/sales/products", "owner"));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("lets a salesperson read it, because they have to quote a price", async () => {
    expect((await GET(req("/api/sales/products", "phone_sales"))).status).toBe(200);
  });

  it("lets a group manager read it", async () => {
    expect((await GET(req("/api/sales/products", "group_manager"))).status).toBe(200);
  });
});

describe("POST /api/sales/products", () => {
  const body = { name: "دوغ لیوانی", kg_per_base_unit: 0.3, base_unit: "عدد" };

  it("refuses an anonymous caller", async () => {
    expect((await POST(req("/api/sales/products", null, body))).status).toBe(401);
  });

  it("refuses a salesperson", async () => {
    // Reading a price is part of selling. Setting one is not.
    expect((await POST(req("/api/sales/products", "phone_sales", body))).status).toBe(403);
  });

  it("refuses a group manager", async () => {
    expect((await POST(req("/api/sales/products", "group_manager", body))).status).toBe(403);
  });

  it("lets an owner add a product", async () => {
    const res = await POST(req("/api/sales/products", "owner", body));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    ids.product = json.id;
  });

  it("rejects a product with no name", async () => {
    const res = await POST(req("/api/sales/products", "owner", { name: "  ", kg_per_base_unit: 1 }));
    expect(res.status).toBe(400);
  });

  it("rejects a negative weight", async () => {
    const res = await POST(
      req("/api/sales/products", "owner", { name: "وزن منفی", kg_per_base_unit: -1 })
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sales/packagings", () => {
  it("lets an owner add a packaging", async () => {
    const res = await POST_PACKAGING(
      req("/api/sales/packagings", "owner", {
        product_id: ids.product,
        name: "شیرینک ۶ تایی",
        qty_per_pack: 6,
      })
    );
    expect(res.status).toBe(201);
  });

  it("refuses a salesperson", async () => {
    const res = await POST_PACKAGING(
      req("/api/sales/packagings", "phone_sales", {
        product_id: ids.product,
        name: "کارتن",
        qty_per_pack: 24,
      })
    );
    expect(res.status).toBe(403);
  });

  it("404s for a product that does not exist", async () => {
    const res = await POST_PACKAGING(
      req("/api/sales/packagings", "owner", { product_id: 999999, name: "کارتن", qty_per_pack: 24 })
    );
    expect(res.status).toBe(404);
  });

  it("rejects a pack quantity of zero", async () => {
    const res = await POST_PACKAGING(
      req("/api/sales/packagings", "owner", {
        product_id: ids.product,
        name: "خالی",
        qty_per_pack: 0,
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sales/prices", () => {
  it("lets an owner set a price", async () => {
    const res = await POST_PRICE(
      req("/api/sales/prices", "owner", {
        product_id: ids.product,
        price_toman: 45000,
        valid_from: "2026-08-01",
      })
    );
    expect(res.status).toBe(201);
  });

  it("refuses a group manager", async () => {
    const res = await POST_PRICE(
      req("/api/sales/prices", "group_manager", {
        product_id: ids.product,
        price_toman: 1,
        valid_from: "2026-08-01",
      })
    );
    expect(res.status).toBe(403);
  });

  it("rejects a fractional price", async () => {
    const res = await POST_PRICE(
      req("/api/sales/prices", "owner", {
        product_id: ids.product,
        price_toman: 45000.5,
        valid_from: "2026-08-01",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a malformed date", async () => {
    const res = await POST_PRICE(
      req("/api/sales/prices", "owner", {
        product_id: ids.product,
        price_toman: 45000,
        valid_from: "۱۴۰۵/۰۶/۰۴",
      })
    );
    expect(res.status).toBe(400);
  });

  it("records who set it, so a price change is attributable", async () => {
    await POST_PRICE(
      req("/api/sales/prices", "owner", {
        product_id: ids.product,
        price_toman: 47000,
        valid_from: "2026-09-01",
      })
    );
    const row = await getDb()
      .prepare(
        "SELECT created_by FROM product_prices WHERE product_id = ? ORDER BY id DESC LIMIT 1"
      )
      .get(ids.product) as { created_by: number };
    expect(row.created_by).toBe(ids.owner);
  });

  it("keeps the earlier price rather than overwriting it", async () => {
    const n = await getDb()
      .prepare("SELECT COUNT(*) AS n FROM product_prices WHERE product_id = ?")
      .get(ids.product) as { n: number };
    expect(n.n).toBeGreaterThan(1);
  });
});
