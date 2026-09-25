import type { NextKind } from "./vocab";

/** What one recorded visit means, read back two ways: as words, and as the next move.
 *
 *  Rule 2 of the lead work -- a driver reports what happened at the door, and the follow-up
 *  is derived rather than chosen. So neither of these is stored, and neither is a state.
 *  Both are pure reads of `saved_locations.visit_outcome`, the one column a visit writes.
 *
 *  That restraint is the point. `customers.lifecycle` is the only lead state this app has,
 *  and it is derived from the activity log by recomputeState(); a second opinion about where
 *  a lead stands would be a second thing to keep in step with the first, and the two would
 *  disagree the first time a lead was promoted by an order rather than by hand.
 *
 *  The vocabulary is borrowed rather than invented. Outcome codes come from OUTCOMES and
 *  follow-up kinds from NEXT_KINDS, so a derived action is a kind the tasks table, the
 *  pocket and the board already know how to store, list and count.
 */

/** The outcomes a driver can leave behind. VISITED and ACCESS_FAILED are the two the flow
 *  passes through on its way to asking what actually happened, so they are rare in a stored
 *  row -- but both are reachable if a flow is ever abandoned mid-way, and both need an
 *  answer rather than a crash.
 *
 *  VISIT_NOT_INTERESTED is deliberately absent: the visit flow never offers it. A lead the
 *  owner turns away is not a retry and not a sale, so it has no next action to derive. */
export const LEAD_VISIT_OUTCOMES = [
  "VISITED",
  "ACCESS_FAILED",
  "READY_TO_BUY",
  "INTERESTED",
  "VISIT_CLOSED",
  "VISIT_NO_OWNER",
  "VISIT_WRONG_ADDRESS",
  "VISIT_NEW_BUILDING",
] as const;
export type LeadVisitOutcome = (typeof LEAD_VISIT_OUTCOMES)[number];

/** The flow's own option labels, verbatim, so the card under the driver's thumb says the
 *  words they tapped rather than a paraphrase of them. */
const LABELS: Record<LeadVisitOutcome, string> = {
  VISITED: "بازدید انجام شد",
  ACCESS_FAILED: "دسترسی ممکن نشد",
  READY_TO_BUY: "آماده خرید",
  INTERESTED: "علاقه‌مند ولی نیاز به تماس",
  VISIT_CLOSED: "بسته بود",
  VISIT_NO_OWNER: "صاحب‌ش نبود",
  VISIT_WRONG_ADDRESS: "آدرس اشتباه",
  VISIT_NEW_BUILDING: "ساخته جدید",
};

/** What each outcome implies should happen next, in the app's own task vocabulary.
 *
 *  - READY_TO_BUY -> an order. This is the whole of rule 1: a lead becomes a customer when
 *    it buys, so the follow-up to "they are ready" is the paperwork of buying, not a flag
 *    somebody sets by hand.
 *  - INTERESTED -> a call, for the sales team rather than the driver. In this flow the two
 *    always travel together (the only option that sets INTERESTED also sets handoff_sales),
 *    which is what makes reading the outcome alone sufficient; tests/lead-desire.test.ts
 *    asserts that pairing so a future option cannot quietly break it.
 *  - the four misses -> a reminder. The driver went and got nothing, and the reason is one
 *    a later visit can fix: the shop may open, the owner may be in, the pin may be right.
 *  - VISITED -> nothing. The driver spoke to someone and recorded no objection; there is no
 *    move to derive until the office acts on it. */
const NEXT_ACTION: Record<LeadVisitOutcome, NextKind | null> = {
  READY_TO_BUY: "order",
  INTERESTED: "call",
  ACCESS_FAILED: "reminder",
  VISIT_CLOSED: "reminder",
  VISIT_NO_OWNER: "reminder",
  VISIT_WRONG_ADDRESS: "reminder",
  VISIT_NEW_BUILDING: "reminder",
  VISITED: null,
};

/** The follow-up a recorded outcome implies, or null when it implies none.
 *
 *  Takes the raw column rather than `LeadVisitOutcome` because that column is free text: a
 *  row written by an older build, or by a path that records a call outcome against a lead,
 *  holds a code this module has never heard of. An unrecognised value yields null -- no
 *  follow-up -- rather than a guess, because a wrong derived action becomes a real task in
 *  somebody's list. */
export function nextActionFor(outcome: string | null | undefined): NextKind | null {
  if (!outcome) return null;
  return NEXT_ACTION[outcome as LeadVisitOutcome] ?? null;
}

/** The outcome as the driver would name it, for a card summarising the last visit.
 *
 *  An unrecognised code still reads as a visit rather than as an error: whatever is in that
 *  column, somebody stood in front of the place and pressed a button, and a driver holding
 *  the phone needs that to be legible. */
export function visitOutcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return "هنوز بازدید نشده";
  return LABELS[outcome as LeadVisitOutcome] ?? "بازدید ثبت شد";
}
