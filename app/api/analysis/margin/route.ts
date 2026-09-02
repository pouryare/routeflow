import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { marginBy, MarginError, type MarginDimension } from "@/lib/repo/margin";
import { currentPeriod } from "@/lib/analysis/period";

export const dynamic = "force-dynamic";

const DIMENSIONS: MarginDimension[] = ["customer", "product", "salesperson", "group", "representative"];

/** Contribution margin for one dimension over one Jalali month. Manager+ only —
 *  margin exposes product cost, which a فروشنده never sees. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const dimension = (sp.get("dimension") ?? "customer") as MarginDimension;
  if (!DIMENSIONS.includes(dimension)) {
    return NextResponse.json(
      { ok: false, error: `بُعد باید یکی از ${DIMENSIONS.join("، ")} باشد` },
      { status: 400 }
    );
  }
  const period = sp.get("period") ?? currentPeriod();

  try {
    return NextResponse.json({
      ok: true,
      dimension,
      period,
      rows: marginBy(guard.session.organizationId, dimension, period, guard.session),
    });
  } catch (e) {
    if (e instanceof MarginError) return NextResponse.json({ ok: false, error: e.message }, { status: 403 });
    throw e;
  }
}
