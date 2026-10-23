import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-pay-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("payments schema", () => {
  it("creates payments with an INTEGER NOT NULL amount and a method CHECK", async () => {
    const db = getDb();
    const cols = await db.prepare("PRAGMA table_info(payments)").all() as {
      name: string;
      type: string;
      notnull: number;
    }[];
    const amount = cols.find((c) => c.name === "amount_toman");
    expect(amount?.type).toBe("INTEGER");
    expect(amount?.notnull).toBe(1);
    await expect((async () =>
      await db
        .prepare(
          "INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,created_at) VALUES (1,1,1000,'WIRE','x',1,'x')"
        )
        .run())()).rejects.toThrow();
  });

  it("creates payment_allocations with a nullable order_id and a NOT NULL amount", async () => {
    const db = getDb();
    const cols = await db.prepare("PRAGMA table_info(payment_allocations)").all() as {
      name: string;
      notnull: number;
    }[];
    expect(cols.find((c) => c.name === "order_id")?.notnull).toBe(0);
    expect(cols.find((c) => c.name === "amount_toman")?.notnull).toBe(1);
  });

  it("lets photos.entity_type be 'payment'", async () => {
    const db = getDb();
    const sql = (
      await db.prepare("SELECT sql FROM sqlite_master WHERE name='photos'").get() as { sql: string }
    ).sql;
    expect(sql).toContain("'payment'");
  });
});
