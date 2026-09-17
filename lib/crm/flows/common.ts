import type { DueSpec } from "../due";
import { CONTACT_ROLES, CONTACT_ROLE_LABEL, isDecider, SKIP_REASONS, SKIP_REASON_LABEL, type ContactRole, type NextKind } from "../vocab";
import type { FlowOption, FlowSet, FlowStep } from "./types";

export const TOMORROW_10: DueSpec = { kind: "tomorrow", hour: 10 };
export interface TimeChoice { id: string; label: string; due: DueSpec; rec?: boolean }
export const PICK = (label = "روز دیگر…"): TimeChoice => ({ id: "pick", label, due: { kind: "pick", hour: 10 } });

/** A time question's answers: each one saves, carrying the next action's title and kind. */
export function timeOptions(title: string, kind: NextKind, choices: TimeChoice[], extra: FlowSet = {}): FlowOption[] {
  return choices.map((c) => ({
    id: c.id, label: c.label, sub: c.rec ? "پیشنهادی" : undefined, tone: c.rec ? "rec" : undefined, save: true,
    set: { next_title: title, next_kind: kind, due: c.due, ...extra },
  }));
}

const ROLE_ORDER: ContactRole[] = CONTACT_ROLES.filter((r) => r !== "OTHER");

/** "Who did you talk to?" -- roles, decision-makers first; nobody is known on a first call. */
export function roleOptions(deciderNext: string, staffNext: string): FlowOption[] {
  return ROLE_ORDER.map((r) => ({
    id: r, label: CONTACT_ROLE_LABEL[r], group: isDecider(r) ? "تصمیم‌گیرنده" : "کارکنان",
    next: isDecider(r) ? deciderNext : staffNext, set: { contact_role: r },
  }));
}

export const SKIP_STEP: FlowStep = {
  id: "skip", kind: "choice", q: "چرا کار بعدی ندارد؟",
  options: SKIP_REASONS.map((r) => ({ id: r, label: SKIP_REASON_LABEL[r], save: true, set: { skip_reason: r, due: { kind: "none" } } })),
};
