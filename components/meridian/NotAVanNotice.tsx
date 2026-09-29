import Link from "next/link";

/** Shown to a `platform_owner` who opens /driver or /today.
 *
 *  A redirect is a dead end: it answers "you may not" without saying what to do instead,
 *  and for the founder the answer is always one action away — become the driver. The
 *  redirect was also the reason this notice exists at all; see spec §4.3.
 *
 *  Only a platform_owner is offered this. An `owner` or `group_manager` still gets bounced
 *  by the page, because they were not invited to inspect a driver's day — and quietly
 *  widening that to every manager would be the same mistake as the MANAGE_ROLES sweep. */
export default function NotAVanNotice({ roleLabel }: { roleLabel?: string }) {
  return (
    <div
      dir="rtl"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-4)] text-center"
    >
      <h1 className="m-0 text-[length:var(--text-lg)] font-medium text-[var(--text)]">
        شما راننده نیستید
      </h1>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
        این صفحه برنامه و توقف‌های یک راننده را نشان می‌دهد. برای دیدن برنامهٔ امروز یک
        راننده، به‌عنوان او وارد شوید.
      </p>
      {roleLabel && (
        <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-faint)]">
          نقش فعلی شما: {roleLabel}
        </p>
      )}
      <Link
        href="/switch"
        className="mt-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--surface)]"
      >
        ورود به‌عنوان راننده
      </Link>
      <Link
        href="/sales"
        className="text-[length:var(--text-sm)] text-[var(--text-muted)] underline"
      >
        بازگشت به فروش
      </Link>
    </div>
  );
}
