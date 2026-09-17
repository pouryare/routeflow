import { OUTCOMES, type OutcomeCode } from "./outcomes";
import { isOneOf, isInvalid, SALES_STAGES, SALES_STAGE_LABEL, VERIFICATIONS, VERIFICATION_LABEL } from "./vocab";
import { outcomeLabel } from "@/lib/tasks/labels";

export const TIMELINE_KINDS = ["activity", "task", "order", "payment"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];
export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  activity: "تماس و بازدید", task: "کارها", order: "سفارش‌ها", payment: "دریافت‌ها",
};
export interface TimelineItem {
  kind: TimelineKind; id: number; at: string; title: string; sub: string | null;
  who: string | null; href: string | null; tone: "muted" | "bad" | "good" | null;
}
export type TimelineCursor = Pick<TimelineItem, "at" | "id" | "kind">;

/** Same total order as the SQL seeks: newest timestamp, then ID, then kind. */
export function compareTimeline(x: TimelineCursor, y: TimelineCursor): number {
  return x.at < y.at ? 1 : x.at > y.at ? -1 : y.id - x.id || (x.kind < y.kind ? 1 : x.kind > y.kind ? -1 : 0);
}
export function encodeTimelineCursor(item: TimelineCursor): string {
  return JSON.stringify({ at: item.at, id: item.id, kind: item.kind });
}
export function decodeTimelineCursor(raw: string): TimelineCursor {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("نشانگر تاریخچه نامعتبر است"); }
  if (!value || typeof value !== "object") throw new Error("نشانگر تاریخچه نامعتبر است");
  const c = value as Partial<TimelineCursor>;
  if (typeof c.at !== "string" || !c.at || c.at.length > 40 || !Number.isSafeInteger(c.id) || (c.id ?? 0) < 1 || !isOneOf(TIMELINE_KINDS, c.kind)) {
    throw new Error("نشانگر تاریخچه نامعتبر است");
  }
  return c as TimelineCursor;
}
const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  call: "تماس", visit: "بازدید", message: "پیام", note: "یادداشت", lead_created: "سرنخ ثبت شد",
  verification: "تأیید", owner_change: "تغییر مسئول", temperature_change: "تغییر دما", stage_change: "تغییر مرحله",
  sample: "نمونه", quotation: "پیش‌فاکتور", order: "تحویل سفارش", merge: "ادغام", correction: "اصلاح", system: "وضعیت اولیه",
};
export function activityLine(a: {
  type: string; outcome_code: string | null; note: string | null; verification_to: string | null; stage_to: string | null;
}): Pick<TimelineItem, "title" | "sub" | "tone"> {
  const type = ACTIVITY_TYPE_LABEL[a.type] ?? "رویداد";
  const code = a.outcome_code && Object.hasOwn(OUTCOMES, a.outcome_code) ? a.outcome_code as OutcomeCode : null;
  const facts = [
    isOneOf(VERIFICATIONS, a.verification_to) && a.verification_to !== "unverified" ? VERIFICATION_LABEL[a.verification_to] : null,
    isOneOf(SALES_STAGES, a.stage_to) ? SALES_STAGE_LABEL[a.stage_to] : null,
    a.note?.trim() || null,
  ].filter(Boolean);
  return {
    title: code ? `${type} · ${outcomeLabel(code)}` : type,
    sub: facts.length ? facts.join(" · ") : null,
    tone: isOneOf(VERIFICATIONS, a.verification_to) && isInvalid(a.verification_to) ? "bad" : code && OUTCOMES[code].miss ? "muted" : null,
  };
}
