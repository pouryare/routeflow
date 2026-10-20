import { withRunningBalance } from "@/lib/runningBalance";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { supplierStatement } from "@/lib/repo/reports";
import { getDb } from "@/lib/db";
import { getSupplier } from "@/lib/repo/suppliers";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

/** One supplier's statement: every movement on their account, with a running balance.
 *
 *  Reads both legs — 2101 (what we owe) and 1301 (what we prepaid) — because a supplier
 *  we hold a credit balance with is not the same as one we owe nothing to, and printing
 *  only the payable would show the second as a stranger. The running balance is what
 *  reconciles the two. */
export default async function SupplierStatementPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  const organizationId = await requireAccounting("/accounting/suppliers");

  const id = Number(supplierId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const supplier = getSupplier(getDb(), organizationId, id);
  if (!supplier) notFound();

  const rows = supplierStatement(organizationId, id);

  const { lines, closingToman: running } = withRunningBalance(rows, "C");

  return (
    <>
      <PageHeader route="/accounting/suppliers" />
      <SectionHead
        title={supplier.name}
        sub={
          <>
            مانده {faNum(running)} تومان{lines.length ? "" : " — هنوز گردشی ندارد"}
          </>
        }
        actions={
          <Link
            href="/accounting/suppliers"
            className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-sm)]"
          >
            بازگشت به تأمین‌کنندگان
          </Link>
        }
      />

      <AcctTable
        head={["سند", "تاریخ", "شرح", "حساب", "بدهکار", "بستانکار", "مانده"]}
        foot={
          <tr className="bg-surface">
            <td className={CELL}>جمع</td>
            <td className={CELL} />
            <td className={CELL} />
            <td className={CELL} />
            <td className={CELL} />
            <td className={CELL} />
            <td className={NUM}>{faNum(running)}</td>
          </tr>
        }
      >
        {lines.map((r) => (
          <tr key={`${r.journalId}-${r.code}-${r.side}`} className="border-t border-border">
            <td className={`${CELL} tnum`}>#{r.seq}</td>
            <td className={CELL}>
              <span className="tnum">{r.postedAt.slice(0, 10)}</span>
            </td>
            <td className={CELL}>{r.memo ?? r.sourceType}</td>
            <td className={CELL}>
              <span className="tnum">{r.code}</span> {r.nameFa}
            </td>
            <td className={NUM}>{r.side === "D" ? faNum(r.amountToman) : "—"}</td>
            <td className={NUM}>{r.side === "C" ? faNum(r.amountToman) : "—"}</td>
            <td className={NUM}>{faNum(r.balanceToman)}</td>
          </tr>
        ))}
      </AcctTable>
    </>
  );
}