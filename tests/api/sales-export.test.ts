import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-export-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { GET } = await import("@/app/api/sales/orders/export/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
import type { Role } from "@/lib/db";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = { east: 0, west: 0, owner: 0, eastManager: 0, driver: 0 };

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
  ctx.owner = Number(user.run("o", "مالک", "owner", null, now).lastInsertRowid);
  ctx.eastManager = Number(user.run("em", "مدیر شرق", "group_manager", ctx.east, now).lastInsertRowid);
  ctx.driver = Number(user.run("d", "راننده", "driver", ctx.east, now).lastInsertRowid);

  const customer = db.prepare(
    "INSERT INTO customers (customer_code, business_name, group_id, synced_at, organization_id) VALUES (?, ?, ?, ?, 1)"
  );
  const eastCustomer = Number(customer.run("C1", "رستوران شرق", ctx.east, now).lastInsertRowid);
  const westCustomer = Number(customer.run("C2", "رستوران غرب", ctx.west, now).lastInsertRowid);

  const product = createProduct(db, { name: "کره گیاهی", kg_per_base_unit: 0.25, organization_id: 1 });
  const packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 100 });
  setPrice(db, { product_id: product, price_toman: 440000, valid_from: "2026-01-01" });

  for (const customerId of [eastCustomer, westCustomer]) {
    createOrder(db, {
      customer_id: customerId,
      order_date: "2026-08-26",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: product, packaging_id: packaging, packs: 2 }],
    });
  }
});

function req(uid: number, role: Role, gid: number | null) {
  const token = createSessionToken({ uid, role, gid, oid: 1, tv: 0, name: "t" });
  return new NextRequest("http://localhost/api/sales/orders/export", {
    headers: { cookie: `${COOKIE_NAME}=${token}` },
  });
}

async function rowsOf(res: Response): Promise<string[][]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await res.arrayBuffer());
  const sheet = book.worksheets[0];
  const out: string[][] = [];
  sheet.eachRow((row) => {
    out.push((row.values as unknown[]).slice(1).map((v) => String(v ?? "")));
  });
  return out;
}

describe("GET /api/sales/orders/export", () => {
  it("refuses an anonymous caller", async () => {
    const res = await GET(new NextRequest("http://localhost/api/sales/orders/export"));
    expect(res.status).toBe(401);
  });

  it("refuses a driver", async () => {
    expect((await GET(req(ctx.driver, "driver", ctx.east))).status).toBe(403);
  });

  it("returns a spreadsheet, not JSON", async () => {
    const res = await GET(req(ctx.owner, "owner", null));
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain(".xlsx");
  });

  it("gives an owner every group's orders", async () => {
    const rows = await rowsOf(await GET(req(ctx.owner, "owner", null)));
    const body = rows.slice(1).map((r) => r.join(" "));
    expect(body.some((r) => r.includes("رستوران شرق"))).toBe(true);
    expect(body.some((r) => r.includes("رستوران غرب"))).toBe(true);
  });

  it("scopes a manager to their own group", async () => {
    // The easiest place in any app to leak a whole table, because it looks like a file
    // rather than a query.
    const rows = await rowsOf(await GET(req(ctx.eastManager, "group_manager", ctx.east)));
    const body = rows.slice(1).map((r) => r.join(" "));
    expect(body.some((r) => r.includes("رستوران شرق"))).toBe(true);
    expect(body.some((r) => r.includes("رستوران غرب"))).toBe(false);
  });

  it("writes dates in Shamsi, matching every screen they came from", async () => {
    const rows = await rowsOf(await GET(req(ctx.owner, "owner", null)));
    expect(rows[1].some((cell) => cell.includes("۱۴۰۵"))).toBe(true);
  });

  it("has a header row in Persian", async () => {
    const rows = await rowsOf(await GET(req(ctx.owner, "owner", null)));
    expect(rows[0]).toContain("مشتری");
    expect(rows[0]).toContain("مبلغ (تومان)");
  });

  it("is not cached, because the table underneath it moves", async () => {
    const res = await GET(req(ctx.owner, "owner", null));
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
