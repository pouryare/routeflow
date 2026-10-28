/** Advances, dividends and the yearly profit split (company-and-shareholders, step 4).
 *
 *  Profit is not stored: it is read off the ledger for a Jalali year, by group. A line's group comes from the
 *  line itself (sales carry the customer's group, a manager's expenses their group, commission the person's
 *  group); an expense with no group is shared, and divided between groups by sales or kept at company level
 *  according to the company's rule for that account (`shared_cost_rules`).
 *
 *  A group that has shares of its own is carved out: its profit, less any loss it still owes the company, goes to
 *  its own shareholders. Everything else (the company-level pool, and any group without shares) goes to the
 *  company's shareholders, so a group's loss is absorbed by the pool now and repaid out of that group's later
 *  profit first. The split journal is Dr 3103 / Cr dividends payable per partner (and Cr the legal reserve for a
 *  registered company); advances a partner already took (2106) are netted against what they are owed. */
import type { Db } from "@/lib/database/client";
import { tehranTodayIso } from "@/lib/jalali";
import { allocate, legalReserve, settleGroup, shareOverhead, weightedShares, yearBounds, type ShareSet } from "@/lib/profitSplit";
import { accountIdByCode } from "./ledger";
import { postJournal, LedgerError, type LedgerLeg } from "./ledgerCore";
import { cashAccountFor } from "./ledgerPostings";
import { legalFormOf, listShareholders, type LegalForm } from "./shareholders";

export type CostRule = "sales_share" | "company";

async function account(code: string): Promise<number> {
  const id = await accountIdByCode(code);
  if (!id) throw new LedgerError(`حساب ${code} یافت نشد`);
  return id;
}

