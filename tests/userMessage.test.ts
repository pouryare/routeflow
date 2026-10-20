import { describe, it, expect } from "vitest";
import { friendlyError, isTechnicalMessage } from "@/lib/userMessage";

const FALLBACK = "گروه حذف نشد؛ دوباره تلاش کنید";

describe("friendlyError", () => {
  // Every string below is copied from a real API route (see docs/copy-audit/ux-copy-audit.md).
  const developerFacing = [
    "شناسه نامعتبر است",
    "شناسه نامعتبر",
    "شناسه معتبر نیست",
    "شناسهٔ کالا معتبر نیست",
    "شناسه گروه نامعتبر است",
    "بدنه درخواست نامعتبر است",
    "بدنه نامعتبر است",
    "پارامترها نامعتبر است",
    "پارامتر read نامعتبر است",
    "کنش نامعتبر است",
    "کنش مشخص نشده",
    "نشانگر تاریخچه نامعتبر است",
    "نوع موجودیت نامعتبر است",
    "درخواست نامعتبر است",
    "اشتراک نامعتبر است",
    "کانال نامعتبر است",
    "id لازم است",
    "code لازم است",
    "entity نامعتبر",
    "metric نامعتبر",
    "مقدار enabled نامعتبر است",
    "lat, lng و date لازم است",
    "برای این محدوده id لازم است",
    "یافت نشد",
    "خطا",
    "خطای ناشناخته",
    "قیمت باید عدد صحیح تومان باشد: ${input.price_toman}",
  ];

  for (const m of developerFacing) {
    it(`replaces «${m}»`, () => {
      expect(friendlyError(m, FALLBACK)).toBe(FALLBACK);
    });
  }

  // Strings a person can act on must reach them untouched.
  const actionable = [
    "نام گروه الزامی است",
    "رمز عبور باید حداقل ۸ نویسه باشد",
    "این نام کاربری از قبل گرفته شده است",
    "گروهی با این نام از قبل وجود دارد",
    "حجم فایل نباید بیش از ۲۰ مگابایت باشد",
    "سفارش بدون قلم ثبت نمی‌شود",
    "موجودی وانت کافی نیست (۳ موجود، ۵ درخواست)",
    "هیچ لینک نقشه‌ای در متن پیدا نشد",
    "کمی صبر کنید و دوباره تلاش کنید",
    "ساخت PDF ناموفق بود",
  ];

  for (const m of actionable) {
    it(`keeps «${m}»`, () => {
      expect(friendlyError(m, FALLBACK)).toBe(m);
    });
  }

  it("tells the reader a short not-found message probably means the record is gone", () => {
    expect(friendlyError("کسب‌وکار پیدا نشد", FALLBACK)).toBe(
      "کسب‌وکار پیدا نشد؛ ممکن است حذف شده باشد. صفحه را تازه کنید.",
    );
  });

  it("falls back when there is no message", () => {
    expect(friendlyError(undefined, FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(null, FALLBACK)).toBe(FALLBACK);
    expect(friendlyError("", FALLBACK)).toBe(FALLBACK);
    expect(friendlyError(42, FALLBACK)).toBe(FALLBACK);
  });

  it("isTechnicalMessage agrees", () => {
    expect(isTechnicalMessage("id لازم است")).toBe(true);
    expect(isTechnicalMessage("نام گروه الزامی است")).toBe(false);
  });
});
