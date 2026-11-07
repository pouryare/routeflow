"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DayChips from "@/components/mobile/DayChips";
import KeypadField from "@/components/mobile/KeypadField";
import { FieldInput } from "@/components/FieldInput";
import { Icon } from "@/components/meridian/Icon";
import { faJalaliDateTime, tehranTodayIso } from "@/lib/jalali";
import { tehranInstant, type Maintenance } from "@/lib/maintenance";
import { friendlyError } from "@/lib/userMessage";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";

/** T17, on the owner's status page: when the app will be updated, so everyone sees a banner first. */
export default function MaintenanceForm({ current }: { current: Maintenance | null }) {
  const router = useRouter();
  const [date, setDate] = useState(() => tehranTodayIso());
  const [hour, setHour] = useState("22");
  const [hours, setHours] = useState("1");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(body: unknown) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/maintenance", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!res?.ok) return setMsg(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
    router.refresh();
  }

  const save = () => {
    const from = tehranInstant(date, Number(hour));
    const to = new Date(Date.parse(from) + Math.max(1, Number(hours) || 1) * 3_600_000).toISOString();
    void send({ from, to, note });
  };

  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl">
      <h2 className="sechead__title">اعلام زمان به‌روزرسانی</h2>
      {current ? (
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
          اعلام‌شده: {faJalaliDateTime(current.from)} تا {faJalaliDateTime(current.to)}{current.note ? ` · ${current.note}` : ""}
        </p>
      ) : (
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">همه یک نوار هشدار می‌بینند؛ رانندگان و فروشنده‌ها پیش از شروع باید همگام کنند.</p>
      )}
      <DayChips value={date} onChange={setDate} ariaLabel="روز به‌روزرسانی" />
      <div className="grid grid-cols-2 gap-[var(--space-2)]">
        <KeypadField label="ساعت شروع" value={hour} onChange={setHour} unit="ساعت" />
        <KeypadField label="مدت" value={hours} onChange={setHours} unit="ساعت" />
      </div>
      <FieldInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیح کوتاه (اختیاری)" aria-label="توضیح" maxLength={200} />
      {msg ? <p className="m-0 text-[length:var(--text-xs)] text-[var(--danger)]">{msg}</p> : null}
      <div className="flex flex-wrap gap-[var(--space-2)]">
        <button type="button" disabled={busy} onClick={save} className={`${BTN} bg-[var(--accent)] text-accent-ink`}>
          <Icon name="save" size="md" />
          ذخیره و اعلام
        </button>
        {current ? (
          <button type="button" disabled={busy} onClick={() => void send({ clear: true })} className={BTN}>
            <Icon name="x" size="md" />
            لغو اعلام
          </button>
        ) : null}
      </div>
    </section>
  );
}
