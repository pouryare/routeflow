/* The system-default rows a database is seeded with on every boot (reason codes, capacity factors,
 * rules, notification types, objection cards, KPI definitions, seasonal factors, churn model) and
 * the seed functions that write them. Moved out of lib/db.ts, which re-exports all of it
 * (`export * from "./database/seeds"`), so no import site changes. Every function takes the connection;
 * none of them opens one. */
import type { DatabaseSync } from "node:sqlite";
import { polygonCentroid } from "../simplify";
import type { DistrictGeometry } from "../simplify";

// The two sites the business started from, recovered from the Google Maps links they
// shared: the warehouse link was a place record (املاک طاها) whose coordinates came out
// of Google's own place data, the home link carried an explicit dropped pin.
//
// Seeded rather than hard-coded so the user can edit them, and keyed on `slug` so that
// re-running this -- which happens on every boot, and again after any backup restore --
// neither duplicates a row nor reverts an edit. INSERT OR IGNORE, deliberately not
// INSERT OR REPLACE: REPLACE would silently throw away a repositioned pin on the next
// deploy, which is the exact failure this table exists to prevent.
/** GONE, deliberately: the two facilities this used to insert.
 *
 *  They were the one real company's warehouse and home base, written here by address, with
 *  organization_id pinned to 1 because the app only had one company when they were added.
 *  That is the whole problem in miniature -- a specific business's addresses compiled into
 *  a schema bootstrap, so every tenant that ever ran this got them, and every distance in
 *  the app was measured from a house in Pardis whether or not that was the reader's house.
 *
 *  Every place is now made by a person, through the app. A fresh database has no
 *  facilities at all, which is the honest starting state: the first thing you are asked
 *  is where your warehouse is. Nothing here is invented, so nothing here has to be
 *  migrated when a second tenant arrives.
 *
 *  The remaining seeds in this file are a different category on purpose -- reason codes,
 *  capacity factors, KPI definitions -- all of them system-wide defaults carrying
 *  organization_id NULL, with a tenant free to override. A business's own address is not
 *  a default; it is data. */

export function seedFacilities(): void {
  // Kept as a named no-op so the call site at the bottom of this file, and any external
  // caller of the export, stay valid. Delete it and every caller once they are gone.
}

/** Phase 3: the system-default reason codes every tenant sees (organization_id NULL).
 *  A tenant may add its own rows on top. `INSERT ... SELECT ... WHERE NOT EXISTS` per
 *  row rather than `INSERT OR IGNORE`, because the UNIQUE is on
 *  (organization_id, domain, code) and NULL != NULL under SQLite, so OR IGNORE would
 *  re-insert every boot. */
export const REASON_CODE_SEED: { domain: string; code: string; label_fa: string }[] = [
  { domain: "delivery_fail", code: "CUSTOMER_ABSENT", label_fa: "مشتری در محل نبود" },
  { domain: "delivery_fail", code: "CUSTOMER_REFUSED", label_fa: "مشتری تحویل نگرفت" },
  { domain: "delivery_fail", code: "ADDRESS_NOT_FOUND", label_fa: "آدرس پیدا نشد" },
  { domain: "delivery_fail", code: "SHOP_CLOSED", label_fa: "مغازه تعطیل بود" },
  { domain: "delivery_fail", code: "PAYMENT_DISPUTE", label_fa: "اختلاف بر سر مبلغ" },
  { domain: "delivery_delay", code: "TRAFFIC", label_fa: "ترافیک سنگین" },
  { domain: "delivery_delay", code: "VEHICLE_ISSUE", label_fa: "مشکل خودرو" },
  { domain: "delivery_delay", code: "WEATHER", label_fa: "شرایط جوی" },
  { domain: "order_cancel", code: "CUSTOMER_CANCELLED", label_fa: "مشتری لغو کرد" },
  { domain: "order_cancel", code: "DUPLICATE", label_fa: "سفارش تکراری" },
  { domain: "order_cancel", code: "STOCK_SHORTAGE", label_fa: "نبود موجودی" },
  { domain: "order_return", code: "QUALITY_ISSUE", label_fa: "مشکل کیفی کالا" },
  { domain: "order_return", code: "WRONG_ITEM", label_fa: "کالای اشتباه" },
];

/** Phase 6: the six §4.1 conditions with their measured capacity effect, as NULL-org
 *  defaults. INSERT ... WHERE NOT EXISTS per row (NULL != NULL under SQLite's UNIQUE, so
 *  OR IGNORE would re-insert). A tenant overrides by writing its own (org, code) row. */
