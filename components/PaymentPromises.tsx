"use client";

import { useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import DayChips from "@/components/mobile/DayChips";
import KeypadField from "@/components/mobile/KeypadField";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { faJalaliDate, tehranTodayIso } from "@/lib/jalali";
import { faToman } from "@/lib/format";
import { toNumber } from "@/lib/money";
import { friendlyError } from "@/lib/userMessage";
import { RISK_LEVEL_LABEL, type RiskResult } from "@/lib/creditRisk";
import type { PromiseRow, PromiseStatus } from "@/lib/repo/promises";

const STATUS: Record<PromiseStatus, { label: string; color: string }> = {
  open: { label: "در انتظار", color: "var(--warning)" },
  kept: { label: "انجام شد", color: "var(--success)" },
  broken: { label: "شکسته", color: "var(--danger)" },
  cancelled: { label: "لغو شد", color: "var(--muted)" },
};
const RISK_COLOR = { low: "var(--success)", medium: "var(--warning)", high: "var(--danger)" } as const;
const BTN = "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]";

/** F46 and F50 on the customer page: the advisory risk score with its reasons (managers), and the promises to pay. */
export default function PaymentPromises({ customerId, name, risk, promises, canPromise, onChanged }: {
  customerId: number;
  name: string;
  risk: RiskResult | null;
  promises: PromiseRow[];
  canPromise: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(tehranTodayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountN = toNumber(amount);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/promises`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: amountN, date }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      setOpen(false);
      setAmount("");
      onChanged();
    } else setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
  }

  async function cancel(id: number) {
    const res = await fetch(`/api/customers/${customerId}/promises/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) onChanged();
  }

  if (!risk && !canPromise) return null;
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="payment-promises" aria-label="وعدهٔ پرداخت و ریسک اعتبار">
      {risk ? (
        <p className="m-0 text-[length:var(--text-sm)]">
          <b>ریسک اعتبار: </b>
          <span style={{ color: RISK_COLOR[risk.level] }}>{RISK_LEVEL_LABEL[risk.level]} ({risk.score.toLocaleString("fa-IR")} از ۱۰۰)</span>
          <span className="block text-[length:var(--text-xs)] text-[var(--muted)]">
            {risk.reasons.length ? risk.reasons.join(" · ") : "هیچ نشانهٔ بدی نیست"} · فقط راهنماست و جلوی سفارش را نمی‌گیرد
          </span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <h3 className="sechead__title m-0">وعدهٔ پرداخت</h3>
        {canPromise ? (
          <button type="button" className={BTN} onClick={() => setOpen(true)}>
            <Icon name="calendar" size="md" />
            ثبت وعده
          </button>
        ) : null}
      </div>
      {promises.length === 0 ? (
        <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">وعده‌ای ثبت نشده. وقتی مشتری گفت «پنج‌شنبه می‌دهم»، همین‌جا ثبتش کنید؛ اگر نرسید در «امروز» یادآوری می‌شود.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
          {promises.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-[var(--space-2)] text-[length:var(--text-sm)]">
              <span>{faToman(p.amount_toman)} تا {faJalaliDate(p.promised_date)}</span>
              <span className="flex items-center gap-[var(--space-2)]">
                <span style={{ color: STATUS[p.status].color }}>{STATUS[p.status].label}</span>
                {canPromise && p.status === "open" ? (
                  <button type="button" className={BTN} onClick={() => void cancel(p.id)} aria-label="لغو این وعده">
                    <Icon name="x" size="md" />
                    لغو وعده
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <BottomSheet open title="ثبت وعدهٔ پرداخت" subtitle={name} onClose={() => setOpen(false)} closeLabel="بستن ثبت وعده">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <KeypadField label="مبلغ وعده" value={amount} onChange={setAmount} unit="تومان" />
            <DayChips value={date} onChange={setDate} ariaLabel="روز وعده" count={7} />
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="save" isDisabled={busy || amountN === null || amountN <= 0} onPress={() => void save()}>ثبت وعده</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </section>
  );
}
