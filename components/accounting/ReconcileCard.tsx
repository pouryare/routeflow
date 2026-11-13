"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import KeypadField from "@/components/mobile/KeypadField";
import { GoButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";
import { faDigits, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { toNumber } from "@/lib/money";
import { reconcileGap } from "@/lib/reconcile";
import { TRANSFER_ACCOUNTS } from "@/lib/transferAccounts";
import type { ReconcileView } from "@/lib/repo/reconcile";

/** A3 «مطابقت حساب»: type the balance you counted (or read on the bank paper), tick lines until the gap is zero, save.
 *  Ticked lines are locked; a mistake after that is fixed by a reversal in the journal. */
export default function ReconcileCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string>(TRANSFER_ACCOUNTS[0].code);
  const [view, setView] = useState<ReconcileView | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(c: string) {
    setCode(c);
    setView(null);
    setTicked(new Set());
    setError(null);
    const j = (await (await fetch(`/api/accounting/reconcile?account=${c}`)).json().catch(() => null)) as { view?: ReconcileView; error?: string } | null;
    if (j?.view) setView(j.view);
    else setError(friendlyError(j?.error, "خوانده نشد؛ دوباره تلاش کنید"));
  }

  function toggle(id: number) {
    setTicked((t) => {
      const n = new Set(t);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const countedN = counted.trim() === "" ? null : toNumber(counted);
  const sum = view ? view.lines.filter((l) => ticked.has(l.id)).reduce((s, l) => s + l.signed, 0) : 0;
  const gap = countedN === null || !view ? null : reconcileGap(countedN, view.lockedToman, sum);

  async function save() {
    if (countedN === null) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/accounting/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: code, counted: countedN, ids: [...ticked] }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      setOpen(false);
      router.refresh();
    } else setError(friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید"));
  }

  return (
    <section className="mb-6" data-tour="reconcile">
      <SectionHead title="مطابقت صندوق و بانک" as="h3" sub="مانده‌ای را که شمرده‌اید بنویسید و خط‌ها را تیک بزنید تا اختلاف صفر شود." />
      <button
        type="button"
        onClick={() => { setOpen(true); void load(code); }}
        className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]"
      >
        <Icon name="check-check" size="md" />
        شروع مطابقت
      </button>
      <BottomSheet open={open} title="مطابقت حساب" onClose={() => setOpen(false)} closeLabel="بستن مطابقت حساب">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <ChipGroup wrap group={{ id: "acct", label: "حساب", mode: "single", neutral: "__none", value: code, onChange: (v) => { if (typeof v === "string" && v !== code) void load(v); }, options: TRANSFER_ACCOUNTS.map((a) => ({ id: a.code, label: a.label })) }} />
          <KeypadField label="مانده‌ای که شمردید" value={counted} onChange={setCounted} unit="تومان" />
          {view ? (
            <>
              <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">قبلاً مطابقت‌شده: {faToman(view.lockedToman)}</p>
              {view.lines.length === 0 ? <p className="m-0 text-[length:var(--text-sm)]">خط بازی نمانده است.</p> : null}
              <ul className="m-0 flex max-h-[40vh] list-none flex-col gap-[var(--space-1)] overflow-y-auto p-0">
                {view.lines.map((l) => (
                  <li key={l.id}>
                    <button type="button" aria-pressed={ticked.has(l.id)} onClick={() => toggle(l.id)} className="flex min-h-[44px] w-full items-center justify-between gap-[var(--space-2)] border-b border-[var(--border)] text-start text-[length:var(--text-sm)]">
                      <span className="inline-flex items-center gap-[var(--space-2)]">
                        {ticked.has(l.id) ? <Icon name="check" size="md" /> : <span aria-hidden="true" className="inline-block size-5 rounded-full border border-[var(--border)]" />}
                        <span>{faJalaliDate(l.postedAt)} · {l.memo ?? "—"}</span>
                      </span>
                      <span className="tnum">{l.signed < 0 ? "−" : ""}{faDigits(String(Math.abs(l.signed)))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {gap !== null ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: gap === 0 ? "var(--success)" : "var(--danger)" }}>اختلاف: {faToman(gap)}</p> : null}
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
          <GoButton icon="save" isDisabled={busy || gap !== 0 || ticked.size === 0} onPress={() => void save()}>ذخیرهٔ مطابقت</GoButton>
        </div>
      </BottomSheet>
    </section>
  );
}
