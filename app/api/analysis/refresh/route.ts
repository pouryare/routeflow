import { NextRequest } from "next/server";
import { sweepScope, sweepResponse } from "@/lib/sweepAuth";
import { refreshAll } from "@/lib/repo/analysisRefresh";

import { mapSeq } from "@/lib/seq";
export const dynamic = "force-dynamic";

/** The analysis sweep — a manager's click (own org) or the cron with `x-sweep-token`
 *  (every org). Recomputes the current + prior Jalali month's KPI snapshots and the
 *  margin / health roll-ups. */
export async function POST(req: NextRequest) {
  const scope = await sweepScope(req);
  if (!scope.ok) return scope.response;
  const results = await mapSeq(scope.orgIds, async (organization_id) => ({
    organization_id,
    ...await refreshAll(organization_id),
  }));
  return sweepResponse(scope.via, results);
}
