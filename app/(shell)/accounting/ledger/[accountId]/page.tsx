import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { accountById, accountLedger } from "@/lib/repo/reports";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

/** One account, in full, with a running balance.
 *
 *  The OPENING row is the point of this page. Every other screen answers "what is the
 *  total?", which cannot tell you why the total is what it is. This one answers "what was
 *  in this account before the period, what moved, and what is it now" — which is the
 *  first question an accountant asks about any account and the one nothing in this app
 *  answered before the ledger existed.
 *
 *  A reversed posting keeps its line and is struck through, same rule as the journal. */
export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { accountId } = await params;
  const { period } = await searchParams;
  const organizationId = await requireAccounting("/accounting/trial-balance");

  const id = Number(accountId);
  // NaN and 0 must 404, not render an empty ledger for account 0 -- the trial balance
  // links here, so a hand-edited URL must not produce a plausible-looking blank statement.
  if (!Number.isInteger(id) || id <= 0) notFound();
  const account = accountById(id);
  if (!account) notFound();

  const stmt = accountLedger(organizationId, id, { periodKey: period });

  return (
    <>
      <PageHeader route="/accounting/trial-balance" />
      <SectionHead
        title={
          <>
            <span className="tnum">{account.code}</span> — {account.nameFa}
          </>
        }
        sub={
          <>
            {period ? `دورهٔ ${period}` : "همهٔ دوران"} · بسته {faNum(stmt.closingToman)} تومان
          </>
        }
        actions={
          <Link
            href="/accounting/trial-balance"
            className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-sm)]"
          >
            بازگشت به تراز آزمایشی
          </Link>
        }
      />

      <AcctTable
        head={["سند", "دوره", "تاریخ", "شرح", "بدهکار", "بستانکار", "مانده"]}
        foot={
          <tr className="bg-surface">
            <td className={CELL}>جمع</td>
            <td className={CELL} />
            <td className={CELL} />
            <td className={CELL}>بسته دوره</td>
            <td className={CELL} />
            <td className={CELL} />
            <td className={NUM}>{faNum(stmt.closingToman)}</td>
          </tr>
        }
      >
        {/* The opening balance, as its own row. Without it the first line looks like the
            account's first movement ever, which it very often is not. */}
        <tr className="bg-surface font-medium">
          <td className={CELL}>—</td>
          <td className={CELL}>—</td>
          <td className={CELL}>—</td>
          <td className={CELL}>ماندهٔ اول دوره</td>
          <td className={CELL} />
          <td className={CELL} />
          <td className={NUM}>{faNum(stmt.openingToman)}</td>
        </tr>
        {stmt.lines.map((l, i) => {
          const struck = l.reversedByJournalId !== null;
          return (
            <tr key={`${l.journalId}-${i}`} className="border-t border-border">
              <td className={`${CELL} tnum`}>#{l.seq}</td>
              <td className={`${CELL} tnum`}>{l.periodKey}</td>
              <td className={CELL}>
                <span className="tnum">{l.postedAt.slice(0, 10)}</span>
              </td>
              <td className={CELL}>
                <span className={struck ? "line-through" : ""}>{l.memo ?? l.sourceType}</span>
                {struck ? (
                  <Link
                    href="/accounting/journal"
                    className="mr-2 text-[length:var(--text-xs)] text-danger"
                  >
                    ابطال‌شده
                  </Link>
                ) : null}
              </td>
              <td className={NUM}>{l.side === "D" ? faNum(l.amountToman) : "—"}</td>
              <td className={NUM}>{l.side === "C" ? faNum(l.amountToman) : "—"}</td>
              <td className={NUM}>{faNum(l.balanceToman)}</td>
            </tr>
          );
        })}
      </AcctTable>
    </>
  );
}