/** Step-up verification: the sensitive actions that ask for an authenticator code, who is asked, and
 *  how long a verified person stays trusted on a device.
 *
 *  Decided by the owner (2026-10-28): managers are asked for every action here, other roles only when
 *  editing or deleting a recorded payment; the code must be the person's own (the real person under
 *  Login-As); a verified device is trusted for 10 minutes and the trust ends at sign-out.
 *  Pure, so the rules are tested before any route uses them. */

import crypto from "node:crypto";
import { MANAGE_ROLES } from "./roles";
export { normaliseCode } from "./otpCode";

export const TRUST_MINUTES = 10;

/** `critical` actions also ask for a press-and-hold on the confirm button: they cannot be undone. */
export const STEP_UP_ACTIONS = {
  discount_decide: { label: "تأیید یا ردِ تخفیف", critical: false },
  price_change: { label: "تغییر قیمت", critical: false },
  commission_change: { label: "تغییر نرخ پورسانت یا ثبت پرداخت پورسانت", critical: false },
  credit_limit: { label: "افزایش سقف اعتبار", critical: false },
  user_change: { label: "تغییر نقش، غیرفعال‌سازی یا بازنشانی رمز کاربر", critical: false },
  login_as: { label: "ورود به‌جای کاربر دیگر", critical: false },
  export_customers: { label: "خروجی همهٔ مشتریان", critical: false },
  own_phone: { label: "تغییر شمارهٔ موبایل خودتان", critical: false },
  order_change_delivered: { label: "لغو یا ویرایش سفارش تحویل‌شده", critical: false },
  payment_edit: { label: "ویرایش یا حذف پرداخت ثبت‌شده", critical: false },
  hard_delete: { label: "حذف همیشگی", critical: true },
  owner_settings: { label: "تغییر تنظیمات مالک", critical: false },
  second_factor_off: { label: "غیرفعال یا بازنشانی برنامهٔ احراز هویت", critical: true },
  create_manager: { label: "ساخت مالک یا مدیر", critical: true },
  import_overwrite: { label: "بازنویسی داده با درون‌ریزی", critical: true },
} as const;

export type StepUpAction = keyof typeof STEP_UP_ACTIONS;

export const isStepUpAction = (v: unknown): v is StepUpAction =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(STEP_UP_ACTIONS, v);

/** Whether `role` is asked for a code before `action`. */
export function needsStepUp(role: string, action: StepUpAction): boolean {
  if ((MANAGE_ROLES as readonly string[]).includes(role) || role === "rep_manager") return true;
  return action === "payment_edit";
}

export interface Trust {
  /** The person whose code was checked (the real person under Login-As). */
  uid: number;
  /** token_version when it was granted: signing out everywhere ends the trust. */
  tv: number;
  /** Expiry, ms since the epoch. */
  exp: number;
}

export const TRUST_COOKIE = "rf_stepup";

export function mintTrust(key: Buffer, uid: number, tv: number, nowMs = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ uid, tv, exp: nowMs + TRUST_MINUTES * 60_000 } satisfies Trust)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", key).update(body).digest("base64url")}`;
}

/** The trust in a cookie value, or null when it is missing, forged, someone else's or out of date. */
export function readTrust(key: Buffer, value: string | undefined | null, uid: number, tv: number, nowMs = Date.now()): Trust | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Trust;
    if (t.uid !== uid || t.tv !== tv || !(t.exp > nowMs)) return null;
    return t;
  } catch {
    return null;
  }
}
