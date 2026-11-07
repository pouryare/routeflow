import Link from "next/link";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { faJalaliDateTime } from "@/lib/jalali";
import { roleLabel } from "@/lib/roles";
import type { AccessReview, AccessUser } from "@/lib/accessReview";

const names = (us: AccessUser[]) => (us.length ? us.slice(0, 6).map((u) => u.display_name).join("، ") + (us.length > 6 ? "، …" : "") : "هیچ‌کس");

/** FB34, on the owner's status page: who can get in, and whose access needs a look. Each line opens
 *  the users list, where the person is changed. */
export default function AccessReviewCard({ review, logins }: { review: AccessReview; logins: { at: string; actor: string | null; target: string | null }[] }) {
  const line = (label: string, us: AccessUser[]) => (
    <li className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] pb-[var(--space-2)]">
      <Link href="/sales/admin/users" className="flex items-baseline justify-between gap-[var(--space-2)] text-[var(--foreground)] no-underline">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums" style={{ color: us.length ? "var(--warning)" : "var(--success)" }}>{faNum(us.length)}</span>
      </Link>
      <span className="text-[var(--muted)]">{names(us)}</span>
    </li>
  );
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl">
      <h2 className="sechead__title">بازبینی دسترسی‌ها</h2>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
        {review.byRole.map((r) => `${roleLabel(r.role)} ${faNum(r.n)}`).join(" · ") || "کاربری نیست"}
      </p>
      <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
        {line("هرگز وارد نشده‌اند", review.neverSignedIn)}
        {line("مدیران بدون ورود دومرحله‌ای", review.managersWithoutCode)}
        {line("بیش از ۳۰ روز وارد نشده‌اند", review.idle30)}
      </ul>
      <div className="flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]">
        <span className="font-medium">ورود به‌جای دیگران در ۳۰ روز گذشته</span>
        {logins.length === 0 ? (
          <span className="text-[var(--muted)]">موردی نبوده است.</span>
        ) : (
          logins.map((l) => (
            <span key={l.at} className="text-[var(--muted)]">
              {l.actor ?? "؟"} به‌جای {l.target ?? "؟"} · <span className="tabular-nums">{faJalaliDateTime(l.at)}</span>
            </span>
          ))
        )}
      </div>
      <Link href="/sales/admin/logins" className="btn ghost inline-flex min-h-[44px] items-center gap-[var(--space-2)] self-start">
        <Icon name="list" size="md" />
        گزارش ورودها
      </Link>
    </section>
  );
}