export const CAPACITY_FACTOR_SEED: {
  code: string;
  stop: number;
  service: number;
  speed: number;
  duration: number;
  note: string;
}[] = [
  { code: "heavy_rain", stop: 0.8, service: 1.2, speed: 0.85, duration: 1, note: "باران شدید — پارک و تحویل کندتر" },
  { code: "snow_ice", stop: 0.55, service: 1.3, speed: 0.6, duration: 1, note: "برف و یخ‌بندان" },
  { code: "extreme_heat", stop: 0.85, service: 1.15, speed: 1, duration: 0.7, note: "گرمای شدید — سقف زمان مسیر برای زنجیرهٔ سرد" },
  { code: "high_wind", stop: 0.85, service: 1.1, speed: 0.9, duration: 1, note: "باد شدید" },
  { code: "dust_storm", stop: 0.7, service: 1.1, speed: 0.7, duration: 1, note: "گرد و خاک — دید کم" },
  { code: "fog", stop: 0.8, service: 1.05, speed: 0.75, duration: 1, note: "مه — دید کم" },
];

/** Phase 7: a handful of NULL-org default rules. INSERT ... WHERE NOT EXISTS per row
 *  (NULL != NULL under SQLite's UNIQUE). A tenant overrides by writing its own
 *  (org, code) row. */
export const RULE_SEED: {
  code: string;
  name: string;
  trigger_kind: string;
  condition_json: string | null;
  action_kind: string;
  action_json: string;
  cooldown_min: number;
  escalate_after_min: number | null;
  escalate_to_role: string | null;
}[] = [
  {
    code: "credit_approval_waiting",
    name: "درخواست اعتبار معطل",
    trigger_kind: "sweep",
    condition_json: null,
    action_kind: "alert",
    action_json: JSON.stringify({ severity: "critical", category: "credit", title: "درخواست اعتبار در انتظار تصمیم" }),
    cooldown_min: 60,
    escalate_after_min: 240,
    escalate_to_role: "owner",
  },
  {
    code: "delivery_failed_retry",
    name: "تحویل ناموفق — پیگیری",
    trigger_kind: "delivery.failed",
    condition_json: null,
    action_kind: "task",
    action_json: JSON.stringify({ role_hint: "group_manager", priority: "HIGH", title: "پیگیری تحویل ناموفق", kind: "delivery_retry" }),
    cooldown_min: 720,
    escalate_after_min: null,
    escalate_to_role: null,
  },
  {
    code: "customer_overdue",
    name: "مشتری معوق",
    trigger_kind: "sweep",
    condition_json: null,
    action_kind: "task",
    action_json: JSON.stringify({ role_hint: "phone_sales", priority: "NORMAL", title: "تماس با مشتری معوق", kind: "call" }),
    cooldown_min: 2880,
    escalate_after_min: null,
    escalate_to_role: null,
  },
  {
    code: "expiring_batch",
    name: "سری ساخت رو به انقضا",
    trigger_kind: "sweep",
    condition_json: null,
    action_kind: "alert",
    action_json: JSON.stringify({ severity: "warning", category: "stock", title: "سری ساخت رو به انقضا با موجودی" }),
    cooldown_min: 1440,
    escalate_after_min: null,
    escalate_to_role: null,
  },
  {
    code: "sample_followup",
    name: "پیگیری نمونه",
    trigger_kind: "sweep",
    condition_json: null,
    action_kind: "task",
    action_json: JSON.stringify({ role_hint: "phone_sales", priority: "NORMAL", title: "پیگیری نمونه", kind: "sample_followup" }),
    cooldown_min: 4320,
    escalate_after_min: null,
    escalate_to_role: null,
  },

  // Phase 1 notifications: one `notify` rule per event kind that should reach a person's
  // feed. action_json.notification_type names the row in NOTIFICATION_TYPE_SEED; recipient
  // resolution lives in lib/repo/notifications.recipientsFor. cooldown_min: 1 so a genuine
  // duplicate within the same minute is still absorbed while the feed is not throttled.
  { code: "notify_task_assigned",          name: "اعلان: کار سپرده‌شده",   trigger_kind: "task.assigned",       condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "task.assigned" }),      cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_confirmed",        name: "اعلان: تأیید سفارش",      trigger_kind: "order.passReview",     condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.confirmed" }),     cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_confirmed_credit", name: "اعلان: تأیید سفارش (اعتبار)", trigger_kind: "order.approveCredit", condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.confirmed" }),     cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_rejected",         name: "اعلان: لغو سفارش",        trigger_kind: "order.cancel",         condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.rejected" }),      cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_created",          name: "اعلان: سفارش تازه",       trigger_kind: "order.submit",         condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.created" }),       cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_delivery_succeeded",     name: "اعلان: تحویل موفق",      trigger_kind: "delivery.succeeded",   condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "delivery.succeeded" }),  cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_delivery_failed",        name: "اعلان: تحویل ناموفق",    trigger_kind: "delivery.failed",      condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "delivery.failed" }),     cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_payment_recorded",       name: "اعلان: ثبت پرداخت",       trigger_kind: "payment.recorded",     condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "payment.recorded" }),    cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },

  // Phase 2 loud-channel rules. notify_task_escalated fires through runEventRules on the
  // task.escalated event; the other four are trigger_kind 'sweep' -- a later task adds
  // consider("<code>", ...) calls in runSweepRules, and consider() only fires 'sweep'
  // rules. Longer cooldowns on the sweep-fed rules because a sweep re-evaluates the same
  // overdue customer / due cheque every tick; liveRun dedupe + this cooldown keep it to
  // one notification per entity per day.
  { code: "notify_task_escalated",          name: "اعلان: ارجاع کار",         trigger_kind: "task.escalated", condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "task.escalated" }),          cooldown_min: 1,    escalate_after_min: null, escalate_to_role: null },
  { code: "notify_credit_approval_waiting", name: "اعلان: انتظار تأیید اعتبار", trigger_kind: "sweep",          condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "credit_approval.waiting" }), cooldown_min: 60,   escalate_after_min: null, escalate_to_role: null },
  { code: "notify_customer_overdue",        name: "اعلان: مشتری عقب‌افتاده",   trigger_kind: "sweep",          condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "customer.overdue" }),        cooldown_min: 1440, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_cheque_due_soon",         name: "اعلان: سررسید چک",         trigger_kind: "sweep",          condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "cheque.due_soon" }),         cooldown_min: 1440, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_reminder_due",            name: "اعلان: یادآوری",           trigger_kind: "sweep",          condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "reminder.due" }),            cooldown_min: 1440, escalate_after_min: null, escalate_to_role: null },
];

