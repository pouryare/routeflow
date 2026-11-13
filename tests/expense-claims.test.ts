import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { canDecideClaim, claimProblem } from "@/lib/expenseClaims";

const testDbPath = path.join(os.tmpdir(), `rf-claims-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const c = await import("@/lib/repo/expenseClaims");
const { expenseCategories } = await import("@/lib/repo/ledgerPostings");
const { tehranTodayIso } = await import("@/lib/jalali");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("claim rules", () => {
  const claim = { userId: 5, groupId: 3, amountToman: 400_000 };
  it("lets the owner decide anything and a manager only their group's claims up to the limit, never their own", () => {
    expect(canDecideClaim({ role: "owner", userId: 1, groupId: null }, { ...claim, amountToman: 9e9 }, 500_000)).toBe(true);
    expect(canDecideClaim({ role: "group_manager", userId: 2, groupId: 3 }, claim, 500_000)).toBe(true);
    expect(canDecideClaim({ role: "group_manager", userId: 2, groupId: 3 }, { ...claim, amountToman: 600_000 }, 500_000)).toBe(false);
    expect(canDecideClaim({ role: "group_manager", userId: 2, groupId: 4 }, claim, 500_000)).toBe(false);
    expect(canDecideClaim({ role: "group_manager", userId: 5, groupId: 3 }, claim, 500_000)).toBe(false);
    expect(canDecideClaim({ role: "phone_sales", userId: 2, groupId: 3 }, claim, 500_000)).toBe(false);
  });
  it("checks amount, day and note", () => {
    expect(claimProblem({ amountToman: 0, incurredAt: "2026-11-01", today: "2026-11-13", note: null })).toMatch(/مبلغ/);
    expect(claimProblem({ amountToman: 1000, incurredAt: "2026-12-01", today: "2026-11-13", note: null })).toMatch(/تاریخ/);
    expect(claimProblem({ amountToman: 1000, incurredAt: "2026-11-01", today: "2026-11-13", note: null })).toBeNull();
  });
});

describe("F26 + F88 claim, approve, repay", () => {
  let owner = 0, gm = 0, driver = 0, fuel = 0;
  const who = (role: string, userId: number, groupId: number | null) => ({ role, organizationId: 1, userId, groupId });
  beforeAll(async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const g = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('cl-g','cl-g',?,1)").run(now)).lastInsertRowid);
    const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)");
    owner = Number((await u.run("cl-o", "x", "مالک", "owner", null, now)).lastInsertRowid);
    gm = Number((await u.run("cl-gm", "x", "مدیر", "group_manager", g, now)).lastInsertRowid);
    driver = Number((await u.run("cl-d", "x", "راننده", "delivery_driver", g, now)).lastInsertRowid);
    fuel = (await expenseCategories()).find((x) => x.code === "5104")!.id;
  });

  it("a driver claims, the manager approves within the limit, the books owe the driver, the owner pays back", async () => {
    const gid = (await getDb().prepare("SELECT group_id FROM users WHERE id = ?").get(driver) as { group_id: number }).group_id;
    const id = await c.submitClaim({ organizationId: 1, userId: driver, groupId: Number(gid) }, { account_id: fuel, amount_toman: 120_000, note: "بنزین" });
    expect((await c.claimsToDecide(who("group_manager", gm, Number(gid)))).map((r) => r.id)).toContain(id);
    await expect(c.decideClaim(who("delivery_driver", driver, Number(gid)), id, "approve")).rejects.toThrow(/نمی‌توانید/);
    await expect(c.decideClaim(who("group_manager", gm, Number(gid)), id, "reject")).rejects.toThrow(/دلیل/);
    expect(await c.decideClaim(who("group_manager", gm, Number(gid)), id, "approve")).toBe("approved");
    expect(await c.owedToStaff(1)).toEqual([{ user_id: driver, user_name: "راننده", owed_toman: 120_000, claims: 1 }]);
    const legs = (await getDb().prepare("SELECT a.code, e.side, e.amount_toman AS amount FROM ledger_entries e JOIN accounts a ON a.id = e.account_id JOIN expense_claims x ON x.expense_journal_id = e.journal_id WHERE x.id = ?").all(id)) as { code: string; side: string; amount: number }[];
    expect(legs.map((l) => `${l.code}${l.side}${Number(l.amount)}`).sort()).toEqual(["2107C120000", "5104D120000"]);
    await expect(c.decideClaim(who("owner", owner, null), id, "approve")).rejects.toThrow(/قبلاً/);
    expect(await c.repayStaff(1, driver, "CASH", owner)).toBe(120_000);
    expect(await c.owedToStaff(1)).toEqual([]);
    expect((await c.myClaims(1, driver))[0].status).toBe("paid");
    await expect(c.repayStaff(1, driver, "CASH", owner)).rejects.toThrow(/چیزی/);
  });

  it("a claim over the manager's limit waits for the owner; a rejection keeps its reason; today is allowed, tomorrow is not", async () => {
    const id = await c.submitClaim({ organizationId: 1, userId: driver, groupId: null }, { account_id: fuel, amount_toman: 900_000 });
    expect((await c.claimsToDecide(who("group_manager", gm, null))).map((r) => r.id)).not.toContain(id);
    expect((await c.claimsToDecide(who("owner", owner, null))).map((r) => r.id)).toContain(id);
    expect(await c.decideClaim(who("owner", owner, null), id, "reject", "رسید ندارد")).toBe("rejected");
    expect((await c.myClaims(1, driver)).find((r) => r.id === id)).toMatchObject({ status: "rejected", reject_reason: "رسید ندارد" });
    await expect(c.submitClaim({ organizationId: 1, userId: driver, groupId: null }, { account_id: fuel, amount_toman: 5, incurred_at: "2999-01-01" })).rejects.toThrow(/تاریخ/);
    await expect(c.submitClaim({ organizationId: 1, userId: driver, groupId: null }, { account_id: 1, amount_toman: 5, incurred_at: tehranTodayIso() })).rejects.toThrow(/هزینه نیست/);
  });
});
