import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import PageHeader from "@/components/meridian/PageHeader";

export const dynamic = "force-dynamic";

const BUTTON =
  "touch inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] border px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] cursor-pointer";

/** Your own sign-in security: end your sessions on other devices (F107). */
export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const { done, error } = await searchParams;
  const impersonating = session.actorId !== undefined;

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
          <div className="flex flex-wrap gap-[var(--space-2)]">
            <form action="/api/me/sign-out" method="post">
              <input type="hidden" name="scope" value="others" />
              <button type="submit" className={`${BUTTON} border-[var(--accent)] text-[var(--accent)]`}>
                خروج از همهٔ دستگاه‌های دیگر
              </button>
            </form>
            <form action="/api/me/sign-out" method="post">
              <input type="hidden" name="scope" value="all" />
              <button type="submit" className={`${BUTTON} border-[var(--border)] text-[var(--text-muted)]`}>
                خروج از همه‌جا، این دستگاه هم
              </button>
            </form>
          </div>
        )}
      </section>
    </>
  );
}
