"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { faJalaliDateTime } from "@/lib/jalali";
import { friendlyError } from "@/lib/userMessage";
import type { AttemptRow } from "@/lib/repo/notifications";

const CHANNEL = { push: "اعلان گوشی", telegram: "تلگرام" } as const;

/** FB20 «تلاش‌های ارسال اعلان»: the last tries to reach a person's phone, what happened, and a button to try again now.
 *  Example: «علی · اعلان گوشی · ناموفق · ۲ پیام · ۴۱۰: اشتراک منقضی شد». A failed batch is retried by itself every five minutes; the button just does not wait. */
export default function DeliveryAttemptsCard({ rows }: { rows: AttemptRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function retry() {
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/admin/notification-retry", { method: "POST" }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string; sent?: number } | undefined;
    setBusy(false);
    if (res?.ok) {
      setNote(`${faNum(j?.sent ?? 0)} ارسال انجام شد`);
      router.refresh();
    } else setNote(friendlyError(j?.error, "انجام نشد؛ دوباره تلاش کنید"));
  }
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="delivery-attempts">
      <h2 className="sechead__title">تلاش‌های ارسال اعلان</h2>
      {rows.length === 0 ? (
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">هنوز تلاشی برای ارسال به گوشی‌ها ثبت نشده است.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] pb-[var(--space-2)]">
              <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                <span>{r.userName} · {CHANNEL[r.channel]} · {faNum(r.messageCount)} پیام</span>
                <span style={{ color: r.ok ? "var(--success)" : "var(--danger)" }}>{r.ok ? "رسید" : "ناموفق"}</span>
              </div>
              <span className="text-[length:var(--text-xs)] text-[var(--muted)]"><bdi dir="ltr" className="tabular-nums">{faJalaliDateTime(r.triedAt)}</bdi>{r.error ? ` · ${r.error}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {note ? <p className="m-0 text-[length:var(--text-sm)]" role="status">{note}</p> : null}
      <button type="button" disabled={busy} onClick={() => void retry()} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
        <Icon name="refresh" size="md" />
        تلاش دوباره همین حالا
      </button>
    </section>
  );
}
