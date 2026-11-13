"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import SmartPicker from "@/components/mobile/SmartPicker";
import { FieldArea } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";
import { toNumber } from "@/lib/money";

async function send(body: object): Promise<string | null> {
  const res = await fetch("/api/accounting/journals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (res?.ok) return null;
  const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
  return friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید");
}

/** H3 «سند دستی»: a bank fee, a loan, a correction between accounts: debit one account, credit another. */
export default function ManualJournalCard({ accounts }: { accounts: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [debit, setDebit] = useState("");
  const [credit, setCredit] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = debit !== "" && credit !== "" && debit !== credit && (toNumber(amount) ?? 0) > 0 && memo.trim() !== "";

  async function save() {
    setBusy(true);
    setError(null);
    const err = await send({ action: "post", debit, credit, amount: toNumber(amount), memo });
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    setDebit(""); setCredit(""); setAmount(""); setMemo("");
    router.refresh();
  }

  return (
    <section className="mb-6" data-tour="manual-journal">
      <SectionHead title="سند دستی" as="h3" sub="کارمزد بانک، وام یا اصلاح بین دو حساب. در دفتر با برچسب «دستی» می‌ماند و با نام شما ثبت می‌شود." />
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
        <Icon name="plus" size="md" />
        ثبت سند دستی
      </button>
      <BottomSheet open={open} title="سند دستی" onClose={() => setOpen(false)} closeLabel="بستن سند دستی">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <SmartPicker scope="manual-debit" label="حساب بدهکار" items={accounts} value={debit} onChange={setDebit} placeholder="حساب بدهکار" />
          <SmartPicker scope="manual-credit" label="حساب بستانکار" items={accounts} value={credit} onChange={setCredit} placeholder="حساب بستانکار" />
          <KeypadField label="مبلغ" value={amount} onChange={setAmount} unit="تومان" />
          <FieldArea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} className="w-full resize-none text-[length:var(--text-base)]" placeholder="شرح سند" aria-label="شرح سند" />
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
          <GoButton icon="save" isDisabled={busy || !ready} onPress={() => void save()}>ثبت سند</GoButton>
        </div>
      </BottomSheet>
    </section>
  );
}

/** H3: cancel a manual سند with a reason; the original stays and a mirror entry is posted. */
export function ReverseManualButton({ journalId }: { journalId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    const err = await send({ action: "reverse", id: journalId, reason });
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    router.refresh();
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mr-2 inline-flex min-h-11 items-center gap-1 text-[length:var(--text-xs)] text-danger"><Icon name="undo" size="sm" />ابطال</button>
      <BottomSheet open={open} title="ابطال سند دستی" onClose={() => setOpen(false)} closeLabel="بستن ابطال سند">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <FieldArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full resize-none text-[length:var(--text-base)]" placeholder="دلیل ابطال" aria-label="دلیل ابطال" />
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
          <GoButton icon="undo" isDisabled={busy || reason.trim() === ""} onPress={() => void save()}>سند را باطل کن</GoButton>
        </div>
      </BottomSheet>
    </>
  );
}
