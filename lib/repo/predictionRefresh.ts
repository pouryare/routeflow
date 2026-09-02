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

export function refreshPredictions(
  organizationId: number,
  asOfIso: string = new Date().toISOString()
): PredictionRefreshResult {
  const forecasts = materialiseForecasts(organizationId, asOfIso);
  const train = trainChurnFromLapses(organizationId, asOfIso);
  const churn = materialiseChurnScores(organizationId, asOfIso);
  const capacity = learnCapacityFromRuns(organizationId, asOfIso);
  return { forecasts, churn, churn_trained: train.trained, capacity };
}
