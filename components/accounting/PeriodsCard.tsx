"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { FieldArea } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";
import { faDigits, faNum } from "@/lib/format";
import { mayClose } from "@/lib/periodClose";

interface Period { periodKey: string; status: "open" | "closed" }

/** A2 «بستن ماه»: the owner closes a finished month after a short checklist, and reopens it with a reason.
 *  A closed month refuses new entries; a correction goes into the next open month. */
export default function PeriodsCard({ periods, currentKey }: { periods: Period[]; currentKey: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<Period | null>(null);
  const [list, setList] = useState<{ waitingOrders: number; onTheRoad: number; needsAttention: number } | null>(null);
  const [counted, setCounted] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(p: Period) {
    setTarget(p);
    setError(null);
    setReason("");
    setCounted([]);
    setList(null);
    if (p.status === "open") {
      const j = (await (await fetch(`/api/accounting/periods?period=${p.periodKey}`)).json().catch(() => null)) as { checklist?: { waitingOrders: number; onTheRoad: number; needsAttention: number } } | null;
      setList(j?.checklist ?? null);
    }
  }

  async function save() {
    if (!target) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/accounting/periods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: target.periodKey, action: target.status === "open" ? "close" : "reopen", reason }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      setTarget(null);
      router.refresh();
    } else setError(friendlyError(j?.error, "انجام نشد؛ دوباره تلاش کنید"));
  }

  const closing = target?.status === "open";
  return (
    <section className="mb-6" data-tour="close-month">
      <SectionHead title="بستن ماه" as="h3" sub="ماه تمام‌شده را ببندید تا سند تازه‌ای در آن ثبت نشود. اصلاح‌ها به ماه باز بعدی می‌روند." />
      <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
        {periods.map((p) => (
          <li key={p.periodKey} className="flex items-center justify-between gap-[var(--space-3)] border-b border-[var(--border)] pb-[var(--space-2)]">
            <span className="tnum">{faDigits(p.periodKey)} · {p.status === "closed" ? "بسته" : "باز"}</span>
            {p.status === "closed" || mayClose(p.periodKey, currentKey) === null ? (
              <button type="button" onClick={() => void open(p)} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
                <Icon name={p.status === "closed" ? "undo" : "archive"} size="md" />
                {p.status === "closed" ? "بازکردن" : "بستن ماه"}
              </button>
            ) : (
              <span className="text-[length:var(--text-xs)] text-[var(--muted)]">ماه جاری</span>
            )}
          </li>
        ))}
      </ul>
      <BottomSheet open={target !== null} title={closing ? "بستن ماه" : "بازکردن ماه"} subtitle={target ? faDigits(target.periodKey) : undefined} onClose={() => setTarget(null)} closeLabel="بستن فرم ماه">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          {closing ? (
            <>
              <p className="m-0 text-[length:var(--text-sm)]">
                {list ? `${faNum(list.waitingOrders)} سفارش هنوز پیش‌نویس یا منتظر بررسی است و ${faNum(list.onTheRoad)} سفارش هنوز در مسیر است.${list.needsAttention > 0 ? ` ${faNum(list.needsAttention)} هزینه بدون عکس رسید یا یادداشت دارد.` : ""}` : "در حال بررسی…"}
              </p>
              <ChipGroup wrap group={{ id: "counted", label: "فهرست", mode: "multi", value: counted, onChange: (v) => setCounted(v as string[]), options: [{ id: "cash", label: "صندوق را شمرده‌ام" }] }} />
            </>
          ) : (
            <FieldArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full resize-none text-[length:var(--text-base)]" placeholder="دلیل بازکردن ماه" />
          )}
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
          <GoButton icon={closing ? "archive" : "undo"} isDisabled={busy || (closing ? list === null || counted.length === 0 : reason.trim() === "")} onPress={() => void save()}>{closing ? "ماه را ببند" : "ماه را باز کن"}</GoButton>
        </div>
      </BottomSheet>
    </section>
  );
}
