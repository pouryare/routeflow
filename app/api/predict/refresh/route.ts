import { NextRequest } from "next/server";
import { sweepScope, sweepResponse } from "@/lib/sweepAuth";
import { refreshPredictions } from "@/lib/repo/predictionRefresh";

import { mapSeq } from "@/lib/seq";
export const dynamic = "force-dynamic";

/** The prediction sweep — a manager's click (own org) or the cron with `x-sweep-token`
 *  (every org). Refolds the demand models + forecasts, retrains + rescores churn, and
 *  folds completed runs into the learned capacity factors. */
export async function POST(req: NextRequest) {
  const scope = await sweepScope(req);
  if (!scope.ok) return scope.response;
  const results = await mapSeq(scope.orgIds, async (organization_id) => ({
    organization_id,
    ...await refreshPredictions(organization_id),
  }));
  return sweepResponse(scope.via, results);
}
