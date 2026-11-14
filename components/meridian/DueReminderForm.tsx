"use client";

import { useState } from "react";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";
import { REMINDER_CHOICES } from "@/lib/dueReminders";

const label = (d: number) => (d === 0 ? "روز سررسید" : d < 0 ? `${faNum(-d)} روز قبل` : `${faNum(d)} روز بعد`);

/** A8, on the owner's status page: the days around an order's due date on which its rep gets a reminder task. */
export default function DueReminderForm({ days }: { days: number[] }) {
  const [chosen, setChosen] = useState<string[]>(days.map(String));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await fetch("/api/admin/due-reminders", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: chosen.map(Number) }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    setMsg(res?.ok ? { ok: true, text: "ذخیره شد" } : { ok: false, text: friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید") });
  }
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="due-reminders">
      <h2 className="sechead__title">یادآوری سررسید پرداخت</h2>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">در هر روزی که انتخاب کنید، برای فروشندهٔ هر سفارش پرداخت‌نشده یک کار تماس ساخته می‌شود.</p>
      <ChipGroup wrap group={{ id: "due-days", label: "روزهای یادآوری", mode: "multi", value: chosen, onChange: (v) => setChosen(v as string[]), options: REMINDER_CHOICES.map((d) => ({ id: String(d), label: label(d) })) }} />
      {msg ? <p className="m-0 text-[length:var(--text-xs)]" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</p> : null}
      <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent)] px-[var(--space-4)] text-[length:var(--text-sm)] text-accent-ink">
        <Icon name="save" size="md" />
        ذخیرهٔ روزهای یادآوری
      </button>
    </section>
  );
}
