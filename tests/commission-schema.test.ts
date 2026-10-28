import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { tableInfo } from "./helpers/schema";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-commission-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = { seller: 0, owner: 0 };

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, active, created_at) VALUES (?, 'x', ?, ?, 1, ?)"
  );
  ctx.owner = Number((await user.run("o", "مالک", "owner", now)).lastInsertRowid);
  ctx.seller = Number((await user.run("nazanin", "نازنین", "phone_sales", now)).lastInsertRowid);
});

const cols = async (table: string) =>
  (await tableInfo(table) as unknown as { name: string }[]).map(
    (c) => c.name
  );

describe("commission_rates", () => {
  it("has the columns the module needs", async () => {
    expect((await cols("commission_rates")).sort()).toEqual(
      [
        // organization_id joined every tenant table once RouteFlow became multi-tenant.
        "organization_id",
        "id",
        "salesperson_user_id",
        "rate_per_kg_toman",
        "urgent_rate_per_kg_toman",
        "valid_from",
        "created_by",
        "created_at",
      ].sort()
    );
  });


  it("allows a company-wide rate with nobody named", async () => {
    await (async () =>
      await getDb()
        .prepare(
          "INSERT INTO commission_rates (salesperson_user_id, rate_per_kg_toman, valid_from, created_at) VALUES (NULL, ?, ?, ?)"
        )
        .run(2000, "2026-01-01", new Date().toISOString()))();
  });

  it("allows several rates over time, which is the whole point", async () => {
    const db = getDb();
    const insert = db.prepare(
      "INSERT INTO commission_rates (salesperson_user_id, rate_per_kg_toman, valid_from, created_at) VALUES (?, ?, ?, ?)"
    );
    await insert.run(ctx.seller, 2500, "2026-01-01", new Date().toISOString());
    await insert.run(ctx.seller, 3000, "2026-06-01", new Date().toISOString());
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM commission_rates WHERE salesperson_user_id = ?")
      .get(ctx.seller) as { n: number };
    expect(n.n).toBe(2);
  });
});

describe("commission_payments", () => {
  it("has the columns the module needs", async () => {
    expect((await cols("commission_payments")).sort()).toEqual(
      [
        // organization_id joined every tenant table once RouteFlow became multi-tenant.
        "organization_id",
        "id",
        "salesperson_user_id",
        "amount_toman",
        "paid_on",
        "period_from",
        "period_to",
        "notes",
        "created_by",
        "created_at",
      ].sort()
    );
  });


  it("requires a person to pay", async () => {
    // A payment with nobody attached is money leaving with no statement to reconcile
    // it against.
    await expect((async () =>
      await getDb()
        .prepare(
          "INSERT INTO commission_payments (salesperson_user_id, amount_toman, paid_on, created_at) VALUES (NULL, ?, ?, ?)"
        )
        .run(100000, "2026-08-01", new Date().toISOString()))()).rejects.toThrow();
  });

  it("refuses to pay somebody who does not exist", async () => {
    await expect((async () =>
      await getDb()
        .prepare(
          "INSERT INTO commission_payments (salesperson_user_id, amount_toman, paid_on, created_at) VALUES (?, ?, ?, ?)"
        )
        .run(999999, 100000, "2026-08-01", new Date().toISOString()))()).rejects.toThrow();
  });

  it("records a payment against a period", async () => {
    const db = getDb();
    await db.prepare(
      "INSERT INTO commission_payments (salesperson_user_id, amount_toman, paid_on, period_from, period_to, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(ctx.seller, 500000, "2026-08-01", "2026-07-01", "2026-07-31", ctx.owner, new Date().toISOString());

    const row = await db
      .prepare("SELECT amount_toman, period_from FROM commission_payments WHERE salesperson_user_id = ?")
      .get(ctx.seller) as { amount_toman: number; period_from: string };
    expect(row.amount_toman).toBe(500000);
    expect(row.period_from).toBe("2026-07-01");
  });
});
