"use client";

import { useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { GoButton } from "@/components/tapflow/Answer";
import { idemKeeper } from "@/lib/idemKey";
import { LEFTOVER_REASONS, mayCloseLeftover } from "@/lib/leftover";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";

/** D3 «بستن مانده کوچک»: a manager forgives a small balance with a reason. The amount starts at what is owed. Example:
 *  owed 3,000 after a rounded payment → «گردکردن» → the debt list no longer shows the customer. */
export default function LeftoverSheet({ open, onClose, customerId, name, owed, limit, owner, onDone }: {
  open: boolean;
  onClose: () => void;
  customerId: number;
  name: string;
  owed: number;
  limit: number;
  owner: boolean;
  onDone: () => void;
}) {
  const [idem] = useState(idemKeeper);
  const [amount, setAmount] = useState(String(owed));
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(amount);
  const ok = Number.isInteger(n) && n <= owed && mayCloseLeftover(owner, n, limit) && reason !== "";

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/payments/leftover", { method: "POST", headers: { "Content-Type": "application/json", ...idem.headers() }, body: JSON.stringify({ customer_id: customerId, amount_toman: n, reason }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      idem.renew();
      onDone();
      onClose();
    } else setError(friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید"));
  }

  return (
    <BottomSheet open={open} title="بستن مانده کوچک" subtitle={`${name} · مانده ${faNum(owed)} تومان`} onClose={onClose} closeLabel="بستن فرم بستن مانده">
      <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
        <KeypadField label="مبلغ بسته‌شده" value={amount} onChange={setAmount} unit="تومان" />
        {!owner ? <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">تا {faNum(limit)} تومان؛ بیشتر از آن را مالک می‌بندد.</p> : null}
        <ChipGroup wrap group={{ id: "reason", label: "دلیل", mode: "single", neutral: "", value: reason, onChange: (v) => setReason(v as string), options: LEFTOVER_REASONS.map((r) => ({ id: r.id, label: r.label })) }} />
        {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
        <GoButton icon="x" isDisabled={busy || !ok} onPress={() => void save()}>بستن مانده</GoButton>
      </div>
    </BottomSheet>
  );
}