export function seedRules(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO rules
       (organization_id, code, name, trigger_kind, condition_json, action_kind, action_json,
        cooldown_min, escalate_after_min, escalate_to_role, active, created_at, updated_at)
     SELECT NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM rules WHERE organization_id IS NULL AND code = ?)`
  );
  for (const r of RULE_SEED) {
    insert.run(
      r.code,
      r.name,
      r.trigger_kind,
      r.condition_json,
      r.action_kind,
      r.action_json,
      r.cooldown_min,
      r.escalate_after_min,
      r.escalate_to_role,
      now,
      now,
      r.code
    );
  }
}

export interface NotificationTypeSeed {
  code: string;
  name_fa: string;
  category: string;
  directedness: "directed" | "ambient";
  priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
  group_scope: "entity" | "type_day";
}

const PRIORITY_RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };

/** The spec's loud-by-default rule, stored on each catalogue row for the settings hint.
 *  A directed notification (aimed at one person) goes loud from NORMAL up; an ambient one
 *  (a group feed item) only goes loud at CRITICAL. */
export function loudByDefault(directedness: string, priority: string): 0 | 1 {
  if (directedness === "directed") return PRIORITY_RANK[priority] >= PRIORITY_RANK.NORMAL ? 1 : 0;
  return priority === "CRITICAL" ? 1 : 0;
}

/** The Phase 1 catalogue, NULL-org, plus the Phase 2 loud-channel additions. Same
 *  INSERT ... WHERE NOT EXISTS treatment as RULE_SEED / OBJECTION_CARD_SEED. Recipient
 *  wiring lives in lib/repo/notifications.ts; default_push / default_telegram are derived
 *  from loudByDefault(directedness, priority) at seed time, not stored on the literal. */
export const NOTIFICATION_TYPE_SEED: NotificationTypeSeed[] = [
  { code: "task.assigned",      name_fa: "کاری به شما سپرده شد",      category: "task",     directedness: "directed", priority: "HIGH",   group_scope: "entity" },
  { code: "order.confirmed",    name_fa: "سفارش شما تأیید شد",         category: "order",    directedness: "directed", priority: "NORMAL", group_scope: "entity" },
  { code: "order.rejected",     name_fa: "سفارش شما رد/لغو شد",        category: "order",    directedness: "directed", priority: "HIGH",   group_scope: "entity" },
  { code: "order.created",      name_fa: "سفارش تازه در گروه",         category: "order",    directedness: "ambient",  priority: "NORMAL", group_scope: "type_day" },
  { code: "delivery.succeeded", name_fa: "تحویل موفق",                 category: "delivery", directedness: "directed", priority: "NORMAL", group_scope: "type_day" },
  { code: "delivery.failed",    name_fa: "تحویل ناموفق",              category: "delivery", directedness: "directed", priority: "HIGH",   group_scope: "entity" },
  { code: "payment.recorded",   name_fa: "پرداخت روی سفارش شما ثبت شد", category: "finance",  directedness: "directed", priority: "NORMAL", group_scope: "entity" },
  { code: "task.escalated",          name_fa: "کار به شما ارجاع شد",        category: "task",     directedness: "directed", priority: "CRITICAL", group_scope: "entity" },
  { code: "credit_approval.waiting", name_fa: "تأیید اعتبار در انتظار شماست", category: "finance",  directedness: "directed", priority: "HIGH",     group_scope: "entity" },
  { code: "customer.overdue",        name_fa: "مشتری شما عقب‌افتاده است",     category: "customer", directedness: "directed", priority: "NORMAL",   group_scope: "entity" },
  { code: "cheque.due_soon",         name_fa: "سررسید چک نزدیک است",         category: "finance",  directedness: "directed", priority: "HIGH",     group_scope: "entity" },
  { code: "reminder.due",            name_fa: "یادآوری سررسید",              category: "task",     directedness: "directed", priority: "NORMAL",   group_scope: "type_day" },
  { code: "system.test",             name_fa: "پیام آزمایشی",                category: "task",     directedness: "directed", priority: "NORMAL",   group_scope: "entity" },
];

export function seedNotificationTypes(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO notification_types
       (organization_id, code, name_fa, category, directedness, priority, group_scope,
        default_push, default_telegram, active, created_at, updated_at)
     SELECT NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM notification_types WHERE organization_id IS NULL AND code = ?)`
  );
  // Phase 2 backfill: the NULL-org catalogue rows are shipped defaults (tenants override
  // with their own rows), so force default_push / default_telegram to the canonical
  // loudByDefault value on every boot. This catches the 6 Phase-1 rows that predate the
  // columns and would otherwise keep the ALTER's DEFAULT 0; on a fresh DB it is a no-op
  // right after the INSERT. organization_id IS NOT NULL rows are never touched.
  const backfill = db.prepare(
    `UPDATE notification_types SET default_push = ?, default_telegram = ?, updated_at = ?
      WHERE organization_id IS NULL AND code = ?`
  );
  for (const t of NOTIFICATION_TYPE_SEED) {
    const loud = loudByDefault(t.directedness, t.priority);
    insert.run(t.code, t.name_fa, t.category, t.directedness, t.priority, t.group_scope, loud, loud, now, now, t.code);
    backfill.run(loud, loud, now, t.code);
  }
}

