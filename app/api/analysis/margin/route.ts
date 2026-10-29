import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { marginBy, MarginError, type MarginDimension } from "@/lib/repo/margin";
import { currentPeriod, isPeriod } from "@/lib/analysis/period";
import { MANAGE_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

const DIMENSIONS: MarginDimension[] = ["customer", "product", "salesperson", "group", "representative"];

/** Contribution margin for one dimension over one Jalali month. Manager+ only —
 *  margin exposes product cost, which a فروشنده never sees. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
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
  if (!isPeriod(period)) {
    return NextResponse.json({ ok: false, error: "دورهٔ نامعتبر است" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      ok: true,
      dimension,
      period,
      rows: await marginBy(guard.session.organizationId, dimension, period, guard.session),
    });
  } catch (e) {
    if (e instanceof MarginError) return NextResponse.json({ ok: false, error: e.message }, { status: 403 });
    throw e;
  }
}
