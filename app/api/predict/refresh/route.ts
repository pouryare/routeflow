import { NextRequest } from "next/server";
import { sweepScope, sweepResponse } from "@/lib/sweepAuth";
import { refreshPredictions } from "@/lib/repo/predictionRefresh";

export const dynamic = "force-dynamic";

/** The prediction sweep — a manager's click (own org) or the cron with `x-sweep-token`
 *  (every org). Refolds the demand models + forecasts, retrains + rescores churn, and
 *  folds completed runs into the learned capacity factors. */
export async function POST(req: NextRequest) {
  const scope = sweepScope(req);
  if (!scope.ok) return scope.response;
  const results = scope.orgIds.map((organization_id) => ({
    organization_id,
    ...refreshPredictions(organization_id),
  }));
  return sweepResponse(scope.via, results);
}
