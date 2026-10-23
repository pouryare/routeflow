import { withRunningBalance } from "@/lib/runningBalance";
import { getDb } from "@/lib/db";

/**
 * The read layer for the accounting section. Every number a screen shows comes from here.
 *
 * Nothing is stored, nothing is cached, nothing is computed in the UI. That is what lets a
 * formal report be added later with no new maths — and it is why these are queries and not
 * tables: the ledger is the only source, and a second source would be a second answer.
 *
 * Three things these functions carry that a UI could not invent for itself, and must not:
 *
 *  1. **A reversal is visible.** `JournalReportRow` says whether a journal was reversed, by
 *     whom, and points at the reversing journal. One number with a hidden edit behind it is
 *     exactly what the append-only design exists to prevent.
 *  2. **Cost completeness is data, not decoration.** `costComplete` is false when any
 *     delivery in the period recognised revenue but no cost — because backfilled history has
 *     no COGS (see backfillLedger). A screen must never look more certain than the data
 *     underneath it, so the flag travels WITH the number.
 *  3. **A closed period stays readable.** Closing hides a period from POSTING, never from
 *     reading. Every report here filters on date, never on `fiscal_periods.status`.
 */

export interface PeriodStatus {
  periodKey: string;
  status: "open" | "closed";
  closedAt: string | null;
  closedByName: string | null;
}

/** Open/closed per period. Read-only: closing changes posting, never what can be seen. */
export async function listPeriods(organizationId: number): Promise<PeriodStatus[]> {
  return await getDb()
    .prepare(
      `SELECT f.period_key AS periodKey, f.status, f.closed_at AS closedAt,
              u.display_name AS closedByName
         FROM fiscal_periods f
         LEFT JOIN users u ON u.id = f.closed_by
        WHERE f.organization_id = ?
        ORDER BY f.period_key DESC`
    )
    .all(organizationId) as unknown as PeriodStatus[];
}

export interface JournalReportRow {
  journalId: number;
  seq: number;
  periodKey: string;
  postedAt: string;
  sourceType: string;
  sourceId: number | null;
  memo: string | null;
  createdByName: string | null;
  legs: { code: string; nameFa: string; side: "D" | "C"; amountToman: number }[];
  /** The journal that reverses this one, if any. Honesty requirement 1. */
  reversedByJournalId: number | null;
  /** The journal this one reverses, if it is itself a reversal. */
  reversesJournalId: number | null;
}

export interface JournalReport {
  rows: JournalReportRow[];
  /** How many journals match the filters in all, whatever this page holds. */
  total: number;
  /** Debit and credit sums over the rows RETURNED, i.e. this page. */
  totalDebit: number;
  totalCredit: number;
}

/** The journal, newest first, with reversals made explicit.
 *
 *  The reversal columns are JOINED rather than derived, because "was this corrected?" is a
 *  fact about two rows and only a query can answer it. A UI inferring it — by matching
 *  amounts, say — would be guessing, and could mark a genuine second payment as a
 *  correction. */
export async function journalReport(
  organizationId: number,
  filter?: { periodKey?: string; sourceType?: string; limit?: number; offset?: number }
): Promise<JournalReport> {
  const where: string[] = ["j.organization_id = ?"];
  const args: unknown[] = [organizationId];
  if (filter?.periodKey) {
    where.push("j.period_key = ?");
    args.push(filter.periodKey);
  }
  if (filter?.sourceType) {
    where.push("j.source_type = ?");
    args.push(filter.sourceType);
  }
  const limit = filter?.limit ?? 500;
  const offset = Math.max(0, filter?.offset ?? 0);

  const rows = await getDb()
    .prepare(
      `SELECT j.id AS journalId, j.seq, j.period_key AS periodKey, j.posted_at AS postedAt,
              j.source_type AS sourceType, j.source_id AS sourceId, j.memo,
              u.display_name AS createdByName,
              r.id AS reversedByJournalId,
              j.reverses_journal_id AS reversesJournalId
         FROM journals j
         LEFT JOIN users u ON u.id = j.created_by
         LEFT JOIN journals r ON r.reverses_journal_id = j.id
        WHERE ${where.join(" AND ")}
        ORDER BY j.seq DESC
        LIMIT ? OFFSET ?`
    )
    .all(...(args as never[]), limit, offset) as unknown as Omit<JournalReportRow, "legs">[];

  const total = Number(
    (
      await getDb()
        .prepare(`SELECT COUNT(*) AS n FROM journals j WHERE ${where.join(" AND ")}`)
        .get(...(args as never[])) as { n: number }
    ).n
  );

  // One query for every journal on the page, not one per journal.
  const legsByJournal = new Map<number, JournalReportRow["legs"]>();
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((r) => r.journalId);
    const legRows = await getDb()
      .prepare(
        `SELECT e.journal_id AS journalId, a.code, a.name_fa AS nameFa, e.side, e.amount_toman AS amountToman
           FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
          WHERE e.journal_id IN (${ids.map(() => "?").join(",")})
          ORDER BY e.journal_id, a.code, e.id`
      )
      .all(...ids) as unknown as (JournalReportRow["legs"][number] & { journalId: number })[];
    for (const { journalId, ...leg } of legRows) {
      const list = legsByJournal.get(journalId);
      if (list) list.push(leg);
      else legsByJournal.set(journalId, [leg]);
    }
  }
  let totalDebit = 0;
  let totalCredit = 0;
  const withLegs = rows.map((r) => {
    const legs = legsByJournal.get(r.journalId) ?? [];
    for (const l of legs) {
      if (l.side === "D") totalDebit += l.amountToman;
      else totalCredit += l.amountToman;
    }
    return { ...r, legs };
  });

  return { rows: withLegs, total, totalDebit, totalCredit };
}

