import { tehranTodayIso } from "@/lib/jalali";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { commissionStatementsFor, commissionRatesFor } from "@/lib/repo/commissionView";
import { MANAGE_ROLES } from "@/lib/roles";


/** Who may see whose commission.
 *
 *  A فروشنده sees their own statement and nobody else's -- somebody else's earnings are
 *  the clearest example of data that is inside your own group and still none of your
 *  business. A manager sees the people (and drivers) in their group, plus their own
 *  override statement; a manager does not see another manager's override, the same "own
 *  group only" boundary the فروشنده statements already draw. The owner sees everyone, in
 *  every ledger. Rates and overrides are payroll policy, so only the owner reads the tables
 *  behind the figures. All of that lives in lib/repo/commissionView.ts, shared with the page.
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

  const { statements, driverStatements, managerStatements } = commissionStatementsFor(session, period);
  const { rates, driverRates, managerOverrides } = commissionRatesFor(session);
  return NextResponse.json({
    ok: true,
    statements,
    driver_statements: driverStatements,
    manager_statements: managerStatements,
    rates,
    driver_rates: driverRates,
    manager_overrides: managerOverrides,
  });
}
