"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import KeypadField from "@/components/mobile/KeypadField";
import JalaliDatePicker from "@/components/JalaliDatePicker";
import { FieldInput } from "@/components/FieldInput";
import { Icon } from "@/components/meridian/Icon";
import { GoButton } from "@/components/tapflow/Answer";
import { idemKeeper } from "@/lib/idemKey";
import { friendlyError } from "@/lib/userMessage";
import { tehranTodayIso } from "@/lib/jalali";
import { toToman } from "@/lib/money";
import { TRANSFER_ACCOUNTS } from "@/lib/transferAccounts";

/** A4 «انتقال وجه»: from, to, amount, date, bank tracking number and an optional fee, in one entry. Example: box → bank, 5,000,000. */
export default function TransferSheet() {
  const router = useRouter();
  const [idem] = useState(idemKeeper);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("1101");
  const [to, setTo] = useState("1102");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [date, setDate] = useState(tehranTodayIso);
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opts = TRANSFER_ACCOUNTS.map((a) => ({ id: a.code, label: a.label }));
  const amountN = toToman(amount);
  const feeN = fee === "" ? 0 : toToman(fee);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/accounting/transfers", { method: "POST", headers: { "Content-Type": "application/json", ...idem.headers() }, body: JSON.stringify({ from, to, amount_toman: amountN, fee_toman: feeN, date, tracking }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      idem.renew();
      setOpen(false);
      setAmount("");
      setFee("");
      setTracking("");
      router.refresh();
    } else setError(friendlyError(j?.error, "انتقال ثبت نشد؛ دوباره تلاش کنید"));
  }

  return (
    <>
      <button data-tour="open:transfer" type="button" onClick={() => setOpen(true)} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]">
        <Icon name="repeat" size="md" />
        انتقال وجه
      </button>
      <BottomSheet open={open} title="انتقال وجه" subtitle="بین صندوق، بانک و تنخواه" onClose={() => setOpen(false)} closeLabel="بستن فرم انتقال وجه">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <ChipGroup wrap group={{ id: "from", label: "از", mode: "single", neutral: "__none", value: from, onChange: (v) => { if (v !== "__none") setFrom(v as string); }, options: opts }} />
          <ChipGroup wrap group={{ id: "to", label: "به", mode: "single", neutral: "__none", value: to, onChange: (v) => { if (v !== "__none") setTo(v as string); }, options: opts }} />
          <KeypadField label="مبلغ انتقال" value={amount} onChange={setAmount} unit="تومان" />
          <JalaliDatePicker id="transfer-date" label="تاریخ" value={date} onChange={setDate} />
          <FieldInput value={tracking} onChange={(e) => setTracking(e.target.value)} aria-label="شمارهٔ پیگیری بانک" placeholder="شمارهٔ پیگیری بانک (اختیاری)" className="min-h-[44px] w-full" />
          <KeypadField label="کارمزد (اختیاری)" value={fee} onChange={setFee} unit="تومان" />
          {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
          <GoButton icon="repeat" isDisabled={busy || amountN === null || amountN <= 0 || feeN === null || from === to} onPress={() => void save()}>ثبت انتقال</GoButton>
        </div>
      </BottomSheet>
    </>
  );
}
