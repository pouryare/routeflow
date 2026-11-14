"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import { FieldArea } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { toNumber } from "@/lib/money";
import type { Holding } from "@/lib/repo/cashInHand";

/** D1 «پول در دست»: the cash each rep and driver collected and has not handed over. The office counts it and saves; a different amount needs a reason. */
export default function CashInHandCard({ items }: { items: Holding[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<Holding | null>(null);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  const n = counted.trim() === "" ? null : toNumber(counted);
  const differs = target !== null && n !== null && n !== target.amount;

  async function save() {
    if (!target || n === null) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sales/cash-handovers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ holder: target.userId, through: target.through, counted: n, reason }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      setTarget(null);
      router.refresh();
    } else setError(friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید"));
  }

  return (
    <section className="card mx-auto mb-[var(--space-4)] max-w-5xl p-[var(--space-4)]" dir="rtl" data-tour="cash-in-hand">
      <SectionHead title="پول در دست" as="h3" sub="نقدی که هر نفر گرفته و هنوز تحویل صندوق نداده است." className="mb-[var(--space-3)]" />
      <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
        {items.map((h) => (
          <li key={h.userId} className="flex items-center justify-between gap-[var(--space-3)] border-b border-[var(--border)] pb-[var(--space-2)]">
            <span className="flex flex-col">
              <span className="font-medium">{h.name}</span>
              <span className="text-[var(--muted)]">{faToman(h.amount)} · {faNum(h.count)} دریافت از {faJalaliDate(h.since)}</span>
            </span>
            <button type="button" onClick={() => { setTarget(h); setCounted(""); setReason(""); setError(null); }} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)]">
              <Icon name="wallet" size="md" />
              شمارش
            </button>
          </li>
        ))}
      </ul>
      {target ? (
        <BottomSheet open title="شمارش پول" subtitle={`${target.name} · ثبت‌شده: ${faToman(target.amount)}`} onClose={() => setTarget(null)} closeLabel="بستن شمارش پول">
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <KeypadField label="مبلغی که شمردید" value={counted} onChange={setCounted} unit="تومان" />
            {differs ? <FieldArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل اختلاف" rows={2} className="w-full resize-none" /> : null}
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            <GoButton icon="save" isDisabled={busy || n === null || (differs && !reason.trim())} onPress={() => void save()}>ذخیرهٔ شمارش</GoButton>
          </div>
        </BottomSheet>
      ) : null}
    </section>
  );
}
