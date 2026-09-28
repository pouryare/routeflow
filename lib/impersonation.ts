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

export function impersonationRefusal(actor: ImpersonationParty, target: ImpersonationParty | null): string | null {
  if (!actor.active) return "حساب شما غیرفعال است";
  if (actor.role !== "owner" && actor.role !== "platform_owner") {
    return "فقط مالک می‌تواند به‌جای کاربر دیگری وارد شود";
  }
  if (!target) return "کاربر پیدا نشد";
  if (target.id === actor.id) return "نمی‌توانید به‌جای خودتان وارد شوید";
  if (!target.active) return "این حساب غیرفعال است";

  /* Cross-tenant is allowed ONLY for a platform_owner. An owner crossing into another
     organisation is refused below — the founder is the vendor, and diagnosing a tenant he
     does not work for is what the role is for. */
  if (actor.role !== "platform_owner" && target.organization_id !== actor.organization_id) {
    return "کاربر پیدا نشد";
  }

  /* UNTOUCHABLE is GONE, deliberately. The founder must be able to act as any account in
     any tenant, including a tenant's `owner` — that is the whole point of the tool, and the
     "no second platform owner" case is covered by refusing self-impersonation above.
     A second platform owner making this a peer-to-peer escalation is out of scope here and
     is noted in the spec's §4.7, not enforced here. */
  return null;
}

/** The cookie that holds the owner's own session while they act as someone else, so
 *  «بازگشت» can restore it without a second login. httpOnly, like the session itself. */
export const ACTOR_COOKIE = "rf_actor";
/** An impersonation lasts at most this long: long enough to look around, short enough
 *  that a forgotten one does not leave an owner signed in as a salesperson for a month. */
export const IMPERSONATION_MAX_AGE_SECONDS = 2 * 60 * 60;