export interface IncomeStatement {
  periodKey: string | null;
  revenueToman: number;
  cogsToman: number;
  grossProfitToman: number;
  /** `accountId` opens the account's ledger from the report. */
  expenses: { accountId: number; code: string; nameFa: string; amountToman: number }[];
  totalExpensesToman: number;
  netProfitToman: number;
  /** FALSE when any sale in the period recognised revenue with no cost alongside it.
   *  Backfilled history has no COGS, so a period that looks profitable here may not be.
   *  The screen must say so; it must not quietly use a number it invented. */
  costComplete: boolean;
}

/** Profit, for a period or for all time.
 *
 *  `costComplete` is COMPUTED, not asserted: it compares the number of SALE journals that
 *  carry a COGS leg against the number that exist. If any delivery posted revenue alone, the
 *  gross margin in this row is too flattering, and the report says so rather than letting
 *  the number imply a precision it does not have. */
export async function incomeStatement(
  organizationId: number,
  filter?: { periodKey?: string }
): Promise<IncomeStatement> {
  const db = getDb();
  const args: unknown[] = [organizationId];
  let where = "j.organization_id = ?";
  if (filter?.periodKey) {
    where += " AND j.period_key = ?";
    args.push(filter.periodKey);
  }

  const sumFor = async (code: string) =>
    (
      await db
        .prepare(
          `SELECT COALESCE(SUM(e.amount_toman), 0) AS n
             FROM ledger_entries e
             JOIN journals j ON j.id = e.journal_id
             JOIN accounts a ON a.id = e.account_id
            WHERE ${where} AND a.code = ?`
        )
        .get(...(args as never[]), code) as { n: number }
    ).n;

  const revenue = await sumFor("4101");
  const cogs = await sumFor("5101");

  /* Expenses exclude 5101 COGS: cost of goods is matched against revenue above, and
     counting it again here would subtract it twice. */
  const expenseRows = await db
    .prepare(
      `SELECT * FROM (SELECT a.id AS accountId, a.code, a.name_fa AS nameFa, COALESCE(SUM(e.amount_toman), 0) AS amountToman
         FROM ledger_entries e
         JOIN journals j ON j.id = e.journal_id
         JOIN accounts a ON a.id = e.account_id
        WHERE ${where} AND a.type = 'EXPENSE' AND a.code <> '5101'
        GROUP BY a.id) t
        WHERE amountToman <> 0
        ORDER BY code`
    )
    .all(...(args as never[])) as unknown as IncomeStatement["expenses"];

  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS sales,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM ledger_entries e2
                  JOIN accounts a2 ON a2.id = e2.account_id
                 WHERE e2.journal_id = j.id AND a2.code = '5101')) AS withCogs
         FROM journals j
        WHERE ${where} AND j.source_type = 'SALE'`
    )
    .get(...(args as never[])) as { sales: number; withCogs: number };

  const totalExpenses = expenseRows.reduce((s, r) => s + r.amountToman, 0);
  return {
    periodKey: filter?.periodKey ?? null,
    revenueToman: revenue,
    cogsToman: cogs,
    grossProfitToman: revenue - cogs,
    expenses: expenseRows,
    totalExpensesToman: totalExpenses,
    netProfitToman: revenue - cogs - totalExpenses,
    costComplete: totals.sales === totals.withCogs,
  };
}

export interface BalanceSheet {
  asAt: string;
  assets: { accountId: number; code: string; nameFa: string; amountToman: number }[];
  liabilities: { accountId: number; code: string; nameFa: string; amountToman: number }[];
  /** The derived «سود و زیان دوره» line has no account behind it, hence no `accountId`. */
  equity: { accountId?: number; code: string; nameFa: string; amountToman: number }[];
  totals: { assets: number; liabilities: number; equity: number };
  /** Assets − (liabilities + equity). A ledger that does not balance is broken, and this
   *  must be visibly 0 rather than quietly absorbed into a total. */
  difference: number;
}

/** The balance sheet AS AT a date. A balance sheet is a MOMENT, not a period — `asAt` is
 *  explicit in the result so nobody reads it as "this month's results". */
export async function balanceSheet(
  organizationId: number,
  asAt: { periodKey?: string; onDate?: string } = {}
): Promise<BalanceSheet> {
  const db = getDb();

  /* Each type nets its own normal direction: an asset's balance is debits less credits, a
     liability's the reverse. Doing it in SQL rather than by summing signed amounts keeps a
     contra account (a credit balance inside an asset) from flipping the whole side. */
  const side = async (type: string) => {
    const args: unknown[] = [organizationId, type];
    let dateClause = "";
    if (asAt.periodKey) {
      dateClause = " AND j.period_key <= ?";
      args.push(asAt.periodKey);
    } else if (asAt.onDate) {
      dateClause = " AND j.posted_at <= ?";
      args.push(asAt.onDate);
    }
    return await db
      .prepare(
        `SELECT * FROM (SELECT a.id AS accountId, a.code, a.name_fa AS nameFa,
                COALESCE(SUM(CASE
                  WHEN e.side = CASE a.normal_balance WHEN 'DEBIT' THEN 'D' ELSE 'C' END
                    THEN e.amount_toman
                  ELSE -e.amount_toman END), 0)
                  AS amountToman
           FROM ledger_entries e
           JOIN journals j ON j.id = e.journal_id
           JOIN accounts a ON a.id = e.account_id
          WHERE e.organization_id = ? AND a.type = ?${dateClause}
          GROUP BY a.id) t
        WHERE amountToman <> 0
        ORDER BY code`
      )
      .all(...(args as never[])) as unknown as BalanceSheet["assets"];
  };

  const assets = await side("ASSET");
  const liabilities = await side("LIABILITY");
  const equity = await side("EQUITY");

  /* Current-period earnings belong in EQUITY.
   *
     This is not a nicety — without it the balance sheet does not balance, and that is how I
     first wrote it. Revenue and expenses live in REVENUE/EXPENSE accounts, which a balance
     sheet does not read: a sale posts Dr AR / Cr revenue, so the asset side grows by 8,000,000
     and the credit lands in an account this function never touches. Assets − (L + E) came out
     at exactly the revenue figure.
     
     A real balance sheet closes revenue and expenses into equity at period end. This app
     does NOT post closing entries — that would be a second set of books, and the whole point
     is that the ledger is the only source. So earnings are shown DERIVED, as one equity line,
     and labelled as such. Same number, no stored duplicate, and the identity holds. */
  const earnings = await currentPeriodEarnings(organizationId, asAt);
  const equityRows: BalanceSheet["equity"] =
    earnings.amountToman !== 0
      ? [
          ...equity,
          { code: "3900", nameFa: "سود و زیان دوره", amountToman: earnings.amountToman },
        ]
      : equity;

  const sum = (rows: { amountToman: number }[]) => rows.reduce((s, r) => s + r.amountToman, 0);
  const t = {
    assets: sum(assets),
    liabilities: sum(liabilities),
    equity: sum(equityRows),
  };

  return {
    asAt: asAt.periodKey ?? asAt.onDate ?? "همهٔ دوران",
    assets,
    liabilities,
    equity: equityRows,
    totals: t,
    difference: t.assets - (t.liabilities + t.equity),
  };
}

/** Revenue less cost of goods less expenses, over the same window the balance sheet covers.
 *  A LOSS is returned negative and appears as a negative equity line, which is what a
 *  balance sheet does — it does not hide a loss by flipping it to the other side. */
async function currentPeriodEarnings(
  organizationId: number,
  asAt: { periodKey?: string; onDate?: string }
): Promise<{ amountToman: number }> {
  const db = getDb();
  const args: unknown[] = [organizationId];
  let dateClause = "";
  if (asAt.periodKey) {
    dateClause = " AND j.period_key <= ?";
    args.push(asAt.periodKey);
  } else if (asAt.onDate) {
    dateClause = " AND j.posted_at <= ?";
    args.push(asAt.onDate);
  }
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(
                CASE WHEN a.type = 'REVENUE' AND e.side = 'C' THEN e.amount_toman
                     WHEN a.type = 'REVENUE' AND e.side = 'D' THEN -e.amount_toman
                     WHEN a.type = 'EXPENSE' AND e.side = 'D' THEN -e.amount_toman
                     WHEN a.type = 'EXPENSE' AND e.side = 'C' THEN e.amount_toman
                     ELSE 0 END), 0) AS n
         FROM ledger_entries e
         JOIN journals j ON j.id = e.journal_id
         JOIN accounts a ON a.id = e.account_id
        WHERE e.organization_id = ?${dateClause}`
    )
    .get(...(args as never[])) as { n: number };
  return { amountToman: row.n };
}

