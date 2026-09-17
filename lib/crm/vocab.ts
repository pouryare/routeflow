import type { CustomerType } from "@/lib/types";

/** Shared closed vocabularies for flow options, server validation and Persian UI copy. */
export function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

export function faDigits(s: string): string {
  return s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export const BUSINESS_TYPES = [
  "KEBAB", "IRANIAN", "FAST_FOOD", "CAFE", "CONFECTIONERY", "BAKERY", "CATERING", "HOTEL", "CHAIN", "OTHER",
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
  KEBAB: "کبابی", IRANIAN: "ایرانی", FAST_FOOD: "فست‌فود", CAFE: "کافه", CONFECTIONERY: "شیرینی‌فروشی",
  BAKERY: "نانوایی", CATERING: "کترینگ", HOTEL: "هتل", CHAIN: "زنجیره‌ای", OTHER: "سایر",
};

/** Preserve the existing customer_type CHECK constraint. */
export function customerTypeFor(t: BusinessType): CustomerType {
  switch (t) {
    case "KEBAB": case "IRANIAN": case "FAST_FOOD": case "CHAIN": return "RESTAURANT";
    case "CAFE": return "CAFE";
    case "CONFECTIONERY": case "BAKERY": return "RETAIL";
    case "CATERING": return "CATERING";
    case "HOTEL": return "HOTEL";
    default: return "OTHER";
  }
}

export const PRICE_TIERS = ["low", "mid", "high", "unknown"] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];
export const PRICE_TIER_LABEL: Record<PriceTier, string> = { low: "ارزان", mid: "متوسط", high: "گران", unknown: "نامعلوم" };

