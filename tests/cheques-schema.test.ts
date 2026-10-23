import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-cheques-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("cheques schema", () => {
  it("has an INTEGER NOT NULL amount and a status CHECK", async () => {
    const db = getDb();
    const cols = await db.prepare("PRAGMA table_info(cheques)").all() as {
      name: string;
      type: string;
      notnull: number;
    }[];
    expect(cols.find((c) => c.name === "amount_toman")).toMatchObject({ type: "INTEGER", notnull: 1 });
    await expect((async () =>
      await db
        .prepare(
          "INSERT INTO cheques (organization_id,customer_id,amount_toman,cheque_no,due_date,status,received_at,received_by,created_at,updated_at) VALUES (1,1,1000,'x','x','posted','x',1,'x','x')"
        )
        .run())()).rejects.toThrow();
  });

  it("is unique per (organization_id, customer_id, cheque_no)", async () => {
    const sql = (
      await getDb().prepare("SELECT sql FROM sqlite_master WHERE name='cheques'").get() as { sql: string }
    ).sql;
    expect(sql).toContain("UNIQUE (organization_id, customer_id, cheque_no)");
  });

  it("is a tenant table", () => {
    expect((TENANT_TABLES as readonly string[]).includes("cheques")).toBe(true);
  });
});
