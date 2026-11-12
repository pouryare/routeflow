/* How the audit record reads to a person (docs/plans/event-architecture-2026-11-12.md E4): Persian names
 * for the audited tables and columns, and one line per change. Pure, so it is tested without a database. */

export const AUDIT_TABLES: Record<string, string> = {
  orders: "سفارش",
  order_lines: "ردیف سفارش",
  payments: "دریافت",
  customers: "مشتری",
  users: "کاربر",
  product_prices: "قیمت کالا",
};

const COLUMNS: Record<string, string> = {
  status: "وضعیت",
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
};

const OPS: Record<string, string> = { insert: "ساخته شد", update: "تغییر کرد", delete: "حذف شد" };

export const auditOp = (op: string) => OPS[op] ?? op;
export const auditTable = (t: string) => AUDIT_TABLES[t] ?? t;
export const auditColumn = (c: string) => COLUMNS[c] ?? c;

const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "بله" : "خیر") : String(v));

/** «سقف اعتبار (تومان): 1000 ← 5000», one string per changed column; unreadable JSON gives no lines. */
export function auditLines(changesJson: string): string[] {
  try {
    const ch = JSON.parse(changesJson) as Record<string, { old?: unknown; new?: unknown }>;
    return Object.entries(ch).map(([col, v]) => {
      const hasOld = "old" in v;
      const hasNew = "new" in v;
      if (hasOld && hasNew) return `${auditColumn(col)}: ${show(v.old)} ← ${show(v.new)}`;
      return `${auditColumn(col)}: ${show(hasNew ? v.new : v.old)}`;
    });
  } catch {
    return [];
  }
}
