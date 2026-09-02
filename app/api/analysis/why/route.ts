import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { whyChain, WhyError, type WhyMetric } from "@/lib/repo/why";
import { shiftPeriod, currentPeriod } from "@/lib/analysis/period";

export const dynamic = "force-dynamic";

const WHY_METRICS: WhyMetric[] = ["net_sales", "gross_profit", "orders"];

/** The "Why?" ladder for a metric between two Jalali months. Manager+ only — a
 *  decomposition exposes every group's and salesperson's numbers. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const metric = sp.get("metric") as WhyMetric | null;
  if (!metric || !WHY_METRICS.includes(metric)) {
    return NextResponse.json(
      { ok: false, error: `متریک باید یکی از ${WHY_METRICS.join("، ")} باشد` },
      { status: 400 }
    );
  }
  const to = sp.get("to") ?? currentPeriod();
  const from = sp.get("from") ?? shiftPeriod(to, 1);

  try {
    return NextResponse.json({
      ok: true,
      metric,
      from,
      to,
      chain: whyChain(guard.session, metric, from, to),
    });
  } catch (e) {
    if (e instanceof WhyError) return NextResponse.json({ ok: false, error: e.message }, { status: 403 });
    throw e;
  }
}