/** Net balance of an account for one party or all of a company, in the account's own direction. */
async function balanceOf(db: Db, organizationId: number, code: string, partyId?: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN e.side = 'C' THEN e.amount_toman ELSE -e.amount_toman END), 0) AS credit
         FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.organization_id = ? AND a.code = ?${partyId == null ? "" : " AND e.party_id = ?"}`
    )
    .get(...(partyId == null ? [organizationId, code] : [organizationId, code, partyId])) as { credit: number };
  return Number(row.credit);
}

/* ------------------------------------------------------------------ advances and payouts */

export interface PartnerBalance {
  partyId: number;
  name: string;
  /** Dividends credited and not yet paid out. */
  dividendsOwedToman: number;
  /** Advances taken and not yet netted against a split. */
  advancesToman: number;
}

export async function partnerBalances(db: Db, organizationId: number): Promise<PartnerBalance[]> {
  const people = await listShareholders(db, organizationId);
  const out: PartnerBalance[] = [];
  for (const p of people) {
    out.push({
      partyId: p.id,
      name: p.name,
      dividendsOwedToman: await balanceOf(db, organizationId, "2105", p.id),
      advancesToman: 0 - (await balanceOf(db, organizationId, "2106", p.id)),
    });
  }
  return out;
}

async function requireShareholder(db: Db, organizationId: number, partyId: number): Promise<void> {
  if (!(await listShareholders(db, organizationId)).some((s) => s.id === partyId && s.active)) {
    throw new LedgerError("شریک یافت نشد");
  }
}

/** Money a partner takes against their share of the year: Dr 2106 / Cr cash. */
export async function postPartnerAdvance(
  db: Db,
  input: { organizationId: number; partyId: number; amountToman: number; method: string; paidOn: string; createdBy: number }
): Promise<number> {
  await requireShareholder(db, input.organizationId, input.partyId);
  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.paidOn,
    sourceType: "PARTNER_ADVANCE",
    createdBy: input.createdBy,
    memo: "علی‌الحساب شریک",
    legs: [
      { accountId: await account("2106"), side: "D", amountToman: input.amountToman, partyId: input.partyId },
      { accountId: await cashAccountFor(input.method), side: "C", amountToman: input.amountToman },
    ],
  });
}

/** Capital a partner put in: Dr cash / Cr 3101 (their own). */
export async function postCapitalContribution(
  db: Db,
  input: { organizationId: number; partyId: number; amountToman: number; method: string; paidOn: string; createdBy: number }
): Promise<number> {
  await requireShareholder(db, input.organizationId, input.partyId);
  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.paidOn,
    sourceType: "MANUAL",
    createdBy: input.createdBy,
    memo: "سرمایهٔ شریک",
    legs: [
      { accountId: await cashAccountFor(input.method), side: "D", amountToman: input.amountToman },
      { accountId: await account("3101"), side: "C", amountToman: input.amountToman, partyId: input.partyId },
    ],
  });
}

/** Paying out dividends already credited: Dr 2105 / Cr cash. Refused above what is owed. */
export async function postDividendPayment(
  db: Db,
  input: { organizationId: number; partyId: number; amountToman: number; method: string; paidOn: string; createdBy: number }
): Promise<number> {
  await requireShareholder(db, input.organizationId, input.partyId);
  const owed = await balanceOf(db, input.organizationId, "2105", input.partyId);
  if (input.amountToman > owed) throw new LedgerError("بیشتر از سود پرداخت‌نشدهٔ این شریک است");
  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.paidOn,
    sourceType: "DIVIDEND_PAYMENT",
    createdBy: input.createdBy,
    memo: "پرداخت سود سهام",
    legs: [
      { accountId: await account("2105"), side: "D", amountToman: input.amountToman, partyId: input.partyId },
      { accountId: await cashAccountFor(input.method), side: "C", amountToman: input.amountToman },
    ],
  });
}

/* ------------------------------------------------------------------ shared-cost rules */

export async function costRules(db: Db, organizationId: number): Promise<Map<number, CostRule>> {
  const rows = await db.prepare("SELECT account_id, mode FROM shared_cost_rules WHERE organization_id = ?").all(organizationId) as unknown as {
    account_id: number;
    mode: CostRule;
  }[];
  return new Map(rows.map((r) => [Number(r.account_id), r.mode]));
}

export async function setCostRule(db: Db, input: { organizationId: number; accountId: number; mode: CostRule }): Promise<void> {
  if (input.mode !== "sales_share" && input.mode !== "company") throw new LedgerError("قاعدهٔ تقسیم معتبر نیست");
  const acct = await db.prepare("SELECT type FROM accounts WHERE id = ?").get(input.accountId) as { type: string } | undefined;
  if (acct?.type !== "EXPENSE") throw new LedgerError("این حساب، حساب هزینه نیست");
  await db
    .prepare(
      `INSERT INTO shared_cost_rules (organization_id, account_id, mode) VALUES (?, ?, ?)
       ON CONFLICT (organization_id, account_id) DO UPDATE SET mode = EXCLUDED.mode`
    )
    .run(input.organizationId, input.accountId, input.mode);
}

/* ------------------------------------------------------------------ the split */

interface SplitGroupRow {
  groupId: number;
  name: string;
  profitToman: number;
  repaidToman: number;
  distributableToman: number;
  lossAfterToman: number;
}
interface SplitLine { groupId: number | null; partyId: number; name: string; amountToman: number }
interface SplitPartyRow { partyId: number; name: string; grossToman: number; advanceNettedToman: number; netPayableToman: number }

export interface SplitPreview {
  year: number;
  from: string;
  to: string;
  legalForm: LegalForm;
  totalProfitToman: number;
  groups: SplitGroupRow[];
  poolToman: number;
  reserveToman: number;
  distributedToman: number;
  lines: SplitLine[];
  parties: SplitPartyRow[];
  warnings: string[];
  alreadyDone: boolean;
  /** A registered company needs the date the general assembly approved the split. */
  needsApproval: boolean;
}

async function shareSets(db: Db, organizationId: number, groupId: number | null, to: string): Promise<ShareSet[]> {
  const rows = await db
    .prepare(
      `SELECT valid_from AS "validFrom", party_id AS "partyId", percent_bp AS "percentBp" FROM shareholdings
        WHERE organization_id = ? AND COALESCE(group_id, 0) = ? AND valid_from <= ? ORDER BY valid_from`
    )
    .all(organizationId, groupId ?? 0, to) as unknown as { validFrom: string; partyId: number; percentBp: number }[];
  const sets = new Map<string, ShareSet>();
  for (const r of rows) {
    const set = sets.get(r.validFrom) ?? { validFrom: r.validFrom, shares: [] };
    set.shares.push({ partyId: Number(r.partyId), percentBp: Number(r.percentBp) });
    sets.set(r.validFrom, set);
  }
  return [...sets.values()];
}

/** Everything the split would do for a year, computed and not stored. */
export async function previewSplit(db: Db, organizationId: number, year: number): Promise<SplitPreview> {
  const { from, to } = yearBounds(year);
  const legalForm = await legalFormOf(db, organizationId);
  const warnings: string[] = [];

  // Net profit contribution by (group, account): a credit adds to profit and a debit takes from it, for revenue and expense alike.
  const rows = await db
    .prepare(
      `SELECT COALESCE(e.group_id,
                CASE WHEN j.source_type = 'SALE' THEN
                  (SELECT c.group_id FROM ledger_entries e2 JOIN customers c ON c.id = e2.customer_id
                    WHERE e2.journal_id = j.id AND e2.customer_id IS NOT NULL LIMIT 1) END) AS gid,
              a.id AS account_id, a.type,
              SUM(CASE WHEN e.side = 'C' THEN e.amount_toman ELSE -e.amount_toman END) AS net
         FROM ledger_entries e
         JOIN journals j ON j.id = e.journal_id
         JOIN accounts a ON a.id = e.account_id
        WHERE e.organization_id = ? AND a.type IN ('REVENUE','EXPENSE') AND j.posted_at >= ? AND j.posted_at <= ?
        GROUP BY 1, 2, 3`
    )
    .all(organizationId, from, `${to}￿`) as unknown as { gid: number | null; account_id: number; type: string; net: number }[];

  const rules = await costRules(db, organizationId);
  const direct = new Map<number, number>(); // group -> profit before shared costs
  const sales = new Map<number, number>();
  let sharedPool = 0; // untagged costs to divide by sales (negative)
  let total = 0;
  for (const r of rows) {
    const net = Number(r.net);
    total += net;
    if (r.gid == null) {
      // Untagged revenue and company-rule costs stay in the company pool, which is whatever `total` leaves.
      if (r.type === "EXPENSE" && (rules.get(Number(r.account_id)) ?? "sales_share") === "sales_share") sharedPool += net;
      continue;
    }
    const g = Number(r.gid);
    direct.set(g, (direct.get(g) ?? 0) + net);
    if (r.type === "REVENUE") sales.set(g, (sales.get(g) ?? 0) + net);
  }
  // Overhead is divided between groups that sold something; with none, it stays with the company.
  const salesBase = new Map([...sales].filter(([, v]) => v > 0));
  let allocated = new Map<number, number>();
  if (salesBase.size > 0) allocated = shareOverhead(sharedPool, salesBase); // with no group selling, it stays with the company

  const names = new Map<number, string>();
  for (const g of await db.prepare("SELECT id, name FROM groups WHERE organization_id = ?").all(organizationId) as unknown as { id: number; name: string }[]) {
    names.set(Number(g.id), g.name);
  }
  const people = new Map((await listShareholders(db, organizationId)).map((p) => [p.id, p.name]));

  // Losses still owed from earlier years: the latest split row per group.
  const prior = await db
    .prepare(
      `SELECT DISTINCT ON (g.group_id) g.group_id, g.loss_after_toman
         FROM profit_split_groups g JOIN profit_splits s ON s.id = g.split_id
        WHERE g.organization_id = ? AND s.fiscal_year < ? ORDER BY g.group_id, s.fiscal_year DESC`
    )
    .all(organizationId, year) as unknown as { group_id: number; loss_after_toman: number }[];
  const lossBefore = new Map(prior.map((p) => [Number(p.group_id), Number(p.loss_after_toman)]));

  // Carve out the groups that have shares of their own in this year.
  const groupSets = new Map<number, ShareSet[]>();
  const groups: SplitGroupRow[] = [];
  let carvedDistributable = 0;
  for (const gid of names.keys()) {
    const sets = await shareSets(db, organizationId, gid, to);
    if (weightedShares(sets, from, to).daysCovered === 0) continue;
    groupSets.set(gid, sets);
    const profit = (direct.get(gid) ?? 0) + (allocated.get(gid) ?? 0);
    const out = settleGroup({ groupId: gid, profitToman: profit, lossBeforeToman: lossBefore.get(gid) ?? 0 });
    groups.push({ groupId: gid, name: names.get(gid)!, profitToman: profit, repaidToman: out.repaidToman, distributableToman: out.distributableToman, lossAfterToman: out.lossAfterToman });
    carvedDistributable += out.distributableToman;
  }
  const pool = total - carvedDistributable;

  const companySets = await shareSets(db, organizationId, null, to);
  const companyCovered = weightedShares(companySets, from, to).daysCovered > 0;
  const poolDistributable = pool > 0 && companyCovered ? pool : 0;
  if (pool > 0 && !companyCovered) warnings.push("سودی برای شرکا مانده که سهم کل شرکت برایش ثبت نشده؛ تقسیم نمی‌شود");
  if (total < 0) warnings.push("شرکت در این سال زیان داشته است");

  // Scopes to split: each carved group with something to give, and the company pool.
  const scopes: { groupId: number | null; amount: number; sets: ShareSet[] }[] = [
    ...groups.filter((g) => g.distributableToman > 0).map((g) => ({ groupId: g.groupId as number | null, amount: g.distributableToman, sets: groupSets.get(g.groupId)! })),
    ...(poolDistributable > 0 ? [{ groupId: null as number | null, amount: poolDistributable, sets: companySets }] : []),
  ];
  const distributable = scopes.reduce((t, s) => t + s.amount, 0);

  let reserve = 0;
  if (legalForm === "registered") {
    reserve = legalReserve(distributable, await balanceOf(db, organizationId, "3101"), await balanceOf(db, organizationId, "3104"));
  }
  const reserveParts = reserve > 0 ? allocate(reserve, scopes.map((s) => s.amount)) : scopes.map(() => 0);

  const lines: SplitLine[] = [];
  scopes.forEach((s, i) => {
    const { weights } = weightedShares(s.sets, from, to);
    const ids = [...weights.keys()];
    const parts = allocate(s.amount - reserveParts[i], ids.map((id) => weights.get(id)!));
    ids.forEach((id, k) => {
      if (parts[k] > 0) lines.push({ groupId: s.groupId, partyId: id, name: people.get(id) ?? "—", amountToman: parts[k] });
    });
  });

  const advances = new Map((await partnerBalances(db, organizationId)).map((b) => [b.partyId, b.advancesToman]));
  const parties: SplitPartyRow[] = [];
  for (const id of new Set(lines.map((l) => l.partyId))) {
    const gross = lines.filter((l) => l.partyId === id).reduce((t, l) => t + l.amountToman, 0);
    const netted = Math.min(Math.max(0, advances.get(id) ?? 0), gross);
    parties.push({ partyId: id, name: people.get(id) ?? "—", grossToman: gross, advanceNettedToman: netted, netPayableToman: gross - netted });
  }

  const done = await db.prepare("SELECT 1 AS ok FROM profit_splits WHERE organization_id = ? AND fiscal_year = ?").get(organizationId, year);
  return {
    year, from, to, legalForm,
    totalProfitToman: total,
    groups,
    poolToman: pool,
    reserveToman: reserve,
    distributedToman: distributable - reserve,
    lines,
    parties,
    warnings,
    alreadyDone: !!done,
    needsApproval: legalForm === "registered",
  };
}

/** Post a year's split. A registered company must say when the general assembly approved it. */
export async function postSplit(
  db: Db,
  input: { organizationId: number; year: number; approvedOn?: string | null; createdBy: number }
): Promise<number> {
  return await db.tx(async () => {
    const p = await previewSplit(db, input.organizationId, input.year);
    if (p.alreadyDone) throw new LedgerError("سود این سال قبلاً تقسیم شده است");
    if (p.needsApproval && !/^\d{4}-\d{2}-\d{2}$/.test(input.approvedOn ?? "")) throw new LedgerError("تاریخ تأیید مجمع را وارد کنید");
    if (p.distributedToman + p.reserveToman <= 0) throw new LedgerError("سودی برای تقسیم وجود ندارد");

    const dividends = await account("2105");
    const legs: LedgerLeg[] = [{ accountId: await account("3103"), side: "D", amountToman: p.distributedToman + p.reserveToman }];
    if (p.reserveToman > 0) legs.push({ accountId: await account("3104"), side: "C", amountToman: p.reserveToman });
    for (const l of p.lines) legs.push({ accountId: dividends, side: "C", amountToman: l.amountToman, partyId: l.partyId, groupId: l.groupId });
    const current = await account("2106");
    for (const party of p.parties) {
      if (party.advanceNettedToman <= 0) continue;
      legs.push({ accountId: dividends, side: "D", amountToman: party.advanceNettedToman, partyId: party.partyId });
      legs.push({ accountId: current, side: "C", amountToman: party.advanceNettedToman, partyId: party.partyId });
    }

    const postedAt = input.approvedOn ?? tehranTodayIso();
    const journalId = await postJournal(db, {
      organizationId: input.organizationId,
      postedAt,
      sourceType: "PROFIT_SPLIT",
      sourceId: input.year,
      createdBy: input.createdBy,
      memo: `تقسیم سود سال ${input.year}`,
      legs,
    });

    const now = new Date().toISOString();
    const splitId = Number(
      (await db
        .prepare(
          `INSERT INTO profit_splits (organization_id, fiscal_year, approved_on, journal_id, total_profit_toman, distributed_toman,
                                      reserve_toman, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(input.organizationId, input.year, input.approvedOn ?? null, journalId, p.totalProfitToman, p.distributedToman, p.reserveToman, input.createdBy, now)).lastInsertRowid
    );
    for (const l of p.lines) {
      await db
        .prepare("INSERT INTO profit_split_lines (organization_id, split_id, group_id, party_id, amount_toman) VALUES (?, ?, ?, ?, ?)")
        .run(input.organizationId, splitId, l.groupId, l.partyId, l.amountToman);
    }
    for (const g of p.groups) {
      await db
        .prepare(
          `INSERT INTO profit_split_groups (organization_id, split_id, group_id, profit_toman, repaid_toman, distributable_toman, loss_after_toman)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(input.organizationId, splitId, g.groupId, g.profitToman, g.repaidToman, g.distributableToman, g.lossAfterToman);
    }
    return splitId;
  });
}

/* ------------------------------------------------------------------ a partner's own page */

export interface MyShare {
  name: string;
  legalForm: LegalForm;
  /** Their share today: the whole company, then each group they hold a share of. */
  shares: { scope: string; percentBp: number }[];
  capitalToman: number;
  advancesToman: number;
  dividendsOwedToman: number;
  payouts: { paidOn: string; amountToman: number }[];
  history: { year: number; amountToman: number }[];
  /** What this year's split would give them on the books as they stand, not yet posted. */
  estimate: { year: number; amountToman: number } | null;
}

/** Everything one partner may see about themselves, and nothing about anyone else: every query is keyed on their party. */
export async function myShare(db: Db, organizationId: number, partyId: number, year: number): Promise<MyShare | null> {
  const me = (await listShareholders(db, organizationId)).find((s) => s.id === partyId);
  if (!me) return null;
  const today = tehranTodayIso();

  const shares: MyShare["shares"] = [];
  const scopes: { scope: string; groupId: number | null }[] = [{ scope: "کل شرکت", groupId: null }];
  for (const g of await db.prepare("SELECT id, name FROM groups WHERE organization_id = ? ORDER BY name").all(organizationId) as unknown as { id: number; name: string }[]) {
    scopes.push({ scope: `گروه ${g.name}`, groupId: Number(g.id) });
  }
  for (const s of scopes) {
    const sets = await shareSets(db, organizationId, s.groupId, today);
    const inForce = sets.filter((x) => x.validFrom <= today).at(-1);
    const bp = inForce?.shares.find((x) => x.partyId === partyId)?.percentBp ?? 0;
    if (bp > 0) shares.push({ scope: s.scope, percentBp: bp });
  }

  const payouts = await db
    .prepare(
      `SELECT j.posted_at AS "paidOn", e.amount_toman AS "amountToman"
         FROM ledger_entries e JOIN journals j ON j.id = e.journal_id
        WHERE e.organization_id = ? AND e.party_id = ? AND j.source_type = 'DIVIDEND_PAYMENT' AND e.side = 'D'
        ORDER BY j.posted_at DESC, j.id DESC LIMIT 20`
    )
    .all(organizationId, partyId) as unknown as { paidOn: string; amountToman: number }[];
  const history = await db
    .prepare(
      `SELECT s.fiscal_year AS year, SUM(l.amount_toman) AS "amountToman"
         FROM profit_split_lines l JOIN profit_splits s ON s.id = l.split_id
        WHERE l.organization_id = ? AND l.party_id = ? GROUP BY s.fiscal_year ORDER BY s.fiscal_year DESC`
    )
    .all(organizationId, partyId) as unknown as { year: number; amountToman: number }[];

  const preview = await previewSplit(db, organizationId, year);
  const mine = preview.lines.filter((l) => l.partyId === partyId).reduce((t, l) => t + l.amountToman, 0);

  return {
    name: me.name,
    legalForm: preview.legalForm,
    shares,
    capitalToman: await balanceOf(db, organizationId, "3101", partyId),
    advancesToman: 0 - (await balanceOf(db, organizationId, "2106", partyId)),
    dividendsOwedToman: await balanceOf(db, organizationId, "2105", partyId),
    payouts: payouts.map((p) => ({ paidOn: p.paidOn, amountToman: Number(p.amountToman) })),
    history: history.map((h) => ({ year: Number(h.year), amountToman: Number(h.amountToman) })),
    estimate: preview.alreadyDone ? null : { year, amountToman: mine },
  };
}
