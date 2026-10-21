import { tehranTodayIso } from "@/lib/jalali";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { statementFor, allStatements, readRates } from "@/lib/commissionLedger";
import { allDriverStatements, readDriverRates } from "@/lib/driverCommissionLedger";
import {
  allManagerStatements,
  managerStatementFor,
  readManagerOverrides,
} from "@/lib/managerCommissionLedger";
import { MANAGE_ROLES, isOwner } from "@/lib/roles";


/** Who may see whose commission.
 *
 *  A فروشنده sees their own statement and nobody else's -- somebody else's earnings are
 *  the clearest example of data that is inside your own group and still none of your
 *  business. A manager sees the people (and drivers) in their group, plus their own
 *  override statement. The owner sees everyone, in every ledger.
 */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const url = new URL(req.url);
  const period = {
    from: url.searchParams.get("from") ?? `${new Date().getFullYear()}-01-01`,
    to: url.searchParams.get("to") ?? tehranTodayIso(),
  };

  const db = getDb();

  if (session.role === "phone_sales") {
    return NextResponse.json({
      ok: true,
      statements: [statementFor(db, session.user.id, period)],
      driver_statements: [],
      manager_statements: [],
      rates: [],
      driver_rates: [],
      manager_overrides: [],
    });
  }

  const groupId = isOwner(session.role) ? undefined : session.groupId;
  const statements = allStatements(db, period, { groupId });
  const driverStatements = allDriverStatements(db, period, { groupId });
  // A manager's own override statement, or every manager's for the owner -- a manager
  // does not see another manager's override, the same "own group only" boundary their
  // فروشنده statements already draw.
  const managerStatements =
    isOwner(session.role)
      ? allManagerStatements(db, period)
      : session.role === "group_manager"
        ? [managerStatementFor(db, session.user.id, period)]
        : [];

  // Rates and overrides are payroll policy, so only the owner reads the tables behind
  // the figures -- same rule the original فروشنده rates already followed.
  return NextResponse.json({
    ok: true,
    statements,
    driver_statements: driverStatements,
    manager_statements: managerStatements,
    rates: isOwner(session.role) ? readRates(db, session.organizationId) : [],
    driver_rates: isOwner(session.role) ? readDriverRates(db, session.organizationId) : [],
    manager_overrides: isOwner(session.role) ? readManagerOverrides(db, session.organizationId) : [],
  });
}
