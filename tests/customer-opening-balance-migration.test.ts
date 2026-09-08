import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-openbal-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("opening balance migration", () => {
  it("drops the debt_* columns and adds opening_balance_toman defaulting to 0", () => {
    const cols = getDb().prepare("PRAGMA table_info(customers)").all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    const names = cols.map((c) => c.name);
    expect(names).not.toContain("debt_0_7");
    expect(names).not.toContain("debt_8_30");
    expect(names).not.toContain("debt_30_plus");
    const ob = cols.find((c) => c.name === "opening_balance_toman");
    expect(ob).toMatchObject({ type: "INTEGER", notnull: 1 });
    expect(String(ob?.dflt_value)).toBe("0");
  });

  it("seeds every existing customer at 0", () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('OB1','x','active','2026-01-01',1)"
    ).run();
    const row = db
      .prepare("SELECT opening_balance_toman FROM customers WHERE customer_code='OB1'")
      .get() as { opening_balance_toman: number };
    expect(row.opening_balance_toman).toBe(0);
  });

  it("keeps the per-tenant unique customer_code constraint", () => {
    const sql = (
      db_sql()
    );
    expect(sql).toContain("UNIQUE (organization_id, customer_code)");
  });
});

function db_sql(): string {
  return (
    getDb().prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customers'").get() as {
      sql: string;
    }
  ).sql;
}
