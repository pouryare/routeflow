import type { ContactStatus, SalesStage, Temperature } from "./vocab";

/** What one answer to "how did it go?" means for the business's state. Existing codes
 *  (PRICE_OBJECTION, NOT_INTERESTED, ALREADY_SUPPLIED, PAYMENT_TERMS, QUALITY_DOUBT) are
 *  reused so the academy's objection cards keep matching tasks.outcome_code. */
export const OUTCOME_CODES = [
  "NO_ANSWER", "BUSY", "UNAVAILABLE", "WRONG_NUMBER", "TALKED", "CALL_BACK", "INTERESTED", "ASKED_PRICE",
  "REQUESTED_SAMPLE", "NEGOTIATING", "READY_TO_ORDER", "PRICE_OBJECTION", "PAYMENT_TERMS", "QUALITY_DOUBT",
  "ALREADY_SUPPLIED", "NOT_INTERESTED", "GATEKEEPER", "VISIT_CLOSED", "INVALID",
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
};
