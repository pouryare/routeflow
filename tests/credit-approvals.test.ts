import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-credit-")), "t.db");
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, TENANT_TABLES } = await import("@/lib/db");
const { requestApproval, decide, listApprovals, CreditApprovalError } =
  await import("@/lib/repo/creditApprovals");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

function seed(orgId: number, code: string, wholesale = false) {
  const db = getDb();
  db.exec(`INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (${orgId},'O','o${orgId}','2026-01-01')`);
  const custId = Number(
    db
      .prepare(
        `INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES (?,?,?,'active','2026-01-01',?)`
      )
      .run(code, "x", wholesale ? "WHOLESALE" : "RESTAURANT", orgId).lastInsertRowid
  );
  const uId = Number(
    db
      .prepare(
        `INSERT INTO users (username,password_hash,display_name,role,organization_id,active,created_at) VALUES (?,?,?,'group_manager',?,1,'2026-01-01')`
      )
      .run(`u${code}`, "x", "u", orgId).lastInsertRowid
  );
  const orderId = Number(
    db
      .prepare(
        `INSERT INTO orders (order_no,customer_id,order_date,status,credit_hold,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,'PENDING_CREDIT',1,?,?,?,?)`
      )
      .run(`ord-${code}`, custId, "2026-01-01", uId, "2026-01-01", "2026-01-01", orgId).lastInsertRowid
  );
  return { custId, uId, orderId };
}

describe("credit_approvals", () => {
  it("is a tenant table", () => {
    expect(TENANT_TABLES).toContain("credit_approvals");
  });

  it("records a request for a direct customer and computes the overage", () => {
    const { custId, uId, orderId } = seed(9, "D1");
    const id = requestApproval(9, {
      order_id: orderId,
      requested_by: uId,
      customer_id: custId,
      customer_balance_toman: 5_000_000,
      credit_limit_toman: 3_000_000,
    });
    const row = getDb()
      .prepare("SELECT status, overage_toman FROM credit_approvals WHERE id=?")
      .get(id) as { status: string; overage_toman: number };
    expect(row).toMatchObject({ status: "pending", overage_toman: 2_000_000 });
  });

  it("decides a pending request, then refuses a second decision", () => {
    const { custId, uId, orderId } = seed(9, "D2");
    const id = requestApproval(9, {
      order_id: orderId,
      requested_by: uId,
      customer_id: custId,
      customer_balance_toman: 1_000,
      credit_limit_toman: 0,
    });
    decide(9, id, "approved", uId, "تأیید تلفنی مدیر");
    expect(
      (getDb().prepare("SELECT status, reason FROM credit_approvals WHERE id=?").get(id) as {
        status: string;
        reason: string;
      })
    ).toMatchObject({ status: "approved", reason: "تأیید تلفنی مدیر" });
    expect(() => decide(9, id, "rejected", uId)).toThrow(CreditApprovalError);
  });

  it("refuses a request for a representative customer", () => {
    const { custId, uId, orderId } = seed(10, "W1", true);
    getDb()
      .prepare(
        "INSERT INTO representative_profiles (organization_id,customer_id,rep_code,stage,credit_terms_days,created_at,updated_at) VALUES (10,?,'RW','active',0,'2026-01-01','2026-01-01')"
      )
      .run(custId);
    expect(() =>
      requestApproval(10, {
        order_id: orderId,
        requested_by: uId,
        customer_id: custId,
        customer_balance_toman: 1,
        credit_limit_toman: 0,
      })
    ).toThrow(CreditApprovalError);
  });

  it("does not decide another organisation's request", () => {
    const { custId, uId, orderId } = seed(9, "D3");
    const id = requestApproval(9, {
      order_id: orderId,
      requested_by: uId,
      customer_id: custId,
      customer_balance_toman: 1,
      credit_limit_toman: 0,
    });
    expect(() => decide(11, id, "approved", uId)).toThrow(CreditApprovalError);
    expect(listApprovals(11)).toEqual([]);
  });
});
