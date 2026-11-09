"use client";

import { useState } from "react";
import KeypadField from "@/components/mobile/KeypadField";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";

/** «بایگانی تاریخچه», on the platform owner's status page: how many months of history (events,
 *  notifications, rule runs, order steps) stay in the everyday tables. Older rows move nightly to
 *  the archive tables; nothing is deleted, and an order's timeline still shows every step.
 *  Example: 12 → on 18 Aban 1405 everything before 18 Aban 1404 moves. Same shape as TaskPushForm. */
export default function ArchiveMonthsForm({ months }: { months: number }) {
  const [value, setValue] = useState(String(months));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await fetch("/api/admin/archive", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ months: Number(value) }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    setMsg(res?.ok ? { ok: true, text: `ذخیره شد: ${faNum(Number(value))} ماه` } : { ok: false, text: friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید") });
  }
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="archive-months">
      <h2 className="sechead__title">بایگانی تاریخچه</h2>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
        رویدادها، اعلان‌ها و مراحل سفارش‌های قدیمی‌تر از این، هر شب به بایگانی می‌روند تا صفحه‌ها سبک بمانند. چیزی پاک نمی‌شود و
        تاریخچهٔ هر سفارش کامل دیده می‌شود. سفارش‌ها، دریافت‌ها و دفترها هرگز بایگانی نمی‌شوند.
      </p>
      <KeypadField label="چند ماه اخیر در دسترس سریع بماند" value={value} onChange={setValue} unit="ماه" />
      {msg ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</p> : null}
      <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-4)] text-[length:var(--text-sm)] text-accent-ink">
        <Icon name="save" size="md" />
        ذخیرهٔ مدت بایگانی
      </button>
    </section>
  );
}
