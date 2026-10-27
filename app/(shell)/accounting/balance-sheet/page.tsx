import Link from "next/link";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM, UnbalancedBanner } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { balanceSheet } from "@/lib/repo/reports";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Assets against liabilities and equity, AS AT a moment.
 *
 *  `asAt` defaults to all-time, which is right for a shop with no accounting periods yet,
 *  and the label says «همهٔ دوران» rather than pretending it is a month. The identity is
 *  shown rather than asserted: A − (L + E) is rendered on the page, so a broken ledger is
 *  visible to whoever is looking instead of sitting in a field nobody opens. */
export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asAt?: string }>;
}) {
  const { asAt } = await searchParams;
  const organizationId = await requireAccounting("/accounting/balance-sheet");
  const bs = await balanceSheet(organizationId, asAt ? { periodKey: asAt } : {});

  const side = (
    rows: { accountId?: number; code: string; nameFa: string; amountToman: number }[]
  ) =>
    rows.map((r) => (
      <tr key={r.code} className="border-t border-border">
        <td className={`${CELL} tnum`}>{r.code}</td>
        <td className={CELL}>
          {/* Each account opens its ledger; the derived earnings line has no account to open. */}
          {r.accountId ? (
            <Link href={`/accounting/ledger/${r.accountId}`} className="text-[var(--accent-text)] hover:underline">
              {r.nameFa}
            </Link>
          ) : (
            r.nameFa
          )}
        </td>
        <td className={NUM}>{faNum(r.amountToman)}</td>
      </tr>
    ));

  return (
    <>
      <PageHeader route="/accounting/balance-sheet" />
      <SectionHead
        title="ترازنامه"
        sub={`در پایان: ${bs.asAt}`}
        actions={
          <span className="text-[length:var(--text-sm)] text-text-muted">
            همهٔ ارقام از دفتر خوانده می‌شوند
          </span>
        }
      />
      <UnbalancedBanner difference={bs.difference} />

      <div className="grid gap-4 md:grid-cols-3">
        <section>
          <SectionHead title={"دارایی"} as="h3" />
          <AcctTable
            compact
            head={["کد", "نام", "مانده"]}
            foot={
              <tr className="bg-surface">
                <td className={CELL}>جمع دارایی</td>
                <td className={CELL} />
                <td className={NUM}>{faNum(bs.totals.assets)}</td>
              </tr>
            }
          >
            {side(bs.assets)}
          </AcctTable>
        </section>

        <section>
          <SectionHead title={"بدهی"} as="h3" />
          <AcctTable
            compact
            head={["کد", "نام", "مانده"]}
            foot={
              <tr className="bg-surface">
                <td className={CELL}>جمع بدهی</td>
                <td className={CELL} />
                <td className={NUM}>{faNum(bs.totals.liabilities)}</td>
              </tr>
            }
          >
            {side(bs.liabilities)}
          </AcctTable>
        </section>

        <section>
          <SectionHead title={"سرمایه"} as="h3" />
          <AcctTable
            compact
            head={["کد", "نام", "مانده"]}
            foot={
              <tr className="bg-surface">
                <td className={CELL}>جمع سرمایه</td>
                <td className={CELL} />
                <td className={NUM}>{faNum(bs.totals.equity)}</td>
              </tr>
            }
          >
            {side(bs.equity)}
          </AcctTable>
        </section>
      </div>

      {/* The identity, in full, in the open. */}
      <SectionHead help="card.balance-check" title="بررسی تراز" as="h3" className="mt-6" />
      <AcctTable
            compact
        head={["شرح", "مبلغ"]}
        foot={
          <tr className="bg-surface">
            <td className={CELL}>اختلاف</td>
            <td className={NUM}>{faNum(bs.difference)}</td>
          </tr>
        }
      >
        <tr>
          <td className={CELL}>دارایی</td>
          <td className={NUM}>{faNum(bs.totals.assets)}</td>
        </tr>
        <tr className="border-t border-border">
          <td className={CELL}>بدهی + سرمایه</td>
          <td className={NUM}>{faNum(bs.totals.liabilities + bs.totals.equity)}</td>
        </tr>
      </AcctTable>
    </>
  );
}