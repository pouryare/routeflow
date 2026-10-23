/** The prediction sweep entry point.
 *
 *  Its own module — mirrors `analysisRefresh` — so the orchestrator can import
 *  `forecast`, `churn` and `capacityLearning` without any of them importing it back.
 *  A scheduler or a manual click calls this; nothing here runs on a timer.
 */

import { materialiseForecasts } from "./forecast";
import { trainChurnFromLapses, materialiseChurnScores } from "./churn";
import { learnCapacityFromRuns } from "./capacityLearning";

export interface PredictionRefreshResult {
  forecasts: number;
  churn: number;
  churn_trained: boolean;
  capacity: number;
}

export async function refreshPredictions(
  organizationId: number,
  asOfIso: string = new Date().toISOString()
): Promise<PredictionRefreshResult> {
  const forecasts = await materialiseForecasts(organizationId, asOfIso);
  const train = await trainChurnFromLapses(organizationId, asOfIso);
  const churn = await materialiseChurnScores(organizationId, asOfIso);
  const capacity = await learnCapacityFromRuns(organizationId, asOfIso);
  return { forecasts, churn, churn_trained: train.trained, capacity };
}
