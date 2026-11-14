/* How the audit record reads to a person (docs/plans/event-architecture-2026-11-12.md E4): Persian names
 * for the audited tables and columns, and one line per change. Pure, so it is tested without a database. */

import { ROLE_LABEL, type Role } from "@/lib/roles";
import { ORDER_STATUS_LABEL } from "@/lib/orderStateMachine";
import { LIFECYCLE_LABEL } from "@/lib/types";

export const AUDIT_TABLES: Record<string, string> = {
  orders: "سفارش",
  order_lines: "ردیف سفارش",
  payments: "دریافت",
  customers: "مشتری",
  users: "کاربر",
  product_prices: "قیمت کالا",
  organizations: "تنظیمات شرکت",
  groups: "گروه",
  commission_rates: "نرخ پورسانت",
  storages: "فضای ذخیره‌سازی",
  fiscal_periods: "ماه حسابداری",
};

const COLUMNS: Record<string, string> = {
  status: "وضعیت",
  reopen_reason: "دلیل بازکردن ماه",
  total_toman: "جمع (تومان)",
  discount_toman: "تخفیف (تومان)",
  group_id: "گروه",
  salesperson_user_id: "فروشنده",
  customer_id: "مشتری",
  credit_hold: "توقف اعتباری",
  credit_override_by: "تأییدکنندهٔ اعتبار",
  order_type: "نوع سفارش",
  unit_price_toman: "قیمت واحد (تومان)",
  packs_ordered: "تعداد سفارش",
  packs_delivered: "تعداد تحویل",
  product_id: "کالا",
  packaging_id: "بسته‌بندی",
  amount_toman: "مبلغ (تومان)",
  method: "روش",
  voided_at: "زمان ابطال",
  voided_by: "ابطال‌کننده",
  void_reason: "دلیل ابطال",
  cheque_id: "چک",
  owner_user_id: "مالک",
  credit_limit_toman: "سقف اعتبار (تومان)",
  hard_credit_block: "مسدودی اعتبار",
  payment_terms_days: "مهلت پرداخت (روز)",
  payment_terms_kind: "نوع پرداخت",
  price_tier: "ردهٔ قیمت",
  lifecycle: "مرحلهٔ مشتری",
  customer_type: "نوع مشتری",
  business_name: "نام کسب‌وکار",
  phone: "تلفن",
  parent_customer_id: "مشتری مادر",
  username: "نام کاربری",
  role: "نقش",
  active: "فعال",
  must_change_password: "تغییر اجباری رمز",
  price_toman: "قیمت (تومان)",
  valid_from: "از تاریخ",
  name: "نام",
  discount_auto_pass_pct: "تخفیف بدون تأیید (٪)",
  discount_commission_pct: "سهم تخفیف از پورسانت (٪)",
  step_up_required: "کد دومرحله‌ای برای کارهای حساس",
  task_push_minutes: "یادآوری کار (دقیقه پیش از موعد)",
  order_prefix: "پیشوند شمارهٔ سفارش",
  idle_signout_json: "خروج خودکار بی‌فعالیت",
  stalled_order_days: "سفارش گیرکرده (روز)",
  quiet_customer_days: "مشتری ساکت (روز)",
  data_ageing_days: "داده در حال کهنه شدن (روز)",
  data_stale_days: "داده کهنه (روز)",
  leftover_limit_toman: "سقف بستن مانده کوچک (تومان)",
  refund_limit_toman: "سقف پرداخت نقدی برگشت (تومان)",
  order_approval_limit_toman: "سقف سفارش بدون تأیید (تومان)",
  carton_nudge_percent: "یادآوری تکمیل کارتن (درصد)",
  min_order_toman: "حداقل مبلغ سفارش (تومان)",
  approval_owner_limit_toman: "سقف تأیید مدیر گروه بدون مالک (تومان)",
  expense_claim_limit_toman: "سقف تأیید هزینهٔ کارکنان (تومان)",
  duplicate_order_hours: "هشدار سفارش تکراری (ساعت)",
  staff_loan_limit_toman: "سقف مساعده و وام هر نفر (تومان)",
  loan_reminder_days: "یادآوری وام بدون بازپرداخت (روز)",
  undo_own_minutes: "مهلت باطل کردن دریافت توسط خودِ ثبت‌کننده (دقیقه)",
  plan: "طرح",
  maintenance_from: "شروع تعمیر",
  maintenance_to: "پایان تعمیر",
  can_teach: "مربی",
  totp_enabled_at: "ورود دومرحله‌ای",
  rate_per_kg_toman: "نرخ هر کیلو (تومان)",
  urgent_rate_per_kg_toman: "نرخ فوری هر کیلو (تومان)",
  kind: "نوع",
  endpoint: "نشانی",
  bucket: "سطل",
};

