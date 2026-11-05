import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-invoice-sent-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { stampInvoiceSent } = await import("@/lib/repo/driverStops");
const { isInvoiceVia } = await import("@/lib/invoiceSent");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("invoice sent stamp (FB38)", () => {
  it("keeps the first time and way the receipt went out, and only in its own company", async () => {
    const db = getDb();
    const at = new Date().toISOString();
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('c1','فروشگاه',?,1)").run(at)).lastInsertRowid);
    const user = Number((await db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at, organization_id) VALUES ('u1','x','م','owner',?,1)").run(at)).lastInsertRowid);
    const order = Number((await db.prepare("INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id) VALUES ('1405-00001', ?, 'DELIVERED', '2026-11-05', ?, ?, ?, 1)").run(cust, user, at, at)).lastInsertRowid);
    const read = async () => (await db.prepare("SELECT invoice_sent_at, invoice_sent_via FROM orders WHERE id = ?").get(order)) as { invoice_sent_at: string | null; invoice_sent_via: string | null };

    await stampInvoiceSent(order, 2, "share");
    expect((await read()).invoice_sent_at).toBeNull();
    await stampInvoiceSent(order, 1, "bluetooth");
    const first = await read();
    await stampInvoiceSent(order, 1, "pdf");
    expect(await read()).toEqual(first);
    expect(first.invoice_sent_via).toBe("bluetooth");
    expect(isInvoiceVia("pdf")).toBe(true);
    expect(isInvoiceVia("email")).toBe(false);
  });
});
