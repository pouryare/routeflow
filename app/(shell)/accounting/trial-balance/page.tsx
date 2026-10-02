import Link from "next/link";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM, UnbalancedBanner } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { trialBalance } from "@/lib/repo/ledger";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

/** The trial balance: the one screen whose entire claim is that two columns are equal.
 *
 *  Every number is a GROUP BY over ledger_entries. Nothing here is stored, so the
 *  statement cannot drift from the ledger that produced it — and it is the cheapest way to
 *  ask "are the books even sound?" before reading anything else on them. */
export default async function TrialBalancePage() {
  const organizationId = await requireAccounting("/accounting/trial-balance");
  const tb = trialBalance(organizationId);
  const balanced = tb.totalDebit === tb.totalCredit;

  return (
    <>
      <PageHeader route="/accounting/trial-balance" />
      <SectionHead
        title="تراز آزمایشی"
        sub={
          balanced
            ? "دو ستون برابرند؛ دفتر سالم است."
            : "دو ستون برابر نیستند."
        }
      />
      {/* Should be impossible. Surfaced rather than summed away. */}
      <UnbalancedBanner difference={tb.totalDebit - tb.totalCredit} />

      <AcctTable
        head={["کد حساب", "نام حساب", "نوع", "بدهکار", "بستانکار", "مانده"]}
        foot={
          <tr className="bg-surface">
            <td className={CELL}>جمع کل</td>
            <td className={CELL} />
            <td className={CELL} />
            <td className={NUM}>{faNum(tb.totalDebit)}</td>
            <td className={NUM}>{faNum(tb.totalCredit)}</td>
            <td className={NUM}>
              {faNum(tb.totalDebit - tb.totalCredit)}
            </td>
          </tr>
        }
      >
        {tb.rows.map((r) => (
          <tr key={r.accountId} className="border-t border-border">
            <td className={CELL}>
              {/* The code is the drill-down: each account opens its own ledger. */}
              <Link
                href={`/accounting/ledger/${r.accountId}`}
                className="tnum text-accent hover:underline"
              >
                {r.code}
              </Link>
            </td>
            <td className={CELL}>{r.nameFa}</td>
            <td className={CELL}>{r.type}</td>
            <td className={NUM}>{r.debit ? faNum(r.debit) : "—"}</td>
            <td className={NUM}>{r.credit ? faNum(r.credit) : "—"}</td>
            <td className={NUM}>{r.balance ? faNum(r.balance) : "—"}</td>
          </tr>
        ))}
      </AcctTable>
    </>
  );
}