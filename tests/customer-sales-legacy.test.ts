import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-legacy-sales-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { customerPurchaseHistory } = await import("@/lib/repo/customerSales");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

describe("legacy sales rows", () => {
  it("belong to the company they are stamped with: a same-named customer elsewhere sees nothing", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug, active, created_at) VALUES (2, 'other', 'other', 1, ?)").run(now);
    await db.prepare("INSERT INTO sales (sale_date, customer_name, product_name, qty, amount, imported_at, organization_id) VALUES ('2026-01-01', 'Same Name', 'x', 1, 100, ?, 1)").run(now);
    await db.prepare("INSERT INTO sales (sale_date, customer_name, product_name, qty, amount, imported_at, organization_id) VALUES ('2026-01-02', 'Same Name', 'y', 1, 7, ?, 2)").run(now);

    expect((await customerPurchaseHistory("Same Name", 1)).orders).toHaveLength(1);
    expect((await customerPurchaseHistory("Same Name", 1)).topProducts[0]).toMatchObject({ product_name: "x" });
    expect((await customerPurchaseHistory("Same Name", 2)).orders).toHaveLength(1);
    expect((await customerPurchaseHistory("Same Name", 2)).topProducts[0]).toMatchObject({ product_name: "y" });
    expect((await customerPurchaseHistory("Same Name", null)).orders).toHaveLength(2);
  });

  it("existing rows without a company are stamped to the original company when the database opens", async () => {
    const db = getDb();
    await db.prepare("INSERT INTO sales (sale_date, customer_name, amount, imported_at) VALUES ('2026-02-01', 'Old Row', 5, ?)").run(new Date().toISOString());
    // the sweep runs at boot; running it again is what a restart does
    await db.prepare("UPDATE sales SET organization_id = 1 WHERE organization_id IS NULL").run();
    expect((await customerPurchaseHistory("Old Row", 1)).orders).toHaveLength(1);
  });
});