/** Columns that hold the id of another record, and which kind it is: the card shows its name, not «۱۷». */
const REF_KIND: Record<string, RefKind> = {
  group_id: "group",
  salesperson_user_id: "user",
  owner_user_id: "user",
  credit_override_by: "user",
  voided_by: "user",
  customer_id: "customer",
  parent_customer_id: "customer",
  product_id: "product",
  packaging_id: "packaging",
};
type RefKind = "user" | "group" | "customer" | "product" | "packaging";

/** Names of the records a change mentions, by kind then id; built from the database by lib/repo/auditLog.ts. */
export type AuditNames = Partial<Record<RefKind, Map<number, string>>>;

/** Columns that are really yes or no, stored as 0 and 1. */
const YES_NO = new Set(["active", "hard_credit_block", "credit_hold", "must_change_password", "can_teach", "step_up_required"]);
/** A column that is a date-time that was set or cleared: the card says «روشن» or «خاموش», not the time. */
const SWITCH = new Set(["totp_enabled_at"]);

/** The ids a change mentions, so the repo can look their names up in one query per kind. */
export function auditRefs(changesJson: string): { kind: RefKind; id: number }[] {
  const out: { kind: RefKind; id: number }[] = [];
  try {
    const ch = JSON.parse(changesJson) as Record<string, { old?: unknown; new?: unknown }>;
    for (const [col, v] of Object.entries(ch)) {
      const kind = REF_KIND[col];
      if (!kind) continue;
      for (const x of [v.old, v.new]) if (typeof x === "number") out.push({ kind, id: x });
    }
  } catch {
    /* unreadable JSON has no references */
  }
  return out;
}

const OPS: Record<string, string> = { insert: "ساخته شد", update: "تغییر کرد", delete: "حذف شد" };

export const auditOp = (op: string) => OPS[op] ?? op;
export const auditTable = (t: string) => AUDIT_TABLES[t] ?? t;
const auditColumn = (c: string) => COLUMNS[c] ?? c;

const dash = "—";

/** One value as a person reads it: a name for an id, «بله»/«خیر» for a switch, a Persian label for a role, a status or a stage. */
function show(col: string, v: unknown, names?: AuditNames): string {
  if (v === null || v === undefined || v === "") return SWITCH.has(col) ? "خاموش" : dash;
  if (SWITCH.has(col)) return "روشن";
  if (YES_NO.has(col)) return v === true || v === 1 || v === "1" ? "بله" : "خیر";
  if (typeof v === "boolean") return v ? "بله" : "خیر";
  const kind = REF_KIND[col];
  if (kind && typeof v === "number") return names?.[kind]?.get(v) ?? `#${v}`;
  if (col === "role") return ROLE_LABEL[v as Role] ?? String(v);
  if (col === "status") return (ORDER_STATUS_LABEL as Record<string, string>)[String(v)] ?? String(v);
  if (col === "lifecycle") return (LIFECYCLE_LABEL as Record<string, string>)[String(v)] ?? String(v);
  return String(v);
}

/** «سقف اعتبار (تومان): 1000 ← 5000», one string per changed column; unreadable JSON gives no lines. */
export function auditLines(changesJson: string, names?: AuditNames): string[] {
  try {
    const ch = JSON.parse(changesJson) as Record<string, { old?: unknown; new?: unknown }>;
    return Object.entries(ch).map(([col, v]) => {
      const hasOld = "old" in v;
      const hasNew = "new" in v;
      if (hasOld && hasNew) return `${auditColumn(col)}: ${show(col, v.old, names)} ← ${show(col, v.new, names)}`;
      return `${auditColumn(col)}: ${show(col, hasNew ? v.new : v.old, names)}`;
    });
  } catch {
    return [];
  }
}