export interface AgedPayableRow {
  supplierId: number;
  supplierName: string;
  /** Positive = we owe them. */
  balanceToman: number;
}

/** What we owe each supplier, DERIVED from the ledger — never a stored number, so it cannot
 *  drift from the trial balance. Mirrors the receivable ageing the dashboard already has. */
export async function agedPayables(organizationId: number): Promise<AgedPayableRow[]> {
  return await getDb()
    .prepare(
      `SELECT * FROM (SELECT s.id AS supplierId, s.name AS supplierName,
              COALESCE(SUM(CASE WHEN e.side = 'C' THEN e.amount_toman
                                WHEN e.side = 'D' THEN -e.amount_toman ELSE 0 END), 0)
                AS balanceToman
         FROM ledger_entries e
         JOIN accounts a ON a.id = e.account_id
         JOIN suppliers s ON s.id = e.supplier_id
        WHERE e.organization_id = ? AND a.code = '2101'
        GROUP BY s.id
       ) t
        WHERE balanceToman <> 0
        ORDER BY balanceToman DESC`
    )
    .all(organizationId) as unknown as AgedPayableRow[];
}

export interface SupplierStatementLine {
  journalId: number;
  seq: number;
  periodKey: string;
  postedAt: string;
  sourceType: string;
  memo: string | null;
  code: string;
  nameFa: string;
  side: "D" | "C";
  amountToman: number;
}

