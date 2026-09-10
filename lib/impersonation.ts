/** Login-As (spec slice N): an owner seeing the app exactly as one of their people sees
 *  it, to answer "what does my salesperson see?" without asking for their password.
 *
 *  It mints a session in someone else's name, so the rules are strict and live in one
 *  pure function the route and its tests share. Refusals come back as the Persian
 *  sentence the route shows; `null` means allowed. */

export type ImpersonationParty = {
  id: number;
  role: string;
  organization_id: number;
  active: number | boolean;
};

/** Roles that may never be impersonated: another owner would let one owner act as
 *  another with the same authority and none of the accountability, and a platform owner
 *  sits outside the tenant entirely. */
const UNTOUCHABLE: ReadonlySet<string> = new Set(["owner", "platform_owner"]);

export function impersonationRefusal(actor: ImpersonationParty, target: ImpersonationParty | null): string | null {
  if (!actor.active || actor.role !== "owner") return "فقط مالک می‌تواند به‌جای کاربر دیگری وارد شود";
  if (!target) return "کاربر پیدا نشد";
  if (target.id === actor.id) return "نمی‌توانید به‌جای خودتان وارد شوید";
  if (target.organization_id !== actor.organization_id) return "کاربر پیدا نشد";
  if (!target.active) return "این حساب غیرفعال است";
  if (UNTOUCHABLE.has(target.role)) return "نمی‌توان به‌جای مالک دیگری وارد شد";
  return null;
}

/** The cookie that holds the owner's own session while they act as someone else, so
 *  «بازگشت» can restore it without a second login. httpOnly, like the session itself. */
export const ACTOR_COOKIE = "rf_actor";
/** An impersonation lasts at most this long: long enough to look around, short enough
 *  that a forgotten one does not leave an owner signed in as a salesperson for a month. */
export const IMPERSONATION_MAX_AGE_SECONDS = 2 * 60 * 60;
