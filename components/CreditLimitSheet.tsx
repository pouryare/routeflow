"use client";

import { useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import { FieldArea } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";
import { needsSignOff } from "@/lib/changeRequests";
import { faToman } from "@/lib/format";
import { toNumber } from "@/lib/money";

/** F48 «سقف اعتبار»: a manager's raise goes to the owner for sign-off, a lowering applies at once. */
export default function CreditLimitSheet({ open, onClose, customerId, name, limit, isOwner, onDone }: {
  open: boolean;
  onClose: () => void;
  customerId: number;
  name: string;
  limit: number | null;
  isOwner: boolean;
  onDone: () => void;
}) {
  const [n, setN] = useState(limit === null ? "" : String(limit));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = n.trim() === "" ? null : toNumber(n);
  const waits = !isOwner && needsSignOff(limit, value);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/credit-limit`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: value, reason }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string; result?: string } | undefined;
    setBusy(false);
    if (!res?.ok) return setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
    onDone();
    if (j?.result === "pending") setMessage("درخواست برای تأیید مالک فرستاده شد.");
    else onClose();
  }

  return (
    <BottomSheet open={open} title="سقف اعتبار" subtitle={`${name} · اکنون: ${limit === null ? "بدون سقف" : faToman(limit)}`} onClose={onClose} closeLabel="بستن سقف اعتبار">
      <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
        {message ? (
          <p className="m-0 text-[length:var(--text-sm)]">{message}</p>
        ) : (
          <>
            <KeypadField label="سقف جدید (خالی = بدون سقف)" value={n} onChange={setN} unit="تومان" />
            {waits ? <FieldArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل افزایش (برای مالک)" rows={2} className="w-full resize-none" /> : null}
            {waits ? <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">افزایش سقف تا تأیید مالک اعمال نمی‌شود.</p> : null}
            {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
            {waits ? (
              <GoButton icon="send" isDisabled={busy || !reason.trim()} onPress={() => void save()}>ارسال برای تأیید</GoButton>
            ) : (
              <GoButton icon="save" isDisabled={busy} onPress={() => void save()}>ذخیرهٔ سقف</GoButton>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
