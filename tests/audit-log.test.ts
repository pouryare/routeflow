import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-audit-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { withDbActor, withDbScope } = await import("@/lib/database/scope");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let cust = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec("PRAGMA foreign_keys=OFF; DELETE FROM audit_log; DELETE FROM customers; PRAGMA foreign_keys=ON;");
  cust = Number(
    (await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id,credit_limit_toman) VALUES ('C1','x','active','2026-01-01',1,1000)").run()).lastInsertRowid
  );
});

type Row = { table_name: string; row_id: number; op: string; changes_json: string; actor_user_id: number | null; impersonated_by: number | null };
const rows = async () => (await getDb().prepare("SELECT * FROM audit_log ORDER BY id").all()) as unknown as Row[];

describe("audit_log (E4)", () => {
  it("records only the columns that changed, with old and new, and who did it", async () => {
    await withDbActor("5", () => getDb().prepare("UPDATE customers SET credit_limit_toman = 5000, notes = 'hi' WHERE id = ?").run(cust));
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ table_name: "customers", row_id: cust, op: "update", actor_user_id: 5, impersonated_by: null });
    expect(JSON.parse(r[0].changes_json)).toEqual({ credit_limit_toman: { old: 1000, new: 5000 } });
  });

  it("names the owner who was really driving under Login-As", async () => {
    await withDbActor("5:9", () => getDb().prepare("UPDATE customers SET credit_limit_toman = 7 WHERE id = ?").run(cust));
    expect((await rows())[0]).toMatchObject({ actor_user_id: 5, impersonated_by: 9 });
  });

  it("writes nothing for an update that touches no audited column or sets the same value", async () => {
    const db = getDb();
    await db.prepare("UPDATE customers SET notes = 'only a note' WHERE id = ?").run(cust);
    await db.prepare("UPDATE customers SET credit_limit_toman = 1000 WHERE id = ?").run(cust);
    expect(await rows()).toHaveLength(0);
  });

  it("work no person asked for is recorded as the system (no user)", async () => {
    await getDb().prepare("UPDATE customers SET credit_limit_toman = 1 WHERE id = ?").run(cust);
    expect((await rows())[0].actor_user_id).toBeNull();
  });

  it("never stores a password hash", async () => {
    const db = getDb();
    const id = Number(
      (await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('au','h1','م','owner',1,'2026-01-01',1)").run()).lastInsertRowid
    );
    await db.prepare("UPDATE users SET password_hash = 'h2', role = 'group_manager' WHERE id = ?").run(id);
    const users = (await rows()).filter((x) => x.table_name === "users");
    expect(users.map((x) => x.op)).toEqual(["insert", "update"]);
    expect(users.map((x) => x.changes_json).join()).not.toContain("h1");
    expect(users.map((x) => x.changes_json).join()).not.toContain("h2");
    expect(JSON.parse(users[1].changes_json)).toEqual({ role: { old: "owner", new: "group_manager" } });
  });

  it("cannot be edited or deleted", async () => {
    await getDb().prepare("UPDATE customers SET credit_limit_toman = 2 WHERE id = ?").run(cust);
    await expect(getDb().prepare("UPDATE audit_log SET op = 'delete'").run()).rejects.toThrow(/append-only/);
    await expect(getDb().prepare("DELETE FROM audit_log").run()).rejects.toThrow(/append-only/);
  });

  it("another company cannot read it", async () => {
    await getDb().prepare("UPDATE customers SET credit_limit_toman = 3 WHERE id = ?").run(cust);
    const n = await withDbScope("org:2", async () => ((await getDb().prepare("SELECT COUNT(*) n FROM audit_log").get()) as { n: number }).n);
    expect(Number(n)).toBe(0);
    expect(await rows()).toHaveLength(1);
  });
});
