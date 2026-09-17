import { advanceStage } from "./stage";
import { autoTemperature, DEFAULT_WINDOWS, type TempSignal, type TempWindows } from "./temperature";
import { VERIFICATIONS, type ContactStatus, type SalesStage, type Temperature, type Verification } from "./vocab";

/** The columns of one activities row the replay folds. Stored on the row itself, so the
 *  replay never re-derives them from outcome codes whose meaning may change later. */
export interface ActivityFacts {
  occurred_at: string;
  contact_status_to: ContactStatus | null;
  stage_to: SalesStage | null;
  verification_to: Verification | null;
  signal: Temperature | null;
  attempt: number;
  miss: number;
  talked: number;
}

export interface CrmState {
  contact_status: ContactStatus;
  sales_stage: SalesStage;
  verification: Verification;
  temperature: Temperature;
  attempt_count: number;
  consecutive_misses: number;
  last_activity_at: string | null;
  last_contacted_at: string | null;
}

export const INITIAL_STATE: CrmState = {
  contact_status: "not_contacted", sales_stage: "unknown", verification: "unverified", temperature: "cold",
  attempt_count: 0, consecutive_misses: 0, last_activity_at: null, last_contacted_at: null,
};

const VERIFIED = new Set<string>(VERIFICATIONS);

/** The cached columns on customers are exactly this fold over the business's activities in
 *  (occurred_at, id) order. Temperature is evaluated as of the last activity, so the result
 *  is deterministic; a later sweep may cool it as time passes. */
export function replayCrmState(acts: ActivityFacts[], w: TempWindows = DEFAULT_WINDOWS): CrmState {
  const s: CrmState = { ...INITIAL_STATE };
  const signals: TempSignal[] = [];
  for (const a of acts) {
    if (a.verification_to && !VERIFIED.has(a.verification_to)) {
      throw new Error(`بازهٔ تأیید نامعتبر: ${String(a.verification_to)}`);
    }
    if (a.contact_status_to) s.contact_status = a.contact_status_to;
    s.sales_stage = advanceStage(s.sales_stage, a.stage_to);
    if (a.verification_to) s.verification = a.verification_to;
    if (a.signal) signals.push({ at: a.occurred_at, signal: a.signal });
    if (a.attempt) s.attempt_count += 1;
    if (a.miss) s.consecutive_misses += 1;
    else if (a.talked) s.consecutive_misses = 0;
    if (a.talked) s.last_contacted_at = a.occurred_at;
    s.last_activity_at = a.occurred_at;
  }
  if (s.last_activity_at) s.temperature = autoTemperature(signals, s.last_activity_at, w);
  return s;
}
