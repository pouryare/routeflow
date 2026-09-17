import { isWorkingHours, type WorkingHours } from "../hours";
import { normPhone } from "../phone";
import {
  BUSINESS_TYPES, BUSINESS_TYPE_LABEL, FOOD_APP_SOURCES, LEAD_SOURCES, LEAD_SOURCE_LABEL, PRICE_TIER_LABEL, SOURCE_KIND, faDigits,
} from "../vocab";
import { SKIP_STEP, TOMORROW_10 } from "./common";
import type { FlowConfig, FlowContext, FlowOption, FlowSet } from "./types";

export interface BasicsValue { name: string; phone: string | null; branch_of: number | null; instagram: string | null }
export interface PinValue { lat: number; lng: number; precision: "exact" | "approx"; address?: string | null }
export interface LinkValue { name: string | null; lat: number | null; lng: number | null; address: string | null; maps_url: string }

const parse = <T,>(s: string | undefined): T | null => {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
};
/** Inside Iran's bounding box -- also rejects the 0,0 a failed geolocation returns. */
const inIran = (lat: unknown, lng: unknown): boolean =>
  typeof lat === "number" && typeof lng === "number" && lat > 24 && lat < 40 && lng > 44 && lng < 64;

export function basicsOf(values: Record<string, string>): BasicsValue | null {
  const b = parse<BasicsValue>(values.basics);
  return b && typeof b.name === "string" ? { name: b.name, phone: b.phone ?? null, branch_of: b.branch_of ?? null, instagram: b.instagram ?? null } : null;
}
export function linkOf(values: Record<string, string>): LinkValue | null {
  const l = parse<LinkValue>(values.link);
  return l && typeof l.maps_url === "string" ? l : null;
}
/** The pin, most deliberate first: dropped on the map, then "I'm here", then the link's. */
export function pinOf(values: Record<string, string>): PinValue | null {
  for (const key of ["pin", "here"]) {
    const p = parse<PinValue>(values[key]);
    if (p && inIran(p.lat, p.lng)) return { lat: p.lat, lng: p.lng, precision: p.precision === "approx" ? "approx" : "exact", address: p.address ?? null };
  }
  const l = linkOf(values);
  if (l && inIran(l.lat, l.lng)) return { lat: l.lat as number, lng: l.lng as number, precision: "exact", address: l.address };
  return null;
}
export function hoursOf(values: Record<string, string>): WorkingHours {
  const h = parse<unknown>(values.hours);
  return isWorkingHours(h) ? h : [];
}
export const hasPhone = (values: Record<string, string>): boolean => !!normPhone(basicsOf(values)?.phone);

const afterHours = (ctx: FlowContext) => (ctx.isManager ? "assign" : "first");
const talkedNow: FlowOption = { id: "talked", label: "الان صحبت کردم", sub: "ثبت نتیجه", save: true, set: { handoff: "talked_now", verification: "verified", due: { kind: "none" } } };
const visitSet = (title: string): FlowSet => ({ next_title: title, next_kind: "visit", due: { kind: "tomorrow", hour: 11 } });

