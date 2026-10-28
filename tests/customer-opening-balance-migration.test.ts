import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { tableInfo } from "./helpers/schema";

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
  it("drops the debt_* columns and adds opening_balance_toman defaulting to 0", async () => {
    const cols = await tableInfo("customers") as {
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

  it("seeds every existing customer at 0", async () => {
    const db = getDb();
    await db.prepare(
      "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('OB1','x','active','2026-01-01',1)"
    ).run();
    const row = await db
      .prepare("SELECT opening_balance_toman FROM customers WHERE customer_code='OB1'")
      .get() as { opening_balance_toman: number };
    expect(row.opening_balance_toman).toBe(0);
  });

});
