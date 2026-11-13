import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-promise-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { tehranTodayIso } = await import("@/lib/jalali");
const { createPromise, cancelPromise, promisesOf, promiseStatus } = await import("@/lib/repo/promises");
const { riskFor } = await import("@/lib/repo/creditRisk");
const { creditRisk } = await import("@/lib/creditRisk");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("F46 risk score", () => {
  it("adds transparent points, shows the three biggest reasons and stays advisory", () => {
    const none = creditRisk({ overdueDays: 0, bouncedCheques: 0, balanceToman: 0, limitToman: null, brokenPromises: 0 });
    expect(none).toEqual({ score: 0, level: "low", reasons: [] });
    const bad = creditRisk({ overdueDays: 45, bouncedCheques: 1, balanceToman: 100, limitToman: 100, brokenPromises: 1 });
    expect(bad.score).toBe(75);
    expect(bad.level).toBe("high");
    expect(bad.reasons).toHaveLength(3);
    expect(bad.reasons[0]).toMatch(/سررسید/);
  });
});

describe("F50 promises", () => {
  it("is open before its day, kept by a big enough payment and broken after its day", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('pr','x','م','owner',1,?,1)").run(now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('CP','وعده‌دار','active',?,1)").run(now)).lastInsertRowid);
    const today = tehranTodayIso();
    expect(await createPromise(1, cust, 0, today, user)).toMatch(/مبلغ/);
    expect(await createPromise(1, cust, 500, "2020-01-01", user)).toMatch(/تاریخ/);
    expect(await createPromise(1, 999999, 500, today, user)).toMatch(/مشتری/);
    expect(await createPromise(1, cust, 500, today, user)).toBeNull();
    expect((await promisesOf(1, cust))[0].status).toBe("open");

    // Judged on a later day, the same unpaid promise is broken; a payment since it was noted keeps it.
    const row = { cancelled_at: null, paid_since: 0, amount_toman: 500, promised_date: today };
    expect(promiseStatus(row, "2999-01-01")).toBe("broken");
    expect(promiseStatus({ ...row, paid_since: 500 }, "2999-01-01")).toBe("kept");
    await db.prepare("INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,created_at) VALUES (1,?,500,'CASH',?,?,?)").run(cust, new Date(Date.now() + 1000).toISOString(), user, now);
    expect((await promisesOf(1, cust))[0].status).toBe("kept");

    expect(await createPromise(1, cust, 9_000_000, today, user)).toBeNull();
    const second = (await promisesOf(1, cust)).find((p) => p.status === "open")!;
    expect(await cancelPromise(1, cust, second.id)).toBe(true);
    expect((await promisesOf(1, cust)).find((p) => p.id === second.id)?.status).toBe("cancelled");
  });

  it("counts a bounced cheque and a broken promise in the customer's score", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('pr2','x','م','owner',1,?,1)").run(now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('CR','ریسکی','active',?,1)").run(now)).lastInsertRowid);
    await db.prepare("INSERT INTO cheques (organization_id,customer_id,amount_toman,cheque_no,due_date,status,received_at,received_by,bounced_at,created_at,updated_at) VALUES (1,?,1000,'1','2026-01-01','bounced',?,?,?,?,?)").run(cust, now, user, now, now, now);
    await db.prepare("INSERT INTO payment_promises (organization_id,customer_id,amount_toman,promised_date,created_by,created_at) VALUES (1,?,500,?,?,?)").run(cust, tehranTodayIso(new Date(Date.now() - 5 * 86_400_000)), user, new Date(Date.now() - 9 * 86_400_000).toISOString());
    const r = (await riskFor(1, [cust])).get(cust)!;
    expect(r.score).toBe(25);
    expect(r.level).toBe("medium");
    expect(r.reasons.sort()).toHaveLength(2);
  });
});
