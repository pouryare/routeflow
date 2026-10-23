import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// A dedicated env override, read BEFORE lib/db is imported, so a real-data copy can be
// checked without tests/tenancy-schema.test.ts's unconditional overwrite getting in the
// way (see the "Bugs found and fixed" note in the tenancy handoff).
const realDbPath = process.env.ROUTEFLOW_MIGRATION_CHECK_DB;
const testDbPath =
  realDbPath ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-m2cust-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  if (!realDbPath) for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("customers M2 migration", () => {
  it("adds the lifecycle columns and drops status", async () => {
    const cols = (await getDb().prepare("PRAGMA table_info(customers)").all() as { name: string }[]).map(
      (c) => c.name
    );
    for (const c of [
      "customer_type",
      "lifecycle",
      "parent_customer_id",
      "payment_terms_days",
      "hard_credit_block",
      "qualified_at",
      "first_order_at",
    ]) {
      expect(cols, `missing ${c}`).toContain(c);
    }
    expect(cols).not.toContain("status");
  });

  it("keeps the business_name index", async () => {
    const idx = await getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='customers'")
      .all() as { name: string }[];
    expect(idx.map((i) => i.name)).toContain("idx_customers_business_name");
  });

  it.skipIf(realDbPath)("defaults lifecycle to 'lead' and enforces the enum", async () => {
    const db = getDb();
    await db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (5,'F','f','2026-01-01')`);
    await db.exec(
      `INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('K1','x','2026-01-01',5)`
    );
    const row = await db
      .prepare("SELECT lifecycle FROM customers WHERE customer_code='K1'")
      .get() as { lifecycle: string };
    expect(row.lifecycle).toBe("lead");
    await expect((async () =>
      await db.exec(
        `INSERT INTO customers (customer_code, business_name, lifecycle, synced_at, organization_id) VALUES ('K2','x','bogus','2026-01-01',5)`
      ))()).rejects.toThrow();
  });

  it.runIf(realDbPath)("maps every real status value to a valid lifecycle", async () => {
    const db = getDb();
    const bad = await db
      .prepare(
        "SELECT DISTINCT lifecycle FROM customers WHERE lifecycle NOT IN ('lead','qualified','sampled','active','dormant','lost','blocked')"
      )
      .all();
    expect(bad).toEqual([]);
    const active = await db
      .prepare("SELECT COUNT(*) n FROM customers WHERE lifecycle='active'")
      .get() as { n: number };
    expect(active.n).toBeGreaterThanOrEqual(89); // فعال + مشتری فعال in the 2026-09-01 backup
  });
});
