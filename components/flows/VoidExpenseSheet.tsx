"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { GoButton } from "@/components/tapflow/Answer";
import { idemKeeper } from "@/lib/idemKey";
import { friendlyError } from "@/lib/userMessage";
import { faNum } from "@/lib/format";

const REASONS = ["اشتباه در مبلغ", "ثبت تکراری", "اشتباه در دسته", "هزینه انجام نشد"];

/** H6 «باطل کردن»: a wrong expense is voided with a reason; the books keep both entries. Example: 500,000 fuel typed twice → void one, reason «ثبت تکراری». */
export default function VoidExpenseSheet({ journalId, label, amount, onClose }: { journalId: number | null; label: string; amount: number; onClose: () => void }) {
  const router = useRouter();
  const [idem] = useState(idemKeeper);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/accounting/expenses/${journalId}/void`, { method: "POST", headers: { "Content-Type": "application/json", ...idem.headers() }, body: JSON.stringify({ reason }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) {
      idem.renew();
      setReason("");
      onClose();
      router.refresh();
    } else setError(friendlyError(j?.error, "باطل نشد؛ دوباره تلاش کنید"));
  }

  return (
    <BottomSheet open={journalId !== null} title="باطل کردن هزینه" subtitle={`${label} · ${faNum(amount)} تومان`} onClose={onClose} closeLabel="بستن فرم باطل کردن">
      <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
        <ChipGroup wrap group={{ id: "reason", label: "دلیل", mode: "single", neutral: "", value: reason, onChange: (v) => setReason(v as string), options: REASONS.map((r) => ({ id: r, label: r })) }} />
        {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
        <GoButton isDisabled={busy || reason === ""} onPress={() => void save()}>باطل کردن هزینه</GoButton>
      </div>
    </BottomSheet>
  );
}
