import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-payroll-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { payrollSheet, payrollCsvRows, monthPeriod } = await import("@/lib/repo/payrollSheet");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const db = getDb();
const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('pay-u','x:y','علی','phone_sales',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
const account = Number(((await db.prepare("SELECT id FROM accounts WHERE type = 'EXPENSE' AND is_postable = 1 LIMIT 1").get()) as { id: number }).id);
const owner: Session = { user: { id: user } as Session["user"], role: "owner", groupId: null, organizationId: 1, roles: ["owner"], hasRole: (x) => x === "owner" };

describe("monthly pay sheet", () => {
  it("covers one Jalali month and counts staff costs approved in it", async () => {
    expect(monthPeriod(1405, 1)).toEqual({ from: "2026-03-21", to: "2026-04-20" });
    const p = monthPeriod(1405, 8);
    const at = `${p.from}T08:00:00.000Z`;
    await db.prepare("INSERT INTO expense_claims (organization_id, user_id, account_id, amount_toman, incurred_at, status, created_at, decided_at) VALUES (1,?,?,120000,?, 'approved', ?, ?)").run(user, account, p.from, at, at);
    await db.prepare("INSERT INTO expense_claims (organization_id, user_id, account_id, amount_toman, incurred_at, status, created_at, decided_at) VALUES (1,?,?,50000,?, 'paid', ?, ?)").run(user, account, p.from, at, at);
    const rows = await payrollSheet(owner, 1405, 8);
    const r = rows.find((x) => x.user_id === user)!;
    expect(r.claims_approved_toman).toBe(170_000);
    expect(r.claims_unpaid_toman).toBe(120_000);
    expect(payrollCsvRows(rows)[0][0]).toBe("نام");
    expect((await payrollSheet(owner, 1405, 9)).find((x) => x.user_id === user)?.claims_approved_toman ?? 0).toBe(0);
  });
});
