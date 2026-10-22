import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { orgScopeId } from "@/lib/session";
import { salesDashboard, fillRateByDriver, type SalesDashboard } from "@/lib/dashboard";
import { stockPosition, type StockRow } from "@/lib/purchases";
import { allStatements, statementFor, type Statement } from "@/lib/commissionLedger";
import { allDriverStatements, type DriverStatement } from "@/lib/driverCommissionLedger";
import { allManagerStatements, managerStatementFor, type ManagerStatement } from "@/lib/managerCommissionLedger";
import { toJalali, jalaliToIsoDate } from "@/lib/jalali";
import { isOwner } from "@/lib/roles";

/* What the dashboard page and its streamed sections read, as functions of the SESSION. The page
 * and the section components used to open the database themselves (`getDb()`, then pass the
 * handle and a hand-built scope to each reader); now they call these and never see a connection,
 * so the tenant and group scope is decided in one place per figure. */

/** The stat tiles and charts at the top of /sales/dashboard. */
export function dashboardFor(session: Session): SalesDashboard {
  return salesDashboard(getDb(), session);
}

export interface MoneyFigures {
  commission: Statement[];
  driverCommission: DriverStatement[];
  managerCommission: ManagerStatement[];
}

/** This Jalali month's commission statements for «بدهی و پورسانت». A فروشنده gets only their own
 *  statement and none of the driver or manager ledgers (the reads are skipped, not just hidden);
 *  a group manager sees their group's people plus their own override; an owner sees everyone in
 *  their organisation. */
export function moneyFor(session: Session): MoneyFigures {
  const db = getDb();
  const today = toJalali(new Date().toISOString())!;
  const period = {
    from: jalaliToIsoDate(today.jy, today.jm, 1),
    to: jalaliToIsoDate(today.jy, today.jm, today.jd),
  };
  const groupId = isOwner(session.role) ? undefined : session.groupId;
  const organizationId = orgScopeId(session);

  const commission =
    session.role === "phone_sales"
      ? [statementFor(db, session.user.id, period)]
      : allStatements(db, period, { groupId, organizationId });
  const driverCommission =
    session.role === "phone_sales" ? [] : allDriverStatements(db, period, { groupId, organizationId });
  const managerCommission = isOwner(session.role)
    ? allManagerStatements(db, period, organizationId)
    : session.role === "group_manager"
      ? [managerStatementFor(db, session.user.id, period)]
      : [];
  return { commission, driverCommission, managerCommission };
}

export interface StockFigures {
  stock: StockRow[];
  drivers: { label: string; value: number }[];
}

/** Warehouse position and each driver's fill rate for «انبار و تحویل». */
export function stockFor(session: Session): StockFigures {
  const db = getDb();
  return { stock: stockPosition(db, orgScopeId(session)), drivers: fillRateByDriver(db, session) };
}