/** Phase 8: starter objection cards, NULL-org. Keyed to the outcome codes the /start
 *  TaskRow emits plus a few classics. INSERT ... WHERE NOT EXISTS per row. */
export const OBJECTION_CARD_SEED: {
  outcome_code: string;
  title_fa: string;
  script_fa: string;
  module_slug: string;
}[] = [
  { outcome_code: "PRICE_OBJECTION", title_fa: "«گران است»", script_fa: "قیمت را به مصرف هر پرس برگردانید: «کره در هر پرس حدود X تومان می‌شود؛ تفاوتش با مارک ارزان‌تر در ماه Y تومان است، اما برگشتی و شکایت مشتری شما را کم می‌کند.» بعد یک نمونهٔ رایگان پیشنهاد دهید.", module_slug: "02-phone-sales" },
  { outcome_code: "NOT_INTERESTED", title_fa: "«علاقه‌ای ندارم»", script_fa: "روی زمان‌بندی کار کنید، نه محصول: «کاملاً درست است، الان وقت خوبی نیست. اجازه بدهید فقط یک نمونه بگذارم و هفتهٔ بعد اگر خواستید یک تماس کوتاه بگیریم.» فشار نیاورید؛ در دفترچه یادداشت کنید و در بازهٔ بعدی برگردید.", module_slug: "01-market-and-customer" },
  { outcome_code: "NO_TIME", title_fa: "«الان وقت ندارم»", script_fa: "«حتماً، ۳۰ ثانیه بیشتر نمی‌گیرم — فقط می‌خواستم بگویم این هفته نمونهٔ کره داریم؛ کی برای‌تان بیاورم، امروز یا فردا؟» یک انتخاب دوگزینه‌ای بدهید.", module_slug: "02-phone-sales" },
  { outcome_code: "ALREADY_SUPPLIED", title_fa: "«تأمین‌کننده دارم»", script_fa: "«عالی است که یک تأمین‌کنندهٔ ثابت دارید. بیشتر مشتری‌های ما هم دارند و ما را برای روزهایی نگه می‌دارند که آن‌ها جنس ندارند یا دیر می‌رسانند. یک نمونه بگذارم که مقایسه دستتان باشد؟»", module_slug: "01-market-and-customer" },
  { outcome_code: "QUALITY_DOUBT", title_fa: "«کیفیتش را نمی‌شناسم»", script_fa: "روی قابلیت ردیابی تکیه کنید: «هر سری ساخت ما تاریخ تولید و انقضا دارد و ما دقیقاً می‌دانیم هر جعبه به کدام مغازه رفته. یک نمونه بگذارم، خودتان روی یک غذا امتحان کنید.»", module_slug: "01-market-and-customer" },
  { outcome_code: "PAYMENT_TERMS", title_fa: "«نقدی نمی‌خرم»", script_fa: "«مشکلی نیست، برای مشتری‌های ثابت مهلت تسویه داریم. سفارش اول را نقد بگیریم که آشنا شویم، از سفارش دوم روی چک یا مهلت هفتگی می‌رویم.»", module_slug: "02-phone-sales" },
  { outcome_code: "CONTACTED", title_fa: "پیگیری تماس بی‌نتیجه", script_fa: "یک تماس بدون سفارش، شکست نیست. تاریخ تماس بعدی را همین حالا در دفترچه بگذارید (۳ تا ۷ روز)، و یک بهانهٔ تماس تازه آماده کنید: نمونهٔ جدید، تخفیف مناسبتی، یا محصول تازه.", module_slug: "02-phone-sales" },
  { outcome_code: "ORDERED", title_fa: "بعد از اولین خرید", script_fa: "روز تحویل یک تماس کوتاه بگیرید: «کره به دستتان رسید؟ راضی بودید؟» و بازهٔ سفارش بعدی را پیشنهاد بدهید. اولین خرید تازه شروع رابطه است.", module_slug: "01-market-and-customer" },
];

