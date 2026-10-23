import Link from "next/link";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { agedPayables } from "@/lib/repo/reports";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

/** What the organisation owes, per supplier.
 *
 *  Every figure is `SUM`med out of account 2101 at read time. There is deliberately no
 *  `balance_toman` column on `suppliers`: a stored balance is a second answer, it drifts
 *  from the ledger the moment a payment is posted twice or a purchase is reversed, and
 *  then the balance sheet and the payables list disagree — which is the one thing the
 *  trial balance exists to rule out.
 *
 *  A supplier whose balance nets to zero is GONE from this list, not shown at zero: they
 *  are not a payable any more, and a list of every supplier ever with a column of zeroes
 *  buries the two who actually owe you money. */
export default async function PayablesPage() {
  const organizationId = await requireAccounting("/accounting/payables");
  const rows = agedPayables(organizationId);
  const total = rows.reduce((s, r) => s + r.balanceToman, 0);

  return (
    <>
      <PageHeader route="/accounting/payables" />
      <SectionHead
        title="بدهی تأمین‌کنندگان"
        sub={
          rows.length
            ? `${faNum(rows.length)} تأمین‌کننده، جمعاً ${faNum(total)} تومان`
            : "هیچ بدهی‌ای ثبت نشده است."
        }
      />
      <AcctTable
        head={["تأمین‌کننده", "مانده"]}
        foot={
          <tr className="bg-surface">
            <td className={CELL}>جمع</td>
            <td className={NUM}>{faNum(total)}</td>
          </tr>
        }
      >
        {rows.map((r) => (
          <tr key={r.supplierId} className="border-t border-border">
            <td className={CELL}>
              <Link href={`/accounting/suppliers/${r.supplierId}`} className="text-[var(--accent-text)] hover:underline">
                {r.supplierName}
              </Link>
            </td>
            <td className={NUM}>{faNum(r.balanceToman)}</td>
          </tr>
        ))}
      </AcctTable>
    </>
  );
}