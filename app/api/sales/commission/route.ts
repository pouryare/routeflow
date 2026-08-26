import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { statementFor, allStatements, readRates } from "@/lib/commissionLedger";

/** Who may see whose commission.
 *
 *  A فروشنده sees their own statement and nobody else's -- somebody else's earnings are
 *  the clearest example of data that is inside your own group and still none of your
 *  business. A manager sees the people in their group. The owner sees everyone.
 */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson"]);
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const url = new URL(req.url);
  const period = {
    from: url.searchParams.get("from") ?? `${new Date().getFullYear()}-01-01`,
    to: url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10),
  };

  const db = getDb();

  if (session.role === "salesperson") {
    return NextResponse.json({
      ok: true,
      statements: [statementFor(db, session.user.id, period)],
      rates: [],
    });
  }

  const statements = allStatements(db, period, {
    groupId: session.role === "owner" ? undefined : session.groupId,
  });

  // Rates are payroll policy, so only the owner reads the table behind the figures.
  return NextResponse.json({
    ok: true,
    statements,
    rates: session.role === "owner" ? readRates(db) : [],
  });
}
