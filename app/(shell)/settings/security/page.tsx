import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";
import { Icon } from "@/components/meridian/Icon";
import LoginEventList from "@/components/LoginEventList";
import ChangePasswordSection from "@/components/ChangePasswordSection";
import { myRecentLogins } from "@/lib/repo/loginEvents";
import SecondFactorSection from "@/components/meridian/SecondFactorSection";
import StepUpSwitch from "@/components/meridian/StepUpSwitch";
import { stepUpRequiredFor } from "@/lib/repo/stepUp";
import { isOwner } from "@/lib/roles";

export const dynamic = "force-dynamic";

const BUTTON =
  "touch inline-flex min-h-11 items-center gap-[var(--space-2)] justify-center rounded-[var(--radius-md)] border px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] cursor-pointer";

/** Your own sign-in security: change your password, end your sessions on other devices (F107)
 *  and see your last sign-ins (F110). The password section is hidden under Login-As, where the
 *  API refuses it: an owner acting as someone must not choose that person's password. */
export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const { done, error } = await searchParams;
  const impersonating = session.actorId !== undefined;
  const logins = await myRecentLogins(session.organizationId, session.user.id, 10);

  return (
    <>
      <PageHeader route="/settings/security" />
      <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl">
        <h2 className="sechead__title">خروج از دستگاه‌ها</h2>
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          اگر گوشی‌ای گم شده یا روی رایانهٔ دیگری وارد شده‌اید و بیرون نیامده‌اید، از اینجا همهٔ آن ورودها را ببندید.
          هر دستگاه دیگر در درخواست بعدی‌اش به صفحهٔ ورود می‌رود.
        </p>
        {done === "others" && (
          <p role="status" className="m-0 text-[length:var(--text-sm)] text-[var(--good)]">
            از همهٔ دستگاه‌های دیگر خارج شدید. این دستگاه وارد مانده است.
          </p>
        )}
        {(impersonating || error === "impersonating") && (
          <p role="status" className="m-0 text-[length:var(--text-sm)] text-[var(--warn)]">
            در حالت ورود به‌جای کاربر دیگر این کار ممکن نیست.
          </p>
        )}
        {!impersonating && (
          <form action="/api/me/sign-out" method="post" className="flex flex-wrap gap-[var(--space-2)]">
            <button type="submit" name="scope" value="others" className={`${BUTTON} border-[var(--accent)] text-[var(--accent)]`}>
              <Icon name="logout" size="sm" />
              خروج از همهٔ دستگاه‌های دیگر
            </button>
            <button type="submit" name="scope" value="all" className={`${BUTTON} border-[var(--border)] text-[var(--text-muted)]`}>
              <Icon name="logout" size="sm" />
              خروج از همه‌جا، این دستگاه هم
            </button>
          </form>
        )}
      </section>
      {!impersonating && <ChangePasswordSection />}
      {!impersonating && <SecondFactorSection />}
      {!impersonating && isOwner(session.role) && <StepUpSwitch initial={await stepUpRequiredFor(session.organizationId)} />}
      <section className="card mt-[var(--space-4)] flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl">
        <h2 className="sechead__title">ورودهای اخیر شما</h2>
        <LoginEventList rows={logins} />
      </section>
    </>
  );
}
