import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(os.tmpdir(), `rf-handbooks-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { recordPayment, voidPayment } = await import("@/lib/repo/payments");
const { holdings, confirmHandover, recentGaps } = await import("@/lib/repo/cashInHand");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let rep = 0;
let owner = 0;
let cust = 0;

beforeEach(async () => {
  const db = getDb();
  await clearLedger(db);
  await db.exec("DELETE FROM cash_handovers; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM customers; DELETE FROM users WHERE id > 0;");
  const now = new Date().toISOString();
  const mk = async (role: string) => Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)").run(`${role}${Math.random()}`, "x:y", role, role, now)).lastInsertRowid);
  rep = await mk("field_rep");
  owner = await mk("owner");
  cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES (?,?,'active','2026-01-01',1)").run(`C${Math.random()}`, "x")).lastInsertRowid);
});

const legsOf = async (type: string, sourceId: number) =>
  (await getDb()
    .prepare(`SELECT a.code, l.side, l.amount_toman FROM journals j JOIN ledger_entries l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id WHERE j.source_type = ? AND j.source_id = ? ORDER BY l.side, a.code`)
    .all(type, sourceId)) as { code: string; side: string; amount_toman: number }[];
const at = () => new Date().toISOString();

describe("D1 cash in hand reaches the books", () => {
  it("books a rep's cash to 1104 and an owner's cash to 1101", async () => {
    const a = await recordPayment(1, { customer_id: cust, amount_toman: 1000, method: "CASH", received_at: at(), received_by: rep });
    const b = await recordPayment(1, { customer_id: cust, amount_toman: 400, method: "CASH", received_at: at(), received_by: owner });
    expect((await legsOf("PAYMENT", a)).find((l) => l.side === "D")?.code).toBe("1104");
    expect((await legsOf("PAYMENT", b)).find((l) => l.side === "D")?.code).toBe("1101");
  });

  it("the count moves the cash to 1101 and books a shortage to 5111", async () => {
    await recordPayment(1, { customer_id: cust, amount_toman: 1000, method: "CASH", received_at: at(), received_by: rep });
    const [h] = await holdings(1);
    await confirmHandover(1, rep, h.through, 900, "پول خرد", owner);
    const id = Number(((await getDb().prepare("SELECT id FROM cash_handovers").get()) as { id: number }).id);
    expect(await legsOf("HANDOVER", id)).toEqual([
      { code: "1104", side: "C", amount_toman: 1000 },
      { code: "1101", side: "D", amount_toman: 900 },
      { code: "5111", side: "D", amount_toman: 100 },
    ]);
  });

  it("books an overage as a credit to 5111, and an exact count has no gap leg", async () => {
    await recordPayment(1, { customer_id: cust, amount_toman: 500, method: "CASH", received_at: at(), received_by: rep });
    const [h] = await holdings(1);
    await confirmHandover(1, rep, h.through, 600, "اضافه", owner);
    const id = Number(((await getDb().prepare("SELECT id FROM cash_handovers").get()) as { id: number }).id);
    expect((await legsOf("HANDOVER", id)).map((l) => `${l.code}${l.side}${l.amount_toman}`)).toEqual(["1104C500", "5111C100", "1101D600"]);
  });

  it("voiding before the count comes out of 1104, after the count out of 1101", async () => {
    const early = await recordPayment(1, { customer_id: cust, amount_toman: 300, method: "CASH", received_at: at(), received_by: rep });
    await voidPayment(1, early, owner, "اشتباه");
    const rev = (await getDb().prepare("SELECT id FROM journals WHERE source_type = 'REVERSAL' AND source_id = ?").get(early)) as { id: number };
    expect((await legsOf("REVERSAL", early)).find((l) => l.side === "C")?.code).toBe("1104");
    expect(rev.id).toBeGreaterThan(0);

    const late = await recordPayment(1, { customer_id: cust, amount_toman: 700, method: "CASH", received_at: at(), received_by: rep });
    const [h] = await holdings(1);
    await confirmHandover(1, rep, h.through, 700, "", owner);
    await voidPayment(1, late, owner, "اشتباه");
    expect((await legsOf("REVERSAL", late)).find((l) => l.side === "C")?.code).toBe("1101");
  });

  it("leaves 1104 at zero once everything is counted", async () => {
    await recordPayment(1, { customer_id: cust, amount_toman: 800, method: "CASH", received_at: at(), received_by: rep });
    const [h] = await holdings(1);
    await confirmHandover(1, rep, h.through, 800, "", owner);
    const r = (await getDb()
      .prepare(`SELECT COALESCE(SUM(CASE WHEN l.side='D' THEN l.amount_toman ELSE -l.amount_toman END),0) AS bal FROM ledger_entries l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1104'`)
      .get()) as { bal: number };
    expect(Number(r.bal)).toBe(0);
  });

  it("lists a short count for the owner, and not an exact one", async () => {
    await recordPayment(1, { customer_id: cust, amount_toman: 500, method: "CASH", received_at: at(), received_by: rep });
    const [h] = await holdings(1);
    await confirmHandover(1, rep, h.through, 450, "کم", owner);
    expect(await recentGaps(1)).toMatchObject([{ short: 50, reason: "کم" }]);
    await recordPayment(1, { customer_id: cust, amount_toman: 200, method: "CASH", received_at: at(), received_by: rep });
    const [h2] = await holdings(1);
    await confirmHandover(1, rep, h2.through, 200, "", owner);
    expect(await recentGaps(1)).toHaveLength(1);
  });
});