/** Every movement on one supplier's account — both legs, so a credit balance reads as
 *  distinct from no balance at all rather than as an absence. */
export async function supplierStatement(
  organizationId: number,
  supplierId: number
): Promise<SupplierStatementLine[]> {
  return await getDb()
    .prepare(
      `SELECT j.id AS journalId, j.seq, j.period_key AS periodKey, j.posted_at AS postedAt,
              j.source_type AS sourceType, j.memo,
              a.code, a.name_fa AS nameFa, e.side, e.amount_toman AS amountToman
         FROM ledger_entries e
         JOIN journals j ON j.id = e.journal_id
         JOIN accounts a ON a.id = e.account_id
        WHERE e.organization_id = ? AND e.supplier_id = ? AND a.code IN ('2101','1301')
        ORDER BY j.seq`
    )
    .all(organizationId, supplierId) as unknown as SupplierStatementLine[];
}

/** Expenses by category, for the expenses report. */
export async function expensesByCategory(organizationId: number, filter?: { periodKey?: string }) {
  const args: unknown[] = [organizationId];
  let extra = "";
  if (filter?.periodKey) {
    extra = " AND j.period_key = ?";
    args.push(filter.periodKey);
  }
  return await getDb()
    .prepare(
      `SELECT * FROM (SELECT a.code, a.name_fa AS nameFa,
              COALESCE(SUM(e.amount_toman), 0) AS amountToman
         FROM ledger_entries e
         JOIN journals j ON j.id = e.journal_id
         JOIN accounts a ON a.id = e.account_id
        WHERE e.organization_id = ? AND a.type = 'EXPENSE' AND a.code <> '5101'${extra}
        GROUP BY a.id) t
        WHERE amountToman <> 0
        ORDER BY amountToman DESC`
    )
    .all(...(args as never[]));
}

