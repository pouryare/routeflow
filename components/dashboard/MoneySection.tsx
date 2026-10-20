import type { Session } from "@/lib/session";
import { yieldToEventLoop } from "@/lib/yieldToEventLoop";
import { getDb } from "@/lib/db";
import { allStatements, statementFor } from "@/lib/commissionLedger";
import { allDriverStatements } from "@/lib/driverCommissionLedger";
import { allManagerStatements, managerStatementFor } from "@/lib/managerCommissionLedger";
import { faToman } from "@/lib/format";
import { toJalali, jalaliToIsoDate } from "@/lib/jalali";
import { isOwner } from "@/lib/roles";
import BarChart from "@/components/charts/BarChart";
import DonutChart from "@/components/charts/DonutChart";
import CollapsibleSection from "@/components/CollapsibleSection";
import { compactToman, EMPTY_CHART } from "@/components/dashboard/format";

const empty = EMPTY_CHART;

/** «بدهی و پورسانت» -- debt ageing and the three commission ledgers.
 *
 *  The commission statements walk every order a person ever sold (owed is lifetime), which
 *  makes this the heaviest block on the page, so it streams in behind its own Suspense
 *  boundary instead of holding the stat tiles back. A فروشنده reads only their own statement
 *  and none of the driver or manager ledgers: the reads are skipped, not just hidden. */

export default async function MoneySection({ session, debt }: { session: Session; debt: { d0_7: number; d8_30: number; over_30: number } }) {
  await yieldToEventLoop();
  const db = getDb();
  const today = toJalali(new Date().toISOString())!;
  const period = {
    from: jalaliToIsoDate(today.jy, today.jm, 1),
    to: jalaliToIsoDate(today.jy, today.jm, today.jd),
  };
  const groupId = isOwner(session.role) ? undefined : session.groupId;

  const commission =
    session.role === "phone_sales"
      ? [statementFor(db, session.user.id, period)]
      : allStatements(db, period, { groupId });
  // A فروشنده sees none of this -- someone else's earnings, driver or manager, are
  // none of their business, the same boundary /sales/commission itself draws.
  const driverCommission = session.role === "phone_sales" ? [] : allDriverStatements(db, period, { groupId });
  const managerCommission =
    isOwner(session.role)
      ? allManagerStatements(db, period)
      : session.role === "group_manager"
        ? [managerStatementFor(db, session.user.id, period)]
        : [];
  const owedTotal =
    commission.reduce((sum, c) => sum + c.owed_toman, 0) +
    driverCommission.reduce((sum, c) => sum + c.owed_toman, 0) +
    managerCommission.reduce((sum, c) => sum + c.owed_toman, 0);

  return (
      <CollapsibleSection title="بدهی و پورسانت" icon="wallet" storageKey="dash-money">
        <p className="m-0 mb-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
          مانده کل پورسانت -- فروشنده، راننده و مدیر گروه با هم -- {faToman(owedTotal)}.
        </p>
        <div className="grid gap-[var(--space-4)] md:grid-cols-2">
          <DonutChart
            title="سن بدهی"
            data={[
              { label: "۰ تا ۷ روز", value: debt.d0_7, color: "var(--good)" },
              { label: "۸ تا ۳۰ روز", value: debt.d8_30, color: "var(--warn)" },
              { label: "بالای ۳۰ روز", value: debt.over_30, color: "var(--crit)" },
            ]}
            formatValue={faToman}
            centreLabel="تومان"
            empty={empty}
          />
          <BarChart
            title="پورسانت فروشنده‌ها"
            barLabel={compactToman}
            subtitle={`مانده ${faToman(commission.reduce((sum, c) => sum + c.owed_toman, 0))}`}
            data={commission.map((c) => ({ label: c.display_name, value: c.accrued_toman }))}
            formatValue={faToman}
            colorful
            empty={empty}
          />
          {driverCommission.length > 0 && (
            <BarChart
              title="پورسانت راننده‌ها"
              barLabel={compactToman}
              subtitle={`مانده ${faToman(driverCommission.reduce((sum, c) => sum + c.owed_toman, 0))}`}
              data={driverCommission.map((c) => ({ label: c.display_name, value: c.accrued_toman }))}
              formatValue={faToman}
              colorful
              empty={empty}
            />
          )}
          {managerCommission.length > 0 && (
            <BarChart
              title="پورسانت مدیران گروه"
              barLabel={compactToman}
              subtitle={`مانده ${faToman(managerCommission.reduce((sum, c) => sum + c.owed_toman, 0))}`}
              data={managerCommission.map((c) => ({ label: c.display_name, value: c.accrued_toman }))}
              formatValue={faToman}
              colorful
              empty={empty}
            />
          )}
        </div>
      </CollapsibleSection>
  );
}
