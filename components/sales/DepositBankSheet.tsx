"use client";

import { useCallback, useState } from "react";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { Icon } from "@/components/meridian/Icon";
import { faNum, faToman } from "@/lib/format";
import { friendlyError } from "@/lib/userMessage";
import type { BankAccountView } from "@/lib/repo/bankAccounts";

/** D2: before cheques go on a deposit slip, pick which bank account they go to (or add the first one). */
export default function DepositBankSheet({ count, onClose, onPick }: { count: number; onClose: () => void; onPick: (bankAccountId: number | null) => void }) {
  const [banks, setBanks] = useState<BankAccountView[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/bank-accounts").catch(() => null);
    const j = (await r?.json().catch(() => null)) as { accounts?: BankAccountView[] } | null;
    setBanks(j?.accounts ?? []);
  }, []);
  useRunAfterMount(load);

  async function add() {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/bank-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
    const j = (await r?.json().catch(() => ({}))) as { error?: string; id?: number } | undefined;
    setBusy(false);
    if (!r?.ok) return setError(friendlyError(j?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
    setName("");
    setChosen(String(j?.id));
    await load();
  }

  const none = banks !== null && banks.length === 0;
  return (
    <BottomSheet open title="سپردن به کدام حساب بانکی؟" subtitle={`${faNum(count)} چک`} onClose={onClose} closeLabel="بستن انتخاب حساب" dirty={name !== ""}>
      <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
        {banks && banks.length > 0 ? (
          <ChipGroup wrap group={{ id: "bank", label: "حساب بانکی", mode: "single", neutral: "__none", value: chosen, onChange: (v) => { if (typeof v === "string") setChosen(v); }, options: banks.map((b) => ({ id: String(b.id), label: `${b.name} · ${faToman(b.cleared)}` })) }} />
        ) : null}
        <div className="flex gap-[var(--space-2)]">
          <FieldInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="افزودن حساب بانکی (مثلاً ملت ۱۲۳۴)" aria-label="نام حساب بانکی تازه" />
          <button type="button" className="btn ghost touch" disabled={busy || !name.trim()} onClick={() => void add()}><Icon name="plus" size="md" />افزودن حساب</button>
        </div>
        {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
        <GoButton icon="check" isDisabled={banks === null || (!none && !chosen)} onPress={() => onPick(chosen ? Number(chosen) : null)}>
          {none ? "سپردن بدون حساب" : "سپردن به این حساب"}
        </GoButton>
      </div>
    </BottomSheet>
  );
}
