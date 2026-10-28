"use client";

import { useState } from "react";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";

/** The owner's switch for asking an authenticator code before sensitive actions (lib/stepUp.ts).
 *  Off by default: switch it on once the managers have enrolled, or they would be asked for a code
 *  they cannot give. */
export default function StepUpSwitch({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/step-up-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ required: !on }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setBusy(false);
    if (data?.ok) setOn(!on);
    else setError(data?.error ?? "انجام نشد؛ دوباره تلاش کنید");
  }

  return (
    <section className="card mt-[var(--space-4)] flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" aria-label="کد برای کارهای حساس">
      <SectionHead title="کد برای کارهای حساس" />
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
        وقتی روشن باشد، مدیرها پیش از تأیید تخفیف، تغییر قیمت و پورسانت، تغییر کاربران و کارهای مشابه کد برنامهٔ احراز هویت را وارد می‌کنند؛
        بقیه فقط هنگام ویرایش یا حذف پرداخت ثبت‌شده. بعد از هر کد، ۱۰ دقیقه روی همان دستگاه دوباره پرسیده نمی‌شود.
        اول مطمئن شوید مدیرها ورود دومرحله‌ای را فعال کرده‌اند.
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy}
        onClick={() => void flip()}
        className="touch inline-flex min-h-11 items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] px-[var(--space-4)] text-[length:var(--text-sm)] disabled:opacity-50"
        style={on ? { background: "var(--accent)", color: "var(--accent-ink, #fff)" } : { color: "var(--accent)" }}
      >
        <Icon name={on ? "check" : "x"} size="sm" />
        {on ? "روشن است؛ خاموش کردن" : "خاموش است؛ روشن کردن"}
      </button>
      {error && <p role="alert" className="m-0 text-[length:var(--text-sm)] text-[var(--crit)]">{error}</p>}
    </section>
  );
}