/** Who entered what. Accountability, not a second set of books: a group_manager may enter
 *  expenses, so the report names them rather than silently pooling the money. */
export async function expensesByEnterer(organizationId: number) {
  return await getDb()
    .prepare(
      `SELECT u.display_name AS displayName, COUNT(*) AS entries,
              COALESCE(SUM(e.amount_toman), 0) AS amountToman
         FROM ledger_entries e
         JOIN journals j ON j.id = e.journal_id
         JOIN accounts a ON a.id = e.account_id
         LEFT JOIN users u ON u.id = j.created_by
        WHERE e.organization_id = ? AND a.type = 'EXPENSE' AND a.code <> '5101'
        GROUP BY j.created_by ORDER BY amountToman DESC`
    )
    .all(organizationId);
}

/** One posting in an account's statement, plus the running balance after it. */
export interface AccountLedgerLine {
  journalId: number;
  seq: number;
  periodKey: string;
  postedAt: string;
  sourceType: string;
  memo: string | null;
  side: "D" | "C";
  amountToman: number;
  reversedByJournalId: number | null;
  balanceToman: number;
}

/** One account's statement, with a running balance and a period-OPENING figure.
 *  The opening answers "what was in this account before this period?" — the first thing an
 *  accountant asks, and something nothing in this app answered before. */
export async function accountLedger(
  organizationId: number,
  accountId: number,
  filter?: { periodKey?: string; limit?: number; offset?: number }
) {
  const db = getDb();
  /* With no period filter there IS no opening: every posting is in scope, so an opening
     figure would count the same movements a second time. I originally computed it anyway,
     and an unfiltered statement read opening 800,000 / closing -800,000. Opening is a
     question about a period; with no period, the answer is none. */
  const openingToman = filter?.periodKey
    ? ((
        await db
          .prepare(
            `SELECT COALESCE(SUM(CASE WHEN e.side = CASE a.normal_balance WHEN 'DEBIT' THEN 'D' ELSE 'C' END
                                      THEN e.amount_toman ELSE -e.amount_toman END), 0) AS n
               FROM ledger_entries e
               JOIN journals j ON j.id = e.journal_id
               JOIN accounts a ON a.id = e.account_id
              WHERE e.organization_id = ? AND e.account_id = ?
                AND j.period_key < ?`
          )
          .get(organizationId, accountId, filter.periodKey) as { n: number }
      ).n)
    : 0;

  const args: unknown[] = [organizationId, accountId];
  let extra = "";
  if (filter?.periodKey) {
    extra = " AND j.period_key = ?";
    args.push(filter.periodKey);
  }
  const rows = await db
    .prepare(
      `SELECT j.id AS journalId, j.seq, j.period_key AS periodKey, j.posted_at AS postedAt,
              j.source_type AS sourceType, j.memo, e.side, e.amount_toman AS amountToman,
              r.id AS reversedByJournalId
         FROM ledger_entries e
         JOIN journals j ON j.id = e.journal_id
         LEFT JOIN journals r ON r.reverses_journal_id = j.id
        WHERE e.organization_id = ? AND e.account_id = ?${extra}
        ORDER BY j.seq`
    )
    .all(...(args as never[]));

  // The running balance is walked over EVERY row so a later page opens where the one before
  // it closed; only the slice that gets rendered is cut. No limit means no cut (print, export).
  const { lines: all, closingToman } = withRunningBalance(rows as unknown as AccountLedgerLine[], "D", openingToman);
  const offset = Math.max(0, filter?.offset ?? 0);
  const lines = filter?.limit === undefined ? all : all.slice(offset, offset + filter.limit);
  return { openingToman, lines, totalLines: all.length, closingToman };
}

export async function accountById(accountId: number): Promise<{
  id: number;
  code: string;
  nameFa: string;
  type: string;
} | undefined> {
  return await getDb()
    .prepare("SELECT id, code, name_fa AS nameFa, type FROM accounts WHERE id = ?")
    .get(accountId) as { id: number; code: string; nameFa: string; type: string } | undefined;
}

/** The chart, for the account picker. Global by design — see the schema comment. */
export async function postableAccounts(): Promise<{ id: number; code: string; nameFa: string; type: string }[]> {
  return await getDb()
    .prepare(
      `SELECT id, code, name_fa AS nameFa, type FROM accounts
        WHERE is_postable = 1 AND active = 1 ORDER BY code`
    )
    .all() as unknown as { id: number; code: string; nameFa: string; type: string }[];
}

