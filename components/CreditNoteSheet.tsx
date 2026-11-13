"use client";

import { useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { GoButton } from "@/components/tapflow/Answer";
import { idemKeeper } from "@/lib/idemKey";
import { CREDIT_NOTE_REASONS, mayRefundCash } from "@/lib/creditNote";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";

/** B1 «برگشت از فروش»: a manager credits a customer for goods that came back after delivery. It lowers what the customer owes,
 *  oldest orders first, or (when the customer already paid) is paid back in cash under the owner's limit.
 *  Example: 3 cartons of damaged cooking oil, 450,000 → the debt drops by 450,000. It moves no stock. */
export default function CreditNoteSheet({ open, onClose, customerId, name, owed, refund, onDone }: {
  open: boolean;
  onClose: () => void;
  customerId: number;
  name: string;
  owed: number;
  /** The cash-refund limit and whether this person is the owner. */
  refund: { limit: number; owner: boolean };
  onDone: () => void;
}) {
  const [idem] = useState(idemKeeper);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<string>("");
  const [mode, setMode] = useState<"debt" | "cash">(owed > 0 ? "debt" : "cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(amount);
  const cash = mode === "cash";
  const ok = Number.isInteger(n) && n > 0 && reason !== "" && (cash ? mayRefundCash(refund.owner, n, refund.limit) : n <= owed);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/payments/credit-note", { method: "POST", headers: { "Content-Type": "application/json", ...idem.headers() }, body: JSON.stringify({ customer_id: customerId, amount_toman: n, reason, cash }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      idem.renew();
      onDone();
      onClose();
    } else setError(friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید"));
  }

  return (
    <BottomSheet open={open} title="برگشت از فروش" subtitle={`${name} · مانده ${faNum(owed)} تومان`} onClose={onClose} closeLabel="بستن فرم برگشت از فروش">
      <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
        <ChipGroup wrap group={{ id: "mode", label: "پول چطور برگردد", mode: "single", neutral: "", value: mode, onChange: (v) => { if (v === "debt" || v === "cash") setMode(v); }, options: [...(owed > 0 ? [{ id: "debt", label: "از بدهی کم شود" }] : []), { id: "cash", label: "نقد به مشتری پس داده شد" }] }} />
        <KeypadField label="ارزش کالای برگشتی" value={amount} onChange={setAmount} unit="تومان" />
        <ChipGroup wrap group={{ id: "reason", label: "دلیل", mode: "single", neutral: "", value: reason, onChange: (v) => setReason(v as string), options: CREDIT_NOTE_REASONS.map((r) => ({ id: r.id, label: r.label })) }} />
        {cash ? <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">{refund.owner ? "پول از صندوق شرکت کم می‌شود." : `پول از صندوق شرکت کم می‌شود؛ سقف شما ${faNum(refund.limit)} تومان است.`}</p> : null}
        <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">موجودی انبار تغییر نمی‌کند؛ کالا را از صفحهٔ انبار برگردانید یا خارج کنید.</p>
        {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
        <GoButton icon="undo" isDisabled={busy || !ok} onPress={() => void save()}>{cash ? "ثبت پرداخت نقدی" : "ثبت برگشت"}</GoButton>
      </div>
    </BottomSheet>
  );
}