export const addLeadFlow: FlowConfig = {
  id: "add_lead",
  start: () => "src",
  skipStep: "skip",
  budget: { common: 7, longest: 12 },
  steps: {
    src: {
      id: "src", kind: "choice", q: "از کجا پیدایش کردید؟", sub: "منبع روی پرونده می‌ماند و در گزارش منبع‌ها شمرده می‌شود",
      options: LEAD_SOURCES.map((s) => ({ id: s, label: LEAD_SOURCE_LABEL[s], sub: s === "FIELD_VISIT" ? "اینجا هستم" : undefined, next: SOURCE_KIND[s], set: { source: s } })),
    },
    link: {
      id: "link", kind: "link", q: "لینک را بچسبانید", sub: "نام و مکان از روی لینک پر می‌شود",
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "basics" }, { id: "nolink", label: "لینک ندارم", next: "basics" }],
    },
    here: {
      id: "here", kind: "pin", q: "الان جلوی همین کسب‌وکار هستید؟", sub: "مکان گوشی شما پین می‌شود؛ بعد می‌توانید جابه‌جایش کنید",
      options: [{ id: "ok", label: "همین‌جاست", tone: "rec", next: "basics", set: { verification: "verified" } }, { id: "nothere", label: "نه، بعداً روی نقشه", next: "basics" }],
    },
    ref: {
      id: "ref", kind: "choice", q: "چه کسی معرفی کرد؟",
      options: (ctx) => [
        ...ctx.recentCustomers.slice(0, 6).map((c) => ({ id: `r${c.id}`, label: c.name, next: "basics", set: { referred_by: c.id } })),
        { id: "outside", label: "نام معرف را می‌نویسم", next: "refname" },
      ],
    },
    refname: { id: "refname", kind: "input", q: "نام معرف", input: { field: "source_detail", placeholder: "نام معرف…" }, options: [{ id: "ok", label: "ادامه", next: "basics" }] },
    other: { id: "other", kind: "input", q: "منبع چیست؟", input: { field: "source_detail", placeholder: "مثلاً: نمایشگاه صنایع غذایی" }, options: [{ id: "ok", label: "ادامه", next: "basics" }] },
    basics: {
      id: "basics", kind: "basics", q: "نام و تلفن",
      sub: (_c, s) => (s.acc.source && FOOD_APP_SOURCES.has(s.acc.source) ? "اگر تلفن ندارید خالی بگذارید — اول بازدید می‌شود" : "نام لازم است؛ تلفن اختیاری"),
      options: [{ id: "ok", label: "ادامه", next: (_c, s) => (pinOf(s.values) ? "type" : "loc") }],
    },
    loc: {
      id: "loc", kind: "choice", q: "کسب‌وکار کجاست؟", sub: "بدون مکان ثبت نمی‌شود — برای مسیر و محدوده لازم است",
      options: [
        { id: "gps", label: "اینجا هستم — مکان من", sub: "از GPS گوشی", tone: "rec", next: "pin", set: { pin_mode: "gps" } },
        { id: "map", label: "روی نقشه پیدا می‌کنم", sub: "جستجو و پین", next: "pin", set: { pin_mode: "map" } },
      ],
    },
    pin: {
      id: "pin", kind: "pin", q: "پین درست است؟", sub: "پین را روی درِ ورودی بگذارید؛ اگر فقط محدوده را می‌دانید «تقریبی» را بزنید",
      options: [{ id: "ok", label: "ثبت مکان", tone: "rec", next: "type" }],
    },
    type: {
      id: "type", kind: "choice", q: "چه نوع کسب‌وکاری است؟",
      options: BUSINESS_TYPES.map((t) => ({ id: t, label: BUSINESS_TYPE_LABEL[t], next: "price", set: { business_type: t } })),
    },
    price: {
      id: "price", kind: "choice", q: "سطح قیمت منو؟",
      sub: (_c, s) => (s.acc.source && FOOD_APP_SOURCES.has(s.acc.source) ? `منوی ${LEAD_SOURCE_LABEL[s.acc.source]} را ببینید` : "اگر نمی‌دانید «نمی‌دانم» را بزنید"),
      options: [
        { id: "low", label: PRICE_TIER_LABEL.low, next: "hours", set: { price_tier: "low" } },
        { id: "mid", label: PRICE_TIER_LABEL.mid, next: "hours", set: { price_tier: "mid" } },
        { id: "high", label: PRICE_TIER_LABEL.high, next: "hours", set: { price_tier: "high" } },
        { id: "unknown", label: "نمی‌دانم", next: "hours", set: { price_tier: "unknown" } },
      ],
    },
    hours: {
      id: "hours", kind: "hours", q: "ساعت کاری", sub: "چند بازه در روز هم می‌شود؛ مثلاً ۱۲ تا ۱۶ و ۱۹ تا ۲۴",
      options: [{ id: "ok", label: "ثبت ساعت‌ها", tone: "rec", next: afterHours }, { id: "skip", label: "نمی‌دانم", next: afterHours }],
    },
    assign: {
      id: "assign", kind: "choice", q: "به چه کسی بسپاریم؟", sub: "عدد = سرنخ‌های باز هر فروشنده",
      options: (ctx) => {
        const least = ctx.reps.length ? Math.min(...ctx.reps.map((r) => r.open)) : -1;
        return [
          { id: "me", label: "خودم", next: "first", set: { owner: "me" } },
          ...ctx.reps.map((r) => ({
            id: `u${r.id}`, label: r.name, sub: `${faDigits(String(r.open))} سرنخ باز${r.open === least ? " · کم‌بارتر" : ""}`,
            tone: r.open === least ? ("rec" as const) : undefined, next: "first", set: { owner: r.id },
          })),
          { id: "pool", label: "بی‌صاحب — استخر گروه", sub: "فروشنده‌های گروه برش می‌دارند", next: "first", set: { owner: "pool" } },
        ];
      },
    },
    first: {
      id: "first", kind: "choice", q: "اولین قدم با این سرنخ؟", timeStep: true,
      sub: (_c, s) => (hasPhone(s.values) ? "اولین تماس، سرنخ را تأیید می‌کند" : "تلفن ندارد — اول بازدید می‌شود"),
      options: (_c, s) =>
        hasPhone(s.values)
          ? [
              { id: "call_today", label: "تماس اول · امروز", sub: "پیشنهادی", tone: "rec", save: true, set: { next_title: "تماس اول", next_kind: "call", due: { kind: "in_hours", hours: 1 } } },
              { id: "call_t10", label: "تماس اول · فردا ۱۰:۰۰", save: true, set: { next_title: "تماس اول", next_kind: "call", due: TOMORROW_10 } },
              { id: "visit", label: "بازدید در مسیر بعدی", save: true, set: visitSet("بازدید") },
              talkedNow,
            ]
          : [
              { id: "driver", label: "بازدید راننده در مسیر", sub: "پیشنهادی", tone: "rec", save: true, set: { next_title: "بازدید تأیید", next_kind: "verify_visit", next_assignee: "driver_pool", due: { kind: "tomorrow", hour: 9 } } },
              { id: "self", label: "خودم سر می‌زنم", save: true, set: visitSet("بازدید برای تأیید") },
              talkedNow,
            ],
    },
    skip: SKIP_STEP,
  },
};
