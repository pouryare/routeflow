import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-cust-delta-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { currentCustomerToken, customersChangedSince, parseCustomerToken } = await import("@/lib/repo/customerList");
const { tombstone } = await import("@/lib/repo/tombstones");
const { applyCustomerDelta } = await import("@/lib/customerDelta");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let groupA = 0;
let cA = 0;
let cB = 0;

const addCustomer = async (code: string, group: number | null) =>
  Number(
    (await getDb()
      .prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES (?,?,'active',?,?,1)")
      .run(code, `shop ${code}`, new Date().toISOString(), group)).lastInsertRowid
  );

beforeEach(async () => {
  const db = getDb();
  await db.exec("PRAGMA foreign_keys=OFF; DELETE FROM deleted_rows; DELETE FROM payments; DELETE FROM customers; DELETE FROM groups; PRAGMA foreign_keys=ON;");
  groupA = Number((await db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('A','a',?,1)").run(new Date().toISOString())).lastInsertRowid);
  cA = await addCustomer("A", groupA);
  cB = await addCustomer("B", groupA);
});

/* The bookmark's transaction id is the oldest transaction running anywhere on the server (as in the offline sync,
   tests/sync-pull.test.ts), and the other test files write in parallel, so a delta may repeat a customer the
   phone already has. What must hold is that nothing that changed is MISSING, and nothing foreign appears. */
describe("customer list delta", () => {
  it("a bookmark is ours or nothing", () => {
    expect(parseCustomerToken("d1.123.1762700000000")).toEqual({ xid: "123", ms: 1762700000000 });
    expect(parseCustomerToken("x:123")).toBeNull();
    expect(parseCustomerToken(null)).toBeNull();
  });

  it("sends nothing when nothing changed, and the list size", async () => {
    const token = await currentCustomerToken();
    const d = await customersChangedSince(1, "all", token);
    expect((d?.customers ?? []).every((c) => [cA, cB].includes(c.id))).toBe(true);
    expect(d?.removed).toEqual([]);
    expect(d?.total).toBe(2);
  });

  it("sends only the customer that was edited", async () => {
    const token = await currentCustomerToken();
    await getDb().prepare("UPDATE customers SET business_name = 'renamed' WHERE id = ?").run(cA);
    const d = await customersChangedSince(1, "all", token);
    expect(d?.customers.map((c) => c.id)).toContain(cA);
    expect(d?.customers.find((c) => c.id === cA)?.business_name).toBe("renamed");
  });

  it("sends a customer whose debt moved because a payment was taken", async () => {
    const token = await currentCustomerToken();
    const now = new Date().toISOString();
    const db = getDb();
    const user = Number(
      (await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)").run(`u${Date.now()}`, "x", "م", "owner", now)).lastInsertRowid
    );
    await db
      .prepare("INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,created_at) VALUES (1,?,1000,'CASH',?,?,?)")
      .run(cB, now, user, now);
    const d = await customersChangedSince(1, "all", token);
    expect(d?.customers.map((c) => c.id)).toContain(cB);
  });

  it("reports deleted customers and respects the group scope", async () => {
    const token = await currentCustomerToken();
    await tombstone(1, "customers", 999);
    const d = await customersChangedSince(1, "all", token);
    expect(d?.removed).toEqual([999]);
    expect((await customersChangedSince(1, [], token))?.total).toBe(0);
  });

  it("applies a delta to the held list: replace, add, remove, and the same array when quiet", () => {
    const held = [{ id: 1, business_name: "الف" }, { id: 2, business_name: "ب" }];
    expect(applyCustomerDelta(held, { customers: [], removed: [] })).toBe(held);
    const next = applyCustomerDelta(held, { customers: [{ id: 2, business_name: "ب۲" }, { id: 3, business_name: "ج" }], removed: [1] });
    expect(next.map((c) => c.id)).toEqual([2, 3]);
    expect(next[0].business_name).toBe("ب۲");
  });
});
