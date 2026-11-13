"use client";

import { useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";

/** D7 «کد اقتصادی / شناسهٔ ملی»: the buyer's tax code an official invoice prints. Empty clears it. */
export default function TaxIdSheet({ open, onClose, customerId, name, taxId, onDone }: {
  open: boolean;
  onClose: () => void;
  customerId: number;
  name: string;
  taxId: string | null;
  onDone: () => void;
}) {
  const [v, setV] = useState(taxId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/tax-id`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taxId: v }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      onDone();
      onClose();
    } else setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
  }

  return (
    <BottomSheet open={open} title="کد اقتصادی مشتری" subtitle={name} onClose={onClose} closeLabel="بستن کد اقتصادی">
      <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
        <label className="flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]">کد اقتصادی یا شناسهٔ ملی (۱۰ تا ۱۴ رقم)<FieldInput value={v} onChange={(e) => setV(e.target.value)} inputMode="numeric" maxLength={14} dir="ltr" /></label>
        {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
        <GoButton icon="save" isDisabled={busy} onPress={() => void save()}>ذخیره</GoButton>
      </div>
    </BottomSheet>
  );
}
