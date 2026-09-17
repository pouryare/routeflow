/** What a task's `kind` is called, and which tone its card wears.
 *
 *  One place, because there were two copies (Board, BoardMobile) plus two tone maps
 *  (Board, Pocket), and all four had fallen behind the data: the overdue-customer rule
 *  seeds tasks with kind `call` (lib/db.ts), none of the maps had it, and 33 production
 *  cards printed «call» to a Persian reader with no tone. Two more rule-seeded kinds,
 *  `delivery_retry` and `sample_followup`, were waiting to do the same. `tasks.kind` is
 *  free text in the schema, so this list is the union: tests/no-raw-enum-copy.test.ts
 *  checks every kind the codebase creates is here. */

export const TASK_KINDS = [
  "outreach", "call", "order", "visit", "reminder", "note", "admin", "delivery_retry", "sample_followup",
  "verify_visit", "sample_delivery", "quote_followup",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  outreach: "پیگیری",
  call: "تماس",
  order: "سفارش",
  visit: "بازدید",
  reminder: "یادآوری",
  note: "یادداشت",
  admin: "اداری",
  delivery_retry: "پیگیری تحویل",
  sample_followup: "پیگیری نمونه",
  verify_visit: "بازدید تأیید",
  sample_delivery: "تحویل نمونه",
  quote_followup: "پیگیری قیمت",
};

/** Card tone names, as the board and pocket CSS spell them. */
export const TASK_KIND_TONE: Record<TaskKind, string> = {
  outreach: "accent",
  call: "accent",
  order: "amber",
  visit: "sage",
  reminder: "crit",
  note: "plum",
  admin: "plum",
  delivery_retry: "crit",
  sample_followup: "sage",
  verify_visit: "sage",
  sample_delivery: "sage",
  quote_followup: "accent",
};


/** A kind from the database, labelled. An unknown kind reads «کار», never the identifier. */
export function taskKindLabel(kind: string): string {
  return (TASK_KIND_LABEL as Record<string, string>)[kind] ?? "کار";
}

export function taskKindTone(kind: string): string {
  return (TASK_KIND_TONE as Record<string, string>)[kind] ?? "plum";
}

/** A call's outcome, as the /today chips, the Board's drop flow and the academy's
 *  objection cards all name it. The chips offer four; the academy seeds cards for eight,
 *  and it printed the other four as raw codes («PRICE_OBJECTION») before this map. */
export const OUTCOME_LABEL: Record<string, string> = {
  CONTACTED: "تماس شد",
  ORDERED: "خرید کرد",
  PRICE_OBJECTION: "قیمت",
  NOT_INTERESTED: "رد کرد",
  ALREADY_SUPPLIED: "تأمین‌کننده دارد",
  NO_TIME: "وقت ندارد",
  PAYMENT_TERMS: "شرایط پرداخت",
  QUALITY_DOUBT: "تردید در کیفیت",
  NO_ANSWER: "جواب نداد",
  BUSY: "مشغول بود",
  UNAVAILABLE: "در دسترس نبود",
  WRONG_NUMBER: "شماره اشتباه",
  TALKED: "صحبت شد",
  CALL_BACK: "بعداً زنگ بزن",
  INTERESTED: "علاقه‌مند شد",
  ASKED_PRICE: "قیمت خواست",
  REQUESTED_SAMPLE: "نمونه خواست",
  NEGOTIATING: "مذاکره",
  READY_TO_ORDER: "آمادهٔ سفارش",
  GATEKEEPER: "تصمیم‌گیرنده نبود",
  VISIT_CLOSED: "بسته بود",
  INVALID: "نامعتبر",
};


export function outcomeLabel(code: string): string {
  return OUTCOME_LABEL[code] ?? "نتیجهٔ دیگر";
}
