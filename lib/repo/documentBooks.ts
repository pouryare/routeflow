import { getDb } from "@/lib/db";

/** B3: which document the books are asked about. `expense` is the expense's own journal id. */
export type BooksDoc = "order" | "payment" | "cheque" | "expense";
export const BOOKS_DOCS: readonly BooksDoc[] = ["order", "payment", "cheque", "expense"];

interface BooksLeg {
  accountId: number;
  code: string;
  nameFa: string;
  side: "D" | "C";
  amountToman: number;
}
export interface BooksJournal {
  journalId: number;
  postedAt: string;
  sourceType: string;
  memo: string | null;
  /** This journal undoes another one (a voided payment, a corrected delivery). */
  reverses: number | null;
  legs: BooksLeg[];
}

/** The journals the document made, and any that reverse them. Company-scoped: another company's
 *  id reads as nothing. */
function journalIdsSql(doc: BooksDoc): string {
  switch (doc) {
    case "order":
      return `SELECT id FROM journals WHERE organization_id = ? AND source_type = 'SALE'
                AND source_id IN (SELECT ds.id FROM delivery_stops ds WHERE ds.order_id = ?)`;
    case "payment":
      return "SELECT id FROM journals WHERE organization_id = ? AND source_type IN ('PAYMENT', 'REVERSAL') AND source_id = ?";
    case "cheque":
      return `SELECT id FROM journals WHERE organization_id = ? AND source_type IN ('PAYMENT', 'REVERSAL')
                AND source_id IN (SELECT p.id FROM payments p WHERE p.cheque_id = ?)`;
    case "expense":
      return "SELECT id FROM journals WHERE organization_id = ? AND source_type = 'EXPENSE' AND id = ?";
  }
}

export async function booksFor(organizationId: number, doc: BooksDoc, id: number): Promise<BooksJournal[]> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `WITH base AS (${journalIdsSql(doc)}),
            js AS (SELECT id FROM base UNION SELECT j.id FROM journals j WHERE j.organization_id = ? AND j.reverses_journal_id IN (SELECT id FROM base))
       SELECT j.id AS journal_id, j.posted_at, j.source_type, j.memo, j.reverses_journal_id,
              a.id AS account_id, a.code, a.name_fa, e.side, e.amount_toman
         FROM journals j
         JOIN js ON js.id = j.id
         JOIN ledger_entries e ON e.journal_id = j.id
         JOIN accounts a ON a.id = e.account_id
        ORDER BY j.posted_at, j.id, e.side DESC, e.id`
    )
    .all(organizationId, id, organizationId)) as {
    journal_id: number; posted_at: string; source_type: string; memo: string | null; reverses_journal_id: number | null;
    account_id: number; code: string; name_fa: string; side: "D" | "C"; amount_toman: number;
  }[];
  const out = new Map<number, BooksJournal>();
  for (const r of rows) {
    const jid = Number(r.journal_id);
    let j = out.get(jid);
    if (!j) {
      j = { journalId: jid, postedAt: r.posted_at, sourceType: r.source_type, memo: r.memo, reverses: r.reverses_journal_id === null ? null : Number(r.reverses_journal_id), legs: [] };
      out.set(jid, j);
    }
    j.legs.push({ accountId: Number(r.account_id), code: r.code, nameFa: r.name_fa, side: r.side, amountToman: Number(r.amount_toman) });
  }
  return [...out.values()];
}