export function seedObjectionCards(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO objection_cards
       (organization_id, outcome_code, customer_type, title_fa, script_fa, module_slug, active, updated_at)
     SELECT NULL, ?, NULL, ?, ?, ?, 1, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM objection_cards
         WHERE organization_id IS NULL AND outcome_code = ? AND customer_type IS NULL
      )`
  );
  for (const c of OBJECTION_CARD_SEED) {
    insert.run(c.outcome_code, c.title_fa, c.script_fa, c.module_slug, now, c.outcome_code);
  }
}

/** Phase 9: the Tier-1 KPI registry, NULL-org. One row per metric in
 *  lib/analysis/metrics.METRICS, each carrying the seven attributes the source (§6)
 *  says a KPI needs to be a management figure rather than a report. INSERT ... WHERE
 *  NOT EXISTS per row, the reason_codes treatment. */
export const KPI_DEFINITION_SEED: {
  metric: string;
  title_fa: string;
  definition_fa: string;
  formula_fa: string;
  owner_role: string;
  benchmark_fa: string;
  frequency: "daily" | "weekly" | "monthly";
  action_fa: string;
  tier: number;
  direction: "up" | "down";
}[] = [
  {
    metric: "net_sales",
    title_fa: "فروش خالص",
    definition_fa: "ارزش کالای تحویل‌شده در دورهٔ جاری، به قیمت فروش ثبت‌شده روی سطر سفارش، پس از کسر برگشتی.",
    formula_fa: "Σ (تعداد تحویل‌شدهٔ هر سطر × قیمت واحد آن سطر) روی سفارش‌های تحویل‌شده",
    owner_role: "group_manager",
    benchmark_fa: "رشد ماهانهٔ ۵٪ تا ۱۰٪ در سال اول",
    frequency: "daily",
    action_fa: "اگر زیر هدف است، دکمهٔ «چرا؟» را بزنید و افت را تا سطح فروشنده و مرحلهٔ قیف دنبال کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "gross_profit",
    title_fa: "سود ناخالص",
    definition_fa: "فروش خالص منهای بهای تمام‌شدهٔ کالای همان سفارش‌ها (از قیمت خرید سری ساخت).",
    formula_fa: "فروش خالص − Σ (تعداد تحویل‌شده × بهای واحد سری ساخت)",
    owner_role: "owner",
    benchmark_fa: "متناسب با حاشیهٔ هدف؛ نباید کندتر از فروش رشد کند",
    frequency: "weekly",
    action_fa: "اگر فروش بالا می‌رود ولی سود نه، ترکیب فروش کالاها و تخفیف‌ها را در بخش «حاشیهٔ مشارکتی» بررسی کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "gross_margin",
    title_fa: "حاشیهٔ سود ناخالص",
    definition_fa: "سهم سود ناخالص از فروش خالص، به‌صورت درصد.",
    formula_fa: "سود ناخالص ÷ فروش خالص",
    owner_role: "owner",
    benchmark_fa: "۱۸٪ تا ۲۵٪ برای توزیع کره",
    frequency: "weekly",
    action_fa: "افت حاشیه یعنی تخفیف زیاد یا رشد فروش کالای کم‌سود؛ سیاست قیمت و سبد فروشنده را مرور کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "orders",
    title_fa: "تعداد سفارش",
    definition_fa: "شمار سفارش‌هایی که در دوره به وضعیت تحویل‌شده رسیده‌اند.",
    formula_fa: "COUNT(سفارش‌های تحویل‌شده در دوره)",
    owner_role: "group_manager",
    benchmark_fa: "روند صعودی هم‌راستا با تعداد مشتری فعال",
    frequency: "daily",
    action_fa: "افت هم‌زمان با فروش یعنی مشکل تقاضا؛ افت بدون افت فروش یعنی سفارش‌ها بزرگ‌تر شده‌اند.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "aov",
    title_fa: "میانگین ارزش سفارش",
    definition_fa: "فروش خالص دوره تقسیم بر تعداد سفارش تحویل‌شدهٔ همان دوره.",
    formula_fa: "فروش خالص ÷ تعداد سفارش",
    owner_role: "group_manager",
    benchmark_fa: "رشد آرام از طریق فروش مکمل، نه تخفیف حجمی",
    frequency: "weekly",
    action_fa: "برای رشد، فروش مکمل (کارت فرصت در مرکز اقدام) را روی مشتری‌های تک‌کالا اجرا کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "active_customers",
    title_fa: "مشتری فعال",
    definition_fa: "مشتری‌ای که در ۶۰ روز گذشته دست‌کم یک سفارش تأییدشده داشته است (تعریف واژه‌نامهٔ داده).",
    formula_fa: "COUNT(مشتری با ≥۱ سفارش تأییدشده در ۶۰ روز اخیر)",
    owner_role: "group_manager",
    benchmark_fa: "بیش از ۷۰٪ کل مشتری‌های ثبت‌شدهٔ منطقه",
    frequency: "weekly",
    action_fa: "ریزش این عدد را با فهرست «مشتری در خطر» در مرکز اقدام تطبیق دهید و تماس بگیرید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "new_customers",
    title_fa: "مشتری جدید",
    definition_fa: "مشتری‌ای که اولین سفارش تاریخ‌اش (نه اولین سفارش در بازهٔ گزارش) در این دوره است.",
    formula_fa: "COUNT(مشتری با MIN(تاریخ سفارش) داخل دوره)",
    owner_role: "phone_sales",
    benchmark_fa: "متناسب با تعداد نمونهٔ گذاشته‌شده و نرخ تبدیل نمونه",
    frequency: "monthly",
    action_fa: "اگر کم است، تعداد نمونهٔ فعال و پیگیری نمونه را بررسی کنید؛ ورودی قیف مشکل دارد.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "lost_customers",
    title_fa: "مشتری از‌دست‌رفته",
    definition_fa: "مشتری‌ای که ابتدای دوره فعال بوده و تا پایان دوره ۶۰ روز بدون سفارش مانده است.",
    formula_fa: "COUNT(فعال در ابتدای دوره ∧ بدون سفارش در ۶۰ روز منتهی به پایان دوره)",
    owner_role: "group_manager",
    benchmark_fa: "کمتر از ۵٪ پایگاه مشتری در ماه",
    frequency: "monthly",
    action_fa: "هر مورد را به‌عنوان یک کار تماس به فروشندهٔ همان مشتری بسپارید و علت را در کد نتیجه ثبت کنید.",
    tier: 1,
    direction: "down",
  },
  {
    metric: "repeat_rate",
    title_fa: "نرخ خرید تکرارشونده",
    definition_fa: "سهم مشتری‌هایی که در دوره دست‌کم دو سفارش داشته‌اند از مشتری‌هایی که دست‌کم یک سفارش داشته‌اند.",
    formula_fa: "COUNT(مشتری با ≥۲ سفارش در دوره) ÷ COUNT(مشتری با ≥۱ سفارش در دوره)",
    owner_role: "phone_sales",
    benchmark_fa: "بیش از ۶۰٪ برای کالای مصرفی پرگردش",
    frequency: "monthly",
    action_fa: "نرخ پایین یعنی مشکل کیفیت یا پیگیری؛ تماس روز تحویل و بازهٔ سفارش بعدی را جدی بگیرید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "collection_rate",
    title_fa: "نرخ وصول",
    definition_fa: "نسبت مبلغ دریافت‌شده در دوره به ارزش کالای تحویل‌شدهٔ همان دوره.",
    formula_fa: "Σ دریافت‌های دوره ÷ فروش خالص دوره",
    owner_role: "owner",
    benchmark_fa: "بالای ۹۰٪؛ زیر ۸۰٪ یعنی خطر نقدینگی",
    frequency: "weekly",
    action_fa: "با فهرست «مطالبات معوق» مرکز اقدام شروع کنید و چک‌های سررسیدشده را پیگیری کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "overdue_receivables",
    title_fa: "مطالبات معوق",
    definition_fa: "جمع بدهی مشتریان که بیش از ۳۰ روز از تحویل سفارش پرداخت‌نشده مانده است، در پایان دوره.",
    formula_fa: "Σ بدهی مشتری در سطل «بیش از ۳۰ روز»",
    owner_role: "owner",
    benchmark_fa: "کمتر از ۱۰٪ کل مطالبات باز",
    frequency: "weekly",
    action_fa: "سقف اعتبار مشتری‌های بدحساب را ببندید و تا تسویه، سفارش نقدی کنید.",
    tier: 1,
    direction: "down",
  },
  {
    metric: "on_time_delivery",
    title_fa: "تحویل به‌موقع",
    definition_fa: "سهم سفارش‌هایی که در تاریخ برنامه‌ریزی‌شده یا زودتر تحویل شده‌اند از کل سفارش‌های تحویل‌شده.",
    formula_fa: "COUNT(تاریخ تحویل ≤ تاریخ برنامه) ÷ COUNT(تحویل‌شده)",
    owner_role: "group_manager",
    benchmark_fa: "بالای ۹۵٪",
    frequency: "daily",
    action_fa: "افت را با «امتیاز راننده» و شرایط جوی مسیر تطبیق دهید؛ ظرفیت مسیر را بازبینی کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "fulfillment_rate",
    title_fa: "نرخ تکمیل سفارش",
    definition_fa: "سهم تعداد تحویل‌شده از تعداد سفارش‌داده‌شده، روی سفارش‌هایی که به مرحلهٔ قیمت‌گذاری رسیده‌اند.",
    formula_fa: "Σ تعداد تحویل‌شدهٔ سطرها ÷ Σ تعداد سفارش‌دادهٔ سطرها",
    owner_role: "group_manager",
    benchmark_fa: "بالای ۹۸٪ برای کالای موجود",
    frequency: "daily",
    action_fa: "کسری مکرر یعنی مشکل موجودی یا بارگیری؛ هشدار کمبود موجودی و نرخ پرشدن راننده را ببینید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "sample_conversion",
    title_fa: "نرخ تبدیل نمونه",
    definition_fa: "سهم سفارش‌های نمونه که ظرف ۳۰ روز یک سفارش عادی از همان مشتری به دنبال داشته‌اند.",
    formula_fa: "COUNT(نمونه با سفارش عادی بعدی ظرف ۳۰ روز) ÷ COUNT(سفارش نمونه)",
    owner_role: "phone_sales",
    benchmark_fa: "بالای ۳۰٪",
    frequency: "monthly",
    action_fa: "نرخ پایین یعنی پیگیری نمونه ضعیف است؛ کار «پیگیری نمونه» را سر وقت ببندید و کارت اعتراض را بخوانید.",
    tier: 1,
    direction: "up",
  },
];

export function seedKpiDefinitions(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO kpi_definitions
       (organization_id, metric, title_fa, definition_fa, formula_fa, owner_role,
        benchmark_fa, frequency, action_fa, tier, direction, updated_at)
     SELECT NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM kpi_definitions WHERE organization_id IS NULL AND metric = ?
      )`
  );
  for (const d of KPI_DEFINITION_SEED) {
    insert.run(
      d.metric,
      d.title_fa,
      d.definition_fa,
      d.formula_fa,
      d.owner_role,
      d.benchmark_fa,
      d.frequency,
      d.action_fa,
      d.tier,
      d.direction,
      now,
      d.metric
    );
  }
}

