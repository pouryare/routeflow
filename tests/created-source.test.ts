import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-source-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createdSourceLabel } = await import("@/lib/createdSource");
const { createTask } = await import("@/lib/repo/tasks");
const { recordPayment } = await import("@/lib/repo/payments");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("created source (T5)", () => {
  it("reads as a Persian phrase, and nothing for a record made before it was kept", () => {
    expect(createdSourceLabel("import")).toBe("بارگذاری اکسل");
    expect(createdSourceLabel(null)).toBeNull();
    expect(createdSourceLabel("mystery")).toBeNull();
  });

  it("a task made by a person says form, a payment says form unless the phone synced it", async () => {
    const db = getDb();
    const tag = Math.random().toString(36).slice(2, 7);
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,'x','م','owner',1,'2026-01-01',1)").run(`s-${tag}`)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES (?, 'x','active','2026-01-01',1)").run(`S-${tag}`)).lastInsertRowid);
    const taskId = await createTask(1, { kind: "note", title: "یک کار", created_by: user });
    expect(((await db.prepare("SELECT created_source FROM tasks WHERE id = ?").get(taskId)) as { created_source: string }).created_source).toBe("form");
    const pay = (source?: "offline") => recordPayment(1, { customer_id: cust, amount_toman: 1000, method: "CASH", received_at: new Date().toISOString(), received_by: user, source });
    const a = await pay();
    const b = await pay("offline");
    const src = async (id: number) => ((await db.prepare("SELECT created_source FROM payments WHERE id = ?").get(id)) as { created_source: string }).created_source;
    expect([await src(a), await src(b)]).toEqual(["form", "offline"]);
  });
});
