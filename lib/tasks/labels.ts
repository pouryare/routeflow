/** What a task's `kind` is called, and which tone its card wears.
 *
 *  One place, because there were two copies (Board, BoardMobile) plus two tone maps
 *  (Board, Pocket), and all four had fallen behind the data: the overdue-customer rule
 *  seeds tasks with kind `call` (lib/db.ts), none of the maps had it, and 33 production
 *  cards printed «call» to a Persian reader with no tone. Two more rule-seeded kinds,
 *  `delivery_retry` and `sample_followup`, were waiting to do the same. `tasks.kind` is
 *  free text in the schema, so this list is the union: tests/no-raw-enum-copy.test.ts
 *  checks every kind the codebase creates is here. */

/* Type-only, so nothing is pulled in at runtime: lib/repo/tasks.ts is a heavy module and
 * this one must stay a leaf. It is here because TASK_PRIORITY_LABEL below is typed off
 * TaskRow's OWN union rather than re-spelled as a fresh literal list -- so a fifth priority
 * added to the schema becomes a COMPILE error on that map instead of another silent leak on
 * a Persian page. */
import type { TaskRow } from "@/lib/repo/tasks";

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

/** What a task's `priority` is called.
 *
 *  `tasks.priority` is UPPERCASE in the schema (lib/db.ts:2417) and the briefing's open_tasks
 *  panel printed it raw — «HIGH» sitting beside a Persian task title, on the same screen that
 *  was printing «CONFIRMED» as an order status. Same leak, third panel, same function. */
export type TaskPriority = TaskRow["priority"];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  CRITICAL: "بحرانی",
  HIGH: "زیاد",
  NORMAL: "عادی",
  LOW: "کم",
};

/** A priority from the database, labelled. An unknown one reads «عادی», never the identifier. */
export function taskPriorityLabel(priority: string): string {
  return (TASK_PRIORITY_LABEL as Record<string, string>)[priority] ?? TASK_PRIORITY_LABEL.NORMAL;
}

/** A call's outcome, as the /start chips, the Board's drop flow and the academy's
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
  // Driver visit outcomes (a driver physically went to the lead location).
  VISITED: "بازدید شد",
  ACCESS_FAILED: "دسترسی نشد",
  READY_TO_BUY: "آماده خرید",
  VISIT_NOT_INTERESTED: "علاقه ندارد",
  VISIT_NO_OWNER: "صاحب‌ش نبود",
  VISIT_WRONG_ADDRESS: "آدرس اشتباه",
  VISIT_NEW_BUILDING: "ساخته جدید",
};


export function outcomeLabel(code: string): string {
  return OUTCOME_LABEL[code] ?? "نتیجهٔ دیگر";
}