/** Phase 10: the shipped season shape — a mild guess, mean-normalised to ~1 across
 *  each cycle. The whole point of the cold-start rule is that a brand-new tenant
 *  forecasts off this until it has a year of its own months. 12 Jalali-month factors
 *  (Farvardin=1 … a Nowruz lift, an Esfand run-up, a mid-summer dip) + 7 day-of-week
 *  factors (Saturday=0, a Thursday/Friday drop for a wholesale week). */
export const SEASONAL_FACTOR_SEED: { kind: "month" | "dow"; idx: number; factor: number }[] = [
  { kind: "month", idx: 1, factor: 1.12 },
  { kind: "month", idx: 2, factor: 1.05 },
  { kind: "month", idx: 3, factor: 1.0 },
  { kind: "month", idx: 4, factor: 0.95 },
  { kind: "month", idx: 5, factor: 0.9 },
  { kind: "month", idx: 6, factor: 0.9 },
  { kind: "month", idx: 7, factor: 0.95 },
  { kind: "month", idx: 8, factor: 1.0 },
  { kind: "month", idx: 9, factor: 1.03 },
  { kind: "month", idx: 10, factor: 1.03 },
  { kind: "month", idx: 11, factor: 1.07 },
  { kind: "month", idx: 12, factor: 1.0 },
  { kind: "dow", idx: 0, factor: 1.15 }, // Saturday — week opens
  { kind: "dow", idx: 1, factor: 1.15 }, // Sunday
  { kind: "dow", idx: 2, factor: 1.1 }, // Monday
  { kind: "dow", idx: 3, factor: 1.05 }, // Tuesday
  { kind: "dow", idx: 4, factor: 1.0 }, // Wednesday
  { kind: "dow", idx: 5, factor: 0.75 }, // Thursday
  { kind: "dow", idx: 6, factor: 0.6 }, // Friday — mostly closed
];

