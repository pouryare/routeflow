/** FB3: what may be changed on an order at each stage, in one place. The page decides whether to show a
 *  control, the API and the repo decide whether to accept the write; all three ask here, and a refusal
 *  carries its reason in one Persian line. */

export type OrderEdit = "line" | "priority";

const FINISHED = new Set(["DELIVERED", "PARTIALLY_DELIVERED", "CLOSED", "CANCELLED", "RETURNED"]);

export function editRule(edit: OrderEdit, status: string): { ok: true } | { ok: false; why: string } {
  if (edit === "line") {
    return status === "DRAFT" ? { ok: true } : { ok: false, why: "سفارش تأییدشده ویرایش نمی‌شود؛ برای اصلاح، قلم برگشتی ثبت کنید" };
  }
  return FINISHED.has(status) ? { ok: false, why: "اولویت سفارشِ بسته‌شده تغییر نمی‌کند" } : { ok: true };
}
