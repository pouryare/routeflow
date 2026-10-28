import { describe, it, expect, beforeAll } from "vitest";

process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { postJournal, accountIdByCode } = await import("@/lib/repo/ledger");
const { postExpense } = await import("@/lib/repo/ledgerPostings");
const { addShareholder, setShares, setLegalForm } = await import("@/lib/repo/shareholders");
const { previewSplit, postSplit, postPartnerAdvance, postDividendPayment, partnerBalances, setCostRule } = await import("@/lib/repo/profitSplit");
const { LedgerError } = await import("@/lib/repo/ledgerCore");

const ORG = 1;
const ctx = { owner: 0, east: 0, west: 0, ali: 0, sara: 0 };
const acc = async (code: string) => (await accountIdByCode(code))!;

/** A one-sided story in a group: revenue and cost of goods. */
async function sale(groupId: number | null, revenue: number, cost: number, at: string) {
  await postJournal(getDb(), {
    organizationId: ORG, postedAt: at, sourceType: "MANUAL", createdBy: ctx.owner,
    legs: [
      { accountId: await acc("1201"), side: "D", amountToman: revenue, groupId },
      { accountId: await acc("4101"), side: "C", amountToman: revenue, groupId },
      ...(cost ? [
        { accountId: await acc("5101"), side: "D" as const, amountToman: cost, groupId },
        { accountId: await acc("1203"), side: "C" as const, amountToman: cost, groupId },
      ] : []),
    ],
  });
}

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const group = db.prepare("INSERT INTO groups (name, slug, color, active, created_at, organization_id) VALUES (?, ?, '#0ff', 1, ?, 1)");
  ctx.east = Number((await group.run("شرق", "east", now)).lastInsertRowid);
  ctx.west = Number((await group.run("غرب", "west", now)).lastInsertRowid);
  ctx.owner = Number((await db.prepare("INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES ('o','x','مالک','owner',1,?,1)").run(now)).lastInsertRowid);
  ctx.ali = await addShareholder(db, { organizationId: ORG, name: "علی" });
  ctx.sara = await addShareholder(db, { organizationId: ORG, name: "سارا" });
  // Whole company: Ali 60 / Sara 40. East's own shareholders: Ali alone. West's: Sara alone.
  await setShares(db, { organizationId: ORG, groupId: null, validFrom: "2026-01-01", createdBy: ctx.owner, shares: [{ partyId: ctx.ali, percentBp: 6000 }, { partyId: ctx.sara, percentBp: 4000 }] });
  await setShares(db, { organizationId: ORG, groupId: ctx.east, validFrom: "2026-01-01", createdBy: ctx.owner, shares: [{ partyId: ctx.ali, percentBp: 10000 }] });
  await setShares(db, { organizationId: ORG, groupId: ctx.west, validFrom: "2026-01-01", createdBy: ctx.owner, shares: [{ partyId: ctx.sara, percentBp: 10000 }] });

  // 1405 (2026-03-21 .. 2027-03-20)
  await sale(ctx.east, 1000, 400, "2026-06-01"); // east: 600
  await sale(ctx.west, 500, 700, "2026-06-02"); // west: -200
  await sale(null, 200, 0, "2026-06-03"); // a customer with no group: company level
  const rent = await acc("5102");
  const salary = await acc("5103");
  await postExpense(db, { organizationId: ORG, accountId: rent, amountToman: 300, method: "CASH", incurredAt: "2026-06-10", incurredBy: ctx.owner }); // shared: east 200, west 100
  await postExpense(db, { organizationId: ORG, accountId: salary, amountToman: 90, method: "CASH", incurredAt: "2026-06-11", incurredBy: ctx.owner }); // company level (rule below)
  await setCostRule(db, { organizationId: ORG, accountId: salary, mode: "company" });
});

