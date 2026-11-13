"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import { idemKeeper } from "@/lib/idemKey";
import { friendlyError } from "@/lib/userMessage";
import { faNum, faToman } from "@/lib/format";
import type { OwedRow } from "@/lib/repo/expenseClaims";

/** F88, owner only: what the business owes one person, and two buttons to pay it back (cash box or bank). */
export default function RepayCard({ row }: { row: OwedRow }) {
  const router = useRouter();
  const [idem] = useState(idemKeeper);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(method: "CASH" | "TRANSFER") {
    setBusy(true); setError(null);
    const res = await fetch("/api/expense-claims/repay", { method: "POST", headers: { "Content-Type": "application/json", ...idem.headers() }, body: JSON.stringify({ user_id: row.user_id, method }) }).catch(() => null);
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
