"use client";

import { useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/FilterChips";
import { FieldArea } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { faJalaliDate, tehranTodayIso } from "@/lib/jalali";
import { addDaysIso } from "@/lib/flows/dates";
import { friendlyError } from "@/lib/userMessage";
import { HOLD_DEFAULT_DAYS } from "@/lib/customerHolds";
import type { HoldRow } from "@/lib/repo/customerHolds";

const DAYS = [3, 7, 14, 30];
const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";

/** F71 on the customer page: «نگه داشتن سفارش‌های تازه». A rep or manager holds a customer's new orders for a few days with a
 *  reason; a new order then waits for a manager. Shown to anyone who sells to the customer. */
export default function CustomerHold({ customerId, name, hold, canRelease, onChanged }: {
  customerId: number;
  name: string;
  hold: HoldRow | null;
  canRelease: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(String(HOLD_DEFAULT_DAYS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/hold`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      setOpen(false);
      setReason("");
      onChanged();
    } else setError(friendlyError(j?.error, "انجام نشد؛ دوباره تلاش کنید"));
  }

  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="customer-hold" aria-label="نگه داشتن سفارش‌های تازه">
      {hold ? (
        <>
          <p className="m-0 text-[length:var(--text-sm)]" role="status">
            <b style={{ color: "var(--warning)" }}>سفارش‌های تازهٔ این مشتری نگه داشته شده</b> تا {faJalaliDate(hold.expires_on)}
            <span className="block text-[length:var(--text-xs)] text-[var(--muted)]">{hold.reason} · {hold.placed_by_name ?? "—"} · سفارش تازه منتظر تأیید مدیر می‌ماند، سفارش‌های تأییدشده ادامه دارند</span>
          </p>
          {canRelease ? (
            <button type="button" className={BTN} disabled={busy} onClick={() => void call("DELETE")}>
              <Icon name="check" size="md" />
              آزاد کردن
            </button>
          ) : null}
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
          <span className="text-[length:var(--text-sm)] text-[var(--muted)]">اختلاف یا چک برگشتی؟ سفارش تازه را موقتاً نگه دارید.</span>
          <button type="button" className={BTN} onClick={() => setOpen(true)}>
            <Icon name="ban" size="md" />
            نگه داشتن سفارش‌ها
          </button>
        </div>
      )}
      {open ? (
        <BottomSheet open title="نگه داشتن سفارش‌های تازه" subtitle={name} onClose={() => setOpen(false)} closeLabel="بستن">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <FieldArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل (مثلاً: چک برگشتی در حال پیگیری)" rows={2} className="w-full resize-none" />
            <ChipGroup wrap group={{ id: "hold_days", label: "تا چند روز", mode: "single", neutral: "__none", value: days, onChange: (v) => v && v !== "__none" && setDays(v as string), options: DAYS.map((d) => ({ id: String(d), label: `${d.toLocaleString("fa-IR")} روز` })) }} />
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="ban" isDisabled={busy || !reason.trim()} onPress={() => void call("POST", { reason, expiresOn: addDaysIso(tehranTodayIso(), Number(days)) })}>نگه داشتن</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </section>
  );
}
