import type { ContactStatus, SalesStage, Temperature } from "./vocab";

/** What one answer to "how did it go?" means for the business's state. Existing codes
 *  (PRICE_OBJECTION, NOT_INTERESTED, ALREADY_SUPPLIED, PAYMENT_TERMS, QUALITY_DOUBT) are
 *  reused so the academy's objection cards keep matching tasks.outcome_code. */
export const OUTCOME_CODES = [
  "NO_ANSWER", "BUSY", "UNAVAILABLE", "WRONG_NUMBER", "TALKED", "CALL_BACK", "INTERESTED", "ASKED_PRICE",
  "REQUESTED_SAMPLE", "NEGOTIATING", "READY_TO_ORDER", "PRICE_OBJECTION", "PAYMENT_TERMS", "QUALITY_DOUBT",
  "ALREADY_SUPPLIED", "NOT_INTERESTED", "GATEKEEPER", "VISIT_CLOSED", "INVALID",
  // Driver visit outcomes (a driver physically went to the lead location). These live on
  // saved_locations.visit_outcome and drive the /leads row status; they are NOT call facts.
  "VISITED", "ACCESS_FAILED", "READY_TO_BUY", "VISIT_NOT_INTERESTED", "VISIT_CLOSED", "VISIT_NO_OWNER",
  "VISIT_WRONG_ADDRESS", "VISIT_NEW_BUILDING",
] as const;
export type OutcomeCode = (typeof OUTCOME_CODES)[number];

export interface OutcomeFacts {
  contact_status: ContactStatus | null;
  stage: SalesStage | null;
  signal: Temperature | null;
  attempt: boolean;
  miss: boolean;
  talked: boolean;
}

const miss = (s: ContactStatus): OutcomeFacts => ({ contact_status: s, stage: null, signal: null, attempt: true, miss: true, talked: false });
const talk = (stage: SalesStage | null, signal: Temperature | null): OutcomeFacts => ({ contact_status: "contacted", stage, signal, attempt: true, miss: false, talked: true });
const none: OutcomeFacts = { contact_status: null, stage: null, signal: null, attempt: false, miss: false, talked: false };

export const OUTCOMES: Record<OutcomeCode, OutcomeFacts> = {
  NO_ANSWER: miss("no_answer"),
  BUSY: miss("busy"),
  UNAVAILABLE: miss("unavailable"),
  WRONG_NUMBER: miss("wrong_number"),
  TALKED: talk(null, null),
  CALL_BACK: talk(null, "warm"),
  INTERESTED: talk("interested", "warm"),
  ASKED_PRICE: talk("interested", "hot"),
  REQUESTED_SAMPLE: talk("sample", "hot"),
  NEGOTIATING: talk("negotiation", "hot"),
  READY_TO_ORDER: talk("negotiation", "hot"),
  PRICE_OBJECTION: talk(null, "warm"),
  PAYMENT_TERMS: talk(null, "warm"),
  QUALITY_DOUBT: talk(null, "warm"),
  ALREADY_SUPPLIED: talk(null, "warm"),
  NOT_INTERESTED: talk("not_interested", "cold"),
  GATEKEEPER: talk(null, null),
  VISIT_CLOSED: none,
  INVALID: none,
  // Driver visit outcomes. A visit that talked is a visit that succeeded; the rest are
  // misses (the driver was there but came away with nothing). `talked` is what the CRM's
  // "did we reach anyone" test reads, so a closed shop is a miss, not a talk.
  VISITED: talk(null, null),
  ACCESS_FAILED: { contact_status: null, stage: null, signal: null, attempt: true, miss: true, talked: false },
  READY_TO_BUY: talk("negotiation", "hot"),
  VISIT_NOT_INTERESTED: talk("not_interested", "cold"),
  VISIT_CLOSED: { contact_status: null, stage: null, signal: null, attempt: true, miss: true, talked: false },
  VISIT_NO_OWNER: { contact_status: null, stage: null, signal: null, attempt: true, miss: true, talked: false },
  VISIT_WRONG_ADDRESS: { contact_status: null, stage: null, signal: null, attempt: true, miss: true, talked: false },
  VISIT_NEW_BUILDING: { contact_status: null, stage: null, signal: null, attempt: true, miss: true, talked: false },
};
