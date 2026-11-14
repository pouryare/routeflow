"use client";

import { useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import KeypadField from "@/components/mobile/KeypadField";
import { GoButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";
import { TERM_KINDS, termLabel, type TermKind, isTermKind } from "@/lib/paymentTerms";
import { toNumber } from "@/lib/money";

/** D5 «شرایط پرداخت»: cash on delivery, N days after delivery, or end of month plus N days. Applies to orders delivered from now on. */
export default function PaymentTermsSheet({ open, onClose, customerId, name, kind, days, onDone }: {
  open: boolean;
  onClose: () => void;
  customerId: number;
  name: string;
  kind: string | undefined;
  days: number;
  onDone: () => void;
}) {
  const [k, setK] = useState<TermKind>(isTermKind(kind) ? kind : "days");
  const [n, setN] = useState(String(days));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const daysN = k === "cod" ? 0 : toNumber(n);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/terms`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: k, days: daysN }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      onDone();
      onClose();
    } else setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
  }

  return (
    <BottomSheet open={open} title="شرایط پرداخت" subtitle={`${name} · اکنون: ${termLabel(isTermKind(kind) ? kind : "days", days)}`} onClose={onClose} closeLabel="بستن شرایط پرداخت">
      <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
        <ChipGroup wrap group={{ id: "kind", label: "نوع", mode: "single", neutral: "__none", value: k, onChange: (v) => { if (isTermKind(v)) setK(v); }, options: TERM_KINDS.map((t) => ({ id: t.id, label: t.label })) }} />
        {k !== "cod" ? <KeypadField label="تعداد روز" value={n} onChange={setN} unit="روز" /> : null}
        {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
        <GoButton icon="save" isDisabled={busy || daysN === null || daysN < 0} onPress={() => void save()}>ذخیرهٔ شرایط</GoButton>
      </div>
    </BottomSheet>
  );
}
