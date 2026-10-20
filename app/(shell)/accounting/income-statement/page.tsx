import Link from "next/link";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM, CostIncompleteNote } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { incomeStatement, listPeriods } from "@/lib/repo/reports";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Revenue less cost of goods less expenses, for a period.
 *
 *  `costComplete` drives the banner at the top and it is NOT decoration. When false, the
 *  gross margin on this page is too generous, and a page that showed the number without
 *  saying so would be lying with a straight face — which is the one thing a financial report
 *  must not do. Better a visibly incomplete number than a confidently wrong one. */
export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const organizationId = await requireAccounting("/accounting/income-statement");
  const is = incomeStatement(organizationId, { periodKey: period });
  const periods = listPeriods(organizationId);

  const line = (label: string, value: number, opts?: { strong?: boolean }) => (
    <tr key={label} className={`border-t border-border ${opts?.strong ? "font-medium" : ""}`}>
      <td className={CELL}>{label}</td>
      <td className={NUM}>{faNum(value)}</td>
    </tr>
  );

  return (
    <>
      <PageHeader route="/accounting/income-statement" />
      <SectionHead
        title="سود و زیان"
        sub={is.periodKey ? `دورهٔ ${is.periodKey}` : "همهٔ دوران"}
        actions={
          <div className="flex flex-wrap gap-2 text-[length:var(--text-sm)]">
            <Link
              href="/accounting/income-statement"
              className="rounded-[var(--radius-sm)] border border-border px-2 py-1"
            >
              همه
            </Link>
            {periods.map((p) => (
              <Link
                key={p.periodKey}
                href={`/accounting/income-statement?period=${encodeURIComponent(p.periodKey)}`}
                className={`rounded-[var(--radius-sm)] border px-2 py-1 ${
                  period === p.periodKey ? "border-accent text-[var(--accent-text)]" : "border-border"
                }`}
              >
                {p.periodKey}
              </Link>
            ))}
          </div>
        }
      />

      {/* Honesty requirement 2, on the face of the screen. */}
      {!is.costComplete ? <CostIncompleteNote /> : null}

      <AcctTable
        head={["شرح", "تومان"]}
        foot={
          <tr className="bg-surface">
            <td className={CELL}>سود خالص</td>
            <td className={NUM}>{faNum(is.netProfitToman)}</td>
          </tr>
        }
      >
        {line("درآمد", is.revenueToman, { strong: true })}
        {line("بهای تمام‌شدهٔ کالا", -is.cogsToman)}
        {line("سود ناخالص", is.grossProfitToman, { strong: true })}
        {is.expenses.map((e) => line(`هزینه — ${e.nameFa}`, -e.amountToman))}
        {is.totalExpensesToman ? line("جمع هزینه‌ها", -is.totalExpensesToman) : null}
      </AcctTable>
    </>
  );
}