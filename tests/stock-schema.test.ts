import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-stock-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("stock & batches schema", () => {
  it("creates the four tables and adds products.shelf_life_days", async () => {
    const db = getDb();
    for (const t of ["batches", "stock_movements", "delivery_line_batches", "quality_complaints"]) {
      expect(await db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({ n: 0 });
    }
    const cols = (await db.prepare("PRAGMA table_info(products)").all() as { name: string }[]).map(
      (c) => c.name
    );
    expect(cols).toContain("shelf_life_days");
  });

  it("batches are unique per (organization_id, product_id, batch_code)", async () => {
    const sql = (
      await getDb().prepare("SELECT sql FROM sqlite_master WHERE name='batches'").get() as { sql: string }
    ).sql;
    expect(sql).toContain("UNIQUE (organization_id, product_id, batch_code)");
  });

  it("stock_movements.kind rejects an unknown kind", async () => {
    await expect((async () =>
      await getDb()
        .prepare(
          "INSERT INTO stock_movements (organization_id,facility_id,product_id,base_qty,kind,occurred_at,created_at) VALUES (1,1,1,1,'MAGIC','x','x')"
        )
        .run())()).rejects.toThrow();
  });

  it("all four are tenant tables", () => {
    for (const t of ["batches", "stock_movements", "delivery_line_batches", "quality_complaints"]) {
      expect((TENANT_TABLES as readonly string[]).includes(t)).toBe(true);
    }
  });
});
