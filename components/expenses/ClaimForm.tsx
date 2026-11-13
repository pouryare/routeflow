"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { idemKeeper } from "@/lib/idemKey";
import { friendlyError } from "@/lib/userMessage";
import { toNumber } from "@/lib/money";

/** F26/F88: «ثبت هزینه» for any staff member: pick what it was for, type the amount, add a note. The day is today
 *  (shortcut: no back-dating from the phone; a manager can book an older cost by hand in the accounts). */
export default function ClaimForm({ categories }: { categories: { id: number; nameFa: string }[] }) {
  const router = useRouter();
  const [idem] = useState(idemKeeper);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch("/api/expense-claims", { method: "POST", headers: { "Content-Type": "application/json", ...idem.headers() }, body: JSON.stringify({ account_id: Number(category), amount_toman: toNumber(amount) ?? 0, note }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) { idem.renew(); setOpen(false); setCategory(""); setAmount(""); setNote(""); router.refresh(); }
    else setError(friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید"));
  }

  return (
    <>
      <button type="button" data-tour="claim-new" onClick={() => setOpen(true)} className="inline-flex min-h-[48px] w-full items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-4)] font-medium text-[var(--on-accent)]">
        <Icon name="plus" size="md" /> ثبت هزینه
      </button>
      <BottomSheet open={open} title="ثبت هزینه" subtitle="هزینه‌ای که از جیب خودتان برای کار پرداخت کرده‌اید" onClose={() => setOpen(false)} closeLabel="بستن فرم هزینه">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <ChipGroup wrap group={{ id: "cat", label: "بابت چه چیزی بود؟", mode: "single", options: categories.map((c) => ({ id: String(c.id), label: c.nameFa })), value: category, onChange: (v) => setCategory(v as string) }} />
          <KeypadField label="مبلغ" unit="تومان" value={amount} onChange={setAmount} />
          <FieldInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیح، مثلاً تعویض لاستیک (اختیاری)" aria-label="توضیح هزینه" maxLength={200} />
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }} role="status">{error}</p> : null}
          <GoButton icon="send" isDisabled={busy || !category || !amount} onPress={() => void save()}>ارسال برای تأیید</GoButton>
        </div>
      </BottomSheet>
    </>
  );
}
