"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { FieldArea } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";
import { faDigits } from "@/lib/format";

interface Year { year: number; closed: boolean }

/** H2 «بستن سال»: one entry moves the year's profit to retained earnings and closes its twelve months. */
export default function YearCloseCard({ years, currentYear }: { years: Year[]; currentYear: number }) {
  const router = useRouter();
  const [target, setTarget] = useState<Year | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!target) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/accounting/periods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: target.year, action: target.closed ? "reopen_year" : "close_year", reason }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      setTarget(null);
      router.refresh();
    } else setError(friendlyError(j?.error, "انجام نشد؛ دوباره تلاش کنید"));
  }

  const past = years.filter((y) => y.year < currentYear);
  if (past.length === 0) return null;
  return (
    <section className="mb-6" data-tour="close-year">
      <SectionHead title="بستن سال" as="h3" sub="سود یا زیان سال به سود انباشته می‌رود و ماه‌های سال بسته می‌شوند." />
      <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
        {past.map((y) => (
          <li key={y.year} className="flex items-center justify-between gap-[var(--space-3)] border-b border-[var(--border)] pb-[var(--space-2)]">
            <span className="tnum">{faDigits(String(y.year))} · {y.closed ? "بسته" : "باز"}</span>
            <button type="button" onClick={() => { setTarget(y); setReason(""); setError(null); }} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
              <Icon name={y.closed ? "undo" : "archive"} size="md" />
              {y.closed ? "بازکردن سال" : "بستن سال"}
            </button>
          </li>
        ))}
      </ul>
      <BottomSheet open={target !== null} title={target?.closed ? "بازکردن سال" : "بستن سال"} subtitle={target ? faDigits(String(target.year)) : undefined} onClose={() => setTarget(null)} closeLabel="بستن فرم سال">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          {target?.closed ? (
            <FieldArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full resize-none text-[length:var(--text-base)]" placeholder="دلیل بازکردن سال" />
          ) : (
            <p className="m-0 text-[length:var(--text-sm)]">یک سند بستن سال ثبت می‌شود و هر دوازده ماه این سال بسته می‌شود. ماه آخر باید باز باشد.</p>
          )}
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
          <GoButton icon={target?.closed ? "undo" : "archive"} isDisabled={busy || (target?.closed === true && reason.trim() === "")} onPress={() => void save()}>{target?.closed ? "سال را باز کن" : "سال را ببند"}</GoButton>
        </div>
      </BottomSheet>
    </section>
  );
}
