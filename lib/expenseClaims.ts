/** F26 + F88: a staff member's claim for a business cost they paid. Pure rules.
 *  Example: a driver claims 120,000 for a tyre repair. The group manager may approve up to the company limit (500,000 by
 *  default); a 900,000 claim waits for the owner. An approved claim is a debt to the person until it is paid back. */
export type ClaimStatus = "pending" | "approved" | "rejected" | "paid";
export const CLAIM_LABEL: Record<ClaimStatus, string> = {
  pending: "منتظر تأیید",
  approved: "تأیید شد، منتظر پرداخت",
  rejected: "رد شد",
  paid: "پرداخت شد",
};

/** Who may decide a claim: the owner any claim; a group manager one up to the limit, from their own group, never their own. */
export function canDecideClaim(
  who: { role: string; userId: number; groupId: number | null },
  claim: { userId: number; groupId: number | null; amountToman: number },
  managerLimitToman: number,
): boolean {
  if (claim.userId === who.userId && who.role !== "owner" && who.role !== "platform_owner") return false;
  if (who.role === "owner" || who.role === "platform_owner") return true;
  return who.role === "group_manager" && claim.groupId === who.groupId && claim.amountToman <= managerLimitToman;
}

/** A cost may be claimed up to this many days after the day it happened. */
const CLAIM_MAX_AGE_DAYS = 60;

/** The days a claim form offers: today first, then back to a week ago. */
export function claimDayChoices(today: string, addDays: (iso: string, n: number) => string): string[] {
  return Array.from({ length: 8 }, (_, i) => addDays(today, -i));
}

export function claimProblem(i: { amountToman: number; incurredAt: string; today: string; note: string | null }): string | null {
  if (!Number.isInteger(i.amountToman) || i.amountToman <= 0) return "مبلغ را به تومان و بدون اعشار وارد کنید";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.incurredAt) || i.incurredAt > i.today) return "تاریخ هزینه معتبر نیست";
  const ageDays = Math.round((Date.parse(`${i.today}T00:00:00Z`) - Date.parse(`${i.incurredAt}T00:00:00Z`)) / 86_400_000);
  if (ageDays > CLAIM_MAX_AGE_DAYS) return `هزینه‌ای که بیش از ${CLAIM_MAX_AGE_DAYS} روز پیش بوده ثبت نمی‌شود؛ به مدیر بگویید دستی ثبت کند`;
  if ((i.note?.length ?? 0) > 200) return "توضیح از ۲۰۰ نویسه بیشتر است";
  return null;
}