export function seedSeasonalFactors(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO seasonal_factors (organization_id, kind, idx, factor, updated_at)
     SELECT NULL, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM seasonal_factors WHERE organization_id IS NULL AND kind = ? AND idx = ?
      )`
  );
  for (const r of SEASONAL_FACTOR_SEED) {
    insert.run(r.kind, r.idx, r.factor, now, r.kind, r.idx);
  }
}

/** Phase 10: the shipped churn weight vector — recency-dominated, so a brand-new tenant
 *  gets a sensible "silent past their own cadence = likely gone" score before it has a
 *  single lapse to learn from. trend is entered centred at 1 (see lib/predict/churn). */
export const CHURN_MODEL_SEED = {
  bias: -1.2,
  recency_ratio: 1.1,
  trend: -0.8,
  tenure_months: -0.3,
  complaints_90d: 0.5,
  overdue_ratio: 0.7,
};

export function seedChurnModel(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO churn_models (organization_id, weights_json, n_obs, updated_at)
     SELECT NULL, ?, 0, ?
      WHERE NOT EXISTS (SELECT 1 FROM churn_models WHERE organization_id IS NULL)`
  ).run(JSON.stringify(CHURN_MODEL_SEED), now);
}

export function seedCapacityFactors(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO capacity_factors
       (organization_id, condition_code, stop_factor, service_time_factor, speed_factor,
        max_duration_factor, note_fa, active, updated_at)
     SELECT NULL, ?, ?, ?, ?, ?, ?, 1, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM capacity_factors WHERE organization_id IS NULL AND condition_code = ?
      )`
  );
  for (const r of CAPACITY_FACTOR_SEED) {
    insert.run(r.code, r.stop, r.service, r.speed, r.duration, r.note, now, r.code);
  }
}

export function seedReasonCodes(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO reason_codes (organization_id, domain, code, label_fa, active, created_at)
     SELECT NULL, ?, ?, ?, 1, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM reason_codes
         WHERE organization_id IS NULL AND domain = ? AND code = ?
      )`
  );
  for (const r of REASON_CODE_SEED) {
    insert.run(r.domain, r.code, r.label_fa, now, r.domain, r.code);
  }
}

/** Fills in centroids for districts that have none. Runs on every boot but only touches
 *  rows still NULL, so the ~600KB geometry read happens once after the migration (and
 *  again only for newly drawn districts) rather than on every start.
 *
 *  A district whose geometry cannot produce a centroid is left NULL rather than given a
 *  fake one: NULL sorts to the end of a distance ranking, a wrong coordinate does not. */
export function backfillDistrictCentroids(db: DatabaseSync): void {
  const pending = db
    .prepare("SELECT id, boundary_geojson FROM districts WHERE centroid_lat IS NULL AND boundary_geojson IS NOT NULL")
    .all() as unknown as { id: number; boundary_geojson: string }[];
  if (pending.length === 0) return;

  const update = db.prepare("UPDATE districts SET centroid_lat = ?, centroid_lng = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const row of pending) {
      let centroid: { lat: number; lng: number } | null = null;
      try {
        centroid = polygonCentroid(JSON.parse(row.boundary_geojson) as DistrictGeometry);
      } catch {
        centroid = null; // malformed geometry -- leave it NULL, see the doc comment
      }
      if (centroid) update.run(centroid.lat, centroid.lng, row.id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
