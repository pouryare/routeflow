import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { expensesByCategory, expensesByEnterer } from "@/lib/repo/reports";
import { faNum } from "@/lib/format";
import ExpenseEntry from "@/components/flows/ExpenseEntry";
import { expenseCategories } from "@/lib/repo/ledgerPostings";
import { listSuppliers } from "@/lib/repo/suppliers";

export const dynamic = "force-dynamic";

/** Expenses, two ways: by what they were spent on, and by who entered them.
 *
 *  COGS (5101) is excluded everywhere here. It is matched against revenue in the income
 *  statement, and counting it again as an expense would subtract the cost of the goods a
 *  second time — which is the arithmetic behind a plausible-looking loss.
 *
 *  The second table exists because a group_manager can enter expenses: the money is
 *  pooled, so without naming the entrant nobody can answer "who spent this?". That is
 *  accountability, not a second set of books — the amounts are the same sums. */
export default async function ExpensesPage() {
  const organizationId = await requireAccounting("/accounting/expenses");
  const byCategory = await expensesByCategory(organizationId) as {
    code: string;
    nameFa: string;
    amountToman: number;
  }[];
  const byEnterer = await expensesByEnterer(organizationId) as {
    displayName: string | null;
    entries: number;
    amountToman: number;
  }[];

  /* Plain objects: rows straight from the database have a null prototype, which React refuses to
     pass from a server component to a client one. */
  const categories = (await expenseCategories()).map((c) => ({ id: c.id, nameFa: c.nameFa }));
  const suppliers = (await listSuppliers(organizationId)).map((x) => x.name);

  const total = byCategory.reduce((s, r) => s + r.amountToman, 0);

  return (
    <>
      <PageHeader route="/accounting/expenses" />
      <SectionHead
        title="هزینه‌ها"
        sub={
          total
            ? `جمع ${faNum(total)} تومان، بدون بهای تمام‌شدهٔ کالا`
            : "هنوز هزینه‌ای ثبت نشده است."
        }
      />

      <div className="mb-4 flex">
        <ExpenseEntry categories={categories} suppliers={suppliers} />
      </div>

      <section className="mb-6">
        <SectionHead title="بر اساس حساب" as="h3" />
        <AcctTable
          head={["کد", "حساب", "مبلغ"]}
          foot={
            <tr className="bg-surface">
              <td className={CELL}>جمع</td>
              <td className={CELL} />
              <td className={NUM}>{faNum(total)}</td>
            </tr>
          }
        >
          {byCategory.map((r) => (
            <tr key={r.code} className="border-t border-border">
              <td className={`${CELL} tnum`}>{r.code}</td>
              <td className={CELL}>{r.nameFa}</td>
              <td className={NUM}>{faNum(r.amountToman)}</td>
            </tr>
          ))}
        </AcctTable>
      </section>

      <section>
        <SectionHead
          title="بر اساس ثبت‌کننده"
          as="h3"
          sub="هزینه‌ها نقدی یکی‌اند؛ این جدول می‌گوید چه کسی آن‌ها را ثبت کرده است."
        />
        <AcctTable head={["ثبت‌کننده", "تعداد سند", "مبلغ"]}>
          {byEnterer.map((r) => (
            <tr key={r.displayName ?? "—"} className="border-t border-border">
              <td className={CELL}>{r.displayName ?? "نامشخص"}</td>
              <td className={NUM}>{faNum(r.entries)}</td>
              <td className={NUM}>{faNum(r.amountToman)}</td>
            </tr>
          ))}
        </AcctTable>
      </section>
    </>
  );
}