describe("the yearly profit split", () => {
  it("reads group profit off the ledger, dividing shared costs by sales and keeping company-level ones back", async () => {
    const p = await previewSplit(getDb(), ORG, 1405);
    expect(p.totalProfitToman).toBe(210); // 1700 revenue - 1100 cost of goods - 300 rent - 90 salary
    const east = p.groups.find((g) => g.groupId === ctx.east)!;
    const west = p.groups.find((g) => g.groupId === ctx.west)!;
    expect(east.profitToman).toBe(400); // 600 - 200 of the rent (1000 of 1500 in sales... 2/3 of 300)
    expect(west.profitToman).toBe(-300); // -200 - 100
    expect(west.distributableToman).toBe(0);
    expect(west.lossAfterToman).toBe(300); // carried: the company absorbs it now
    expect(p.poolToman).toBe(210 - 400); // the company pool carries west's loss and the salary
    expect(p.lines).toEqual([{ groupId: ctx.east, partyId: ctx.ali, name: "علی", amountToman: 400 }]);
    expect(p.reserveToman).toBe(0); // unregistered
  });

  it("takes the legal reserve for a registered company, and nets an advance against what the partner is owed", async () => {
    const db = getDb();
    await setLegalForm(db, ORG, "registered");
    const cash = await acc("1101");
    await postJournal(db, { organizationId: ORG, postedAt: "2026-04-01", sourceType: "OPENING", createdBy: ctx.owner, legs: [
      { accountId: cash, side: "D", amountToman: 10000 }, { accountId: await acc("3101"), side: "C", amountToman: 10000 },
    ] });
    await postPartnerAdvance(db, { organizationId: ORG, partyId: ctx.ali, amountToman: 150, method: "CASH", paidOn: "2026-08-01", createdBy: ctx.owner });

    const p = await previewSplit(db, ORG, 1405);
    expect(p.reserveToman).toBe(20); // a twentieth of 400, well under a tenth of the 10,000 capital
    expect(p.distributedToman).toBe(380);
    expect(p.parties).toEqual([{ partyId: ctx.ali, name: "علی", grossToman: 380, advanceNettedToman: 150, netPayableToman: 230 }]);
    expect(p.needsApproval).toBe(true);

    await expect(postSplit(db, { organizationId: ORG, year: 1405, createdBy: ctx.owner })).rejects.toThrow(LedgerError); // no assembly date
    await postSplit(db, { organizationId: ORG, year: 1405, approvedOn: "2027-04-10", createdBy: ctx.owner });

    const [ali] = (await partnerBalances(db, ORG)).filter((b) => b.partyId === ctx.ali);
    expect(ali.dividendsOwedToman).toBe(230); // 380 credited less the 150 advance netted
    expect(ali.advancesToman).toBe(0);
    await expect(postSplit(db, { organizationId: ORG, year: 1405, approvedOn: "2027-04-10", createdBy: ctx.owner })).rejects.toThrow(/قبلاً/);
    expect((await previewSplit(db, ORG, 1405)).alreadyDone).toBe(true);
  });

  it("pays dividends out, but never more than is owed", async () => {
    const db = getDb();
    await expect(postDividendPayment(db, { organizationId: ORG, partyId: ctx.ali, amountToman: 231, method: "CASH", paidOn: "2027-04-12", createdBy: ctx.owner })).rejects.toThrow(LedgerError);
    await postDividendPayment(db, { organizationId: ORG, partyId: ctx.ali, amountToman: 230, method: "CASH", paidOn: "2027-04-12", createdBy: ctx.owner });
    expect((await partnerBalances(db, ORG)).find((b) => b.partyId === ctx.ali)!.dividendsOwedToman).toBe(0);
  });

  it("repays a group's carried loss out of its next profit before its shareholders are paid", async () => {
    const db = getDb();
    await sale(ctx.west, 700, 0, "2027-06-01"); // 1406: west earns 700
    const p = await previewSplit(db, ORG, 1406);
    const west = p.groups.find((g) => g.groupId === ctx.west)!;
    expect(west).toMatchObject({ profitToman: 700, repaidToman: 300, distributableToman: 400, lossAfterToman: 0 });
    expect(p.lines.find((l) => l.groupId === ctx.west)).toMatchObject({ partyId: ctx.sara, amountToman: 380 }); // 400 less the reserve share
  });

  it("keeps the books balanced after all of it", async () => {
    const { trialBalance } = await import("@/lib/repo/ledger");
    const t = await trialBalance(ORG);
    expect(t.totalDebit).toBe(t.totalCredit);
  });
});
