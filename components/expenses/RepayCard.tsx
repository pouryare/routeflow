"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import { idemKeeper } from "@/lib/idemKey";
import { friendlyError } from "@/lib/userMessage";
import { faNum, faToman } from "@/lib/format";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import KeypadField from "@/components/mobile/KeypadField";
import { toNumber } from "@/lib/money";
import type { OwedRow } from "@/lib/repo/expenseClaims";

/** F88, owner only: what the business owes one person, and two buttons to pay it back (cash box or bank). */
export default function RepayCard({ row, loanBalance = 0 }: { row: OwedRow; loanBalance?: number }) {
  const router = useRouter();
  const [idem] = useState(idemKeeper);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* A person who also owes a loan: ask how much of it to take off this payment (none, all that fits, or a part). */
  const [take, setTake] = useState<"none" | "all" | "part">("none");
  const [part, setPart] = useState("");
  const maxTake = Math.min(row.owed_toman, loanBalance);
  const deduct = take === "none" ? 0 : take === "all" ? maxTake : Math.min(toNumber(part) ?? 0, maxTake);

  async function pay(method: "CASH" | "TRANSFER") {
    setBusy(true); setError(null);
    const res = await fetch("/api/expense-claims/repay", { method: "POST", headers: { "Content-Type": "application/json", ...idem.headers() }, body: JSON.stringify({ user_id: row.user_id, method, deduct_toman: deduct }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) { idem.renew(); router.refresh(); }
    else setError(friendlyError(j?.error, "پرداخت ثبت نشد؛ دوباره تلاش کنید"));
  }

  return (
    <section className="card mb-[var(--space-3)] flex flex-col gap-[var(--space-2)] p-[var(--space-4)]" data-tour="claim-repay">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{row.user_name}</span>
        <span className="tnum font-medium">{faToman(row.owed_toman)}</span>
      </div>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">{faNum(row.claims)} هزینهٔ تأییدشده، هنوز پرداخت نشده</p>
      {loanBalance > 0 ? (
        <div className="flex flex-col gap-[var(--space-2)]" data-tour="loan-deduct">
          <p className="m-0 text-[length:var(--text-sm)]">این نفر {faToman(loanBalance)} به شرکت بدهکار است. چقدر از آن کسر شود؟</p>
          <ChipGroup wrap group={{ id: "deduct", label: "کسر از وام", mode: "single", neutral: "__none", value: take, onChange: (v) => { if (v === "none" || v === "all" || v === "part") setTake(v); }, options: [{ id: "none", label: "کسر نشود" }, { id: "all", label: `همه (${faToman(maxTake)})` }, { id: "part", label: "بخشی از آن" }] }} />
          {take === "part" ? <KeypadField label="مبلغ کسر" value={part} onChange={setPart} unit="تومان" /> : null}
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">به او پرداخت می‌شود: {faToman(row.owed_toman - deduct)}</p>
        </div>
      ) : null}
      {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }} role="status">{error}</p> : null}
      <div className="flex flex-wrap gap-[var(--space-2)]">
        <button type="button" disabled={busy} onClick={() => void pay("CASH")} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] px-[var(--space-3)] text-[length:var(--text-sm)]">
          <Icon name="banknote" size="md" /> پرداخت نقدی
        </button>
        <button type="button" disabled={busy} onClick={() => void pay("TRANSFER")} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
          <Icon name="send" size="md" /> پرداخت از بانک
        </button>
      </div>
    </section>
  );
}
