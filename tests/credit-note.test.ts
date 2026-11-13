import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-cn-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { customerDebt } = await import("@/lib/repo/payments");
const { issueCreditNote } = await import("@/lib/repo/creditNote");
import type { Session } from "@/lib/session";
afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("B1 credit note", () => {
  it("lowers the debt, posts Dr 4102 / Cr 1201, and refuses more than is owed or no reason", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('cn','x','c','group_manager',?,1)").run(now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('CN1','ف','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
    const order = Number((await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,created_by,created_at,updated_at,organization_id) VALUES ('CN-1',?,'2026-01-01','DELIVERED','2026-01-01',?,?,?,1)").run(cust, user, now, now)).lastInsertRowid);
    const product = Number((await db.prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES ('p','s1',?,?,1)").run(now, now)).lastInsertRowid);
    const pack = Number((await db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'box',1,?)").run(product, now)).lastInsertRowid);
    await db.prepare("INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at) VALUES (?,?,?,1,1,100000,0,1,1,0,?)").run(order, product, pack, now);
    const s = { organizationId: 1, role: "group_manager", user: { id: user } } as unknown as Session;
    await expect(issueCreditNote(s, cust, 200_000, "damaged")).rejects.toThrow(/بیشتر/);
    await expect(issueCreditNote(s, cust, 1000, "nope")).rejects.toThrow(/دلیل/);
    const id = await issueCreditNote(s, cust, 30_000, "damaged");
    expect((await customerDebt(1, cust)).total).toBe(70_000);
    const legs = (await db.prepare("SELECT a.code, l.side FROM journals j JOIN ledger_entries l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id WHERE j.source_type = 'PAYMENT' AND j.source_id = ? ORDER BY l.side").all(id)) as { code: string; side: string }[];
    expect(legs).toEqual([{ code: "1201", side: "C" }, { code: "4102", side: "D" }]);
  });
});
