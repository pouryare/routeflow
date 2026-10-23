import Link from "next/link";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { agedPayables } from "@/lib/repo/reports";
import { listSuppliers } from "@/lib/repo/suppliers";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Every supplier, each with the balance DERIVED from the ledger.
 *
 *  Unlike /payables, this list does not drop the ones at zero: a supplier you have paid
 *  off is still a supplier, and the page is for finding one to pay, not for chasing what is
 *  outstanding. The zero comes from the same SUM as everywhere else, so it cannot disagree
 *  with the trial balance. */
export default async function SuppliersPage() {
  const organizationId = await requireAccounting("/accounting/suppliers");
  const suppliers = await listSuppliers(organizationId);
  const owed = new Map((await agedPayables(organizationId)).map((r) => [r.supplierId, r.balanceToman]));

  return (
    <>
      <PageHeader route="/accounting/suppliers" />
      <SectionHead
        title="تأمین‌کنندگان"
        sub={`${faNum(suppliers.length)} تأمین‌کننده`}
      />
      <AcctTable head={["تأمین‌کننده", "تلفن", "مانده"]}>
        {suppliers.map((s) => {
          const bal = owed.get(s.id) ?? 0;
          return (
            <tr key={s.id} className="border-t border-border">
              <td className={CELL}>
                <Link href={`/accounting/suppliers/${s.id}`} className="text-[var(--accent-text)] hover:underline">
                  {s.name}
                </Link>
              </td>
              <td className={`${CELL} tnum`}>{s.phone ?? "—"}</td>
              <td className={NUM}>{bal ? faNum(bal) : "—"}</td>
            </tr>
          );
        })}
      </AcctTable>
    </>
  );
}