export const CONTACT_ROLES = [
  "OWNER", "MANAGER", "PURCHASING", "CHEF", "RECEPTION", "ACCOUNTANT", "STOREKEEPER", "STAFF", "OTHER",
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
export const CONTACT_ROLE_LABEL: Record<ContactRole, string> = {
  OWNER: "مالک / صاحب‌کار", MANAGER: "مدیر", PURCHASING: "مسئول خرید", CHEF: "سرآشپز",
  RECEPTION: "پذیرش / صندوق", ACCOUNTANT: "حسابدار", STOREKEEPER: "انباردار", STAFF: "کارمند", OTHER: "سایر",
};
const DECIDERS: ReadonlySet<ContactRole> = new Set<ContactRole>(["OWNER", "MANAGER", "PURCHASING", "CHEF"]);
export const isDecider = (r: ContactRole): boolean => DECIDERS.has(r);

export const CONTACT_STATUSES = [
  "not_contacted", "attempted", "no_answer", "busy", "wrong_number", "unavailable", "contacted",
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  not_contacted: "تماس‌نگرفته", attempted: "تلاش شده", no_answer: "بی‌پاسخ", busy: "مشغول",
  wrong_number: "شماره اشتباه", unavailable: "در دسترس نیست", contacted: "صحبت شده",
};

export const SALES_STAGES = [
  "unknown", "not_interested", "interested", "sample", "quotation", "negotiation",
  "first_order", "customer", "repeat_customer", "lost",
] as const;
export type SalesStage = (typeof SALES_STAGES)[number];
export const SALES_STAGE_LABEL: Record<SalesStage, string> = {
  unknown: "سرنخ تازه", not_interested: "علاقه ندارد", interested: "علاقه‌مند", sample: "نمونه",
  quotation: "پیش‌فاکتور", negotiation: "مذاکره", first_order: "اولین سفارش", customer: "مشتری",
  repeat_customer: "مشتری تکراری", lost: "از دست رفته",
};
export const CUSTOMER_STAGES: readonly SalesStage[] = ["first_order", "customer", "repeat_customer"];

export const VERIFICATIONS = [
  "unverified", "verified", "renamed", "moved", "wrong_number",
  "invalid_closed", "invalid_other_business", "invalid_not_fit", "invalid_not_found",
] as const;
export type Verification = (typeof VERIFICATIONS)[number];
export const VERIFICATION_LABEL: Record<Verification, string> = {
  unverified: "تأییدنشده", verified: "تأییدشده", renamed: "تأیید شد · نام تازه", moved: "تأیید شد · جابه‌جا",
  wrong_number: "شماره اشتباه", invalid_closed: "نامعتبر · تعطیل", invalid_other_business: "نامعتبر · کسب‌وکار دیگر",
  invalid_not_fit: "نامعتبر · مناسب نیست", invalid_not_found: "نامعتبر · پیدا نشد",
};
export const isInvalid = (v: Verification): boolean => v.startsWith("invalid_");

export const TEMPERATURES = ["hot", "warm", "cold"] as const;
export type Temperature = (typeof TEMPERATURES)[number];
export const TEMPERATURE_LABEL: Record<Temperature, string> = { hot: "داغ", warm: "گرم", cold: "سرد" };

export const LEAD_SOURCES = [
  "GOOGLE_MAPS", "GOOGLE_SEARCH", "SNAPPFOOD", "TAPSI_FOOD", "INSTAGRAM", "REFERRAL", "EXISTING_CUSTOMER", "FIELD_VISIT", "OTHER",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  GOOGLE_MAPS: "گوگل مپ", GOOGLE_SEARCH: "جستجوی گوگل", SNAPPFOOD: "اسنپ‌فود", TAPSI_FOOD: "تپسی‌فود",
  INSTAGRAM: "اینستاگرام", REFERRAL: "معرفی", EXISTING_CUSTOMER: "مشتری فعلی", FIELD_VISIT: "سر زدم", OTHER: "سایر",
};
export type SourceKind = "link" | "here" | "ref" | "other";
export const SOURCE_KIND: Record<LeadSource, SourceKind> = {
  GOOGLE_MAPS: "link", GOOGLE_SEARCH: "link", SNAPPFOOD: "link", TAPSI_FOOD: "link", INSTAGRAM: "link",
  REFERRAL: "ref", EXISTING_CUSTOMER: "ref", FIELD_VISIT: "here", OTHER: "other",
};
export const FOOD_APP_SOURCES: ReadonlySet<LeadSource> = new Set<LeadSource>(["SNAPPFOOD", "TAPSI_FOOD"]);

export const LOST_REASONS = [
  "PRICE_HIGH", "HAS_SUPPLIER", "QUALITY", "NO_NEED", "BUYS_FACTORY", "BUYS_DISTRIBUTOR", "PAYMENT_TERMS",
  "DELIVERY", "MOQ", "WRONG_CONTACT", "CLOSED", "SEASONAL", "COMPETITOR", "OTHER",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const LOST_REASON_LABEL: Record<LostReason, string> = {
  PRICE_HIGH: "قیمت بالاست", HAS_SUPPLIER: "تأمین‌کننده دارد", QUALITY: "کیفیت", NO_NEED: "فعلاً نیاز ندارد",
  BUYS_FACTORY: "از کارخانه می‌خرد", BUYS_DISTRIBUTOR: "از پخش‌کننده می‌خرد", PAYMENT_TERMS: "شرایط پرداخت",
  DELIVERY: "مشکل ارسال", MOQ: "حداقل سفارش زیاد است", WRONG_CONTACT: "فرد اشتباه", CLOSED: "کسب‌وکار بسته شده",
  SEASONAL: "فصلی", COMPETITOR: "رابطه با رقیب", OTHER: "سایر",
};

export const SKIP_REASONS = ["WAITING_ON_THEM", "LOGGED_ELSEWHERE", "LEAD_LOST", "OTHER"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  WAITING_ON_THEM: "منتظر تماس خودش", LOGGED_ELSEWHERE: "کار دیگری ثبت کردم", LEAD_LOST: "سرنخ از دست رفت", OTHER: "سایر",
};

export const NOT_FIT_REASONS = ["NO_DAIRY", "TOO_SMALL", "READY_FOOD_ONLY", "OTHER"] as const;
export type NotFitReason = (typeof NOT_FIT_REASONS)[number];
export const NOT_FIT_LABEL: Record<NotFitReason, string> = {
  NO_DAIRY: "لبنیات و کره مصرف نمی‌کند", TOO_SMALL: "خیلی کوچک است", READY_FOOD_ONLY: "فقط غذای آماده می‌گیرد", OTHER: "سایر",
};

/** Task kinds a flow may create; task label integration follows in Task 13. */
export const NEXT_KINDS = ["call", "visit", "verify_visit", "sample_delivery", "quote_followup", "outreach", "order"] as const;
export type NextKind = (typeof NEXT_KINDS)[number];
