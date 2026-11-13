"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import { FieldInput } from "@/components/FieldInput";
import { friendlyError } from "@/lib/userMessage";
import { faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { ClaimRow } from "@/lib/repo/expenseClaims";

/** F88: a claim waiting for this manager or the owner. «رد» asks for a reason first, so the person always learns why. */
export default function ClaimDecisionCard({ claim }: { claim: ClaimRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(true); setError(null);
    const res = await fetch(`/api/expense-claims/${claim.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) router.refresh();
    else setError(friendlyError(j?.error, "انجام نشد؛ دوباره تلاش کنید"));
  }

  return (
    <section className="card mb-[var(--space-3)] flex flex-col gap-[var(--space-2)] p-[var(--space-4)]" data-tour="claim-decide">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{claim.user_name}</span>
        <span className="tnum font-medium">{faToman(claim.amount_toman)}</span>
      </div>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">{claim.account_name} · {faJalaliDate(claim.incurred_at)}{claim.note ? ` · ${claim.note}` : ""}</p>
      {rejecting ? <FieldInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل رد" aria-label="دلیل رد" maxLength={200} /> : null}
      {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }} role="status">{error}</p> : null}
      <div className="flex flex-wrap gap-[var(--space-2)]">
        {rejecting ? (
          <button type="button" disabled={busy || !reason.trim()} onClick={() => void decide("reject")} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--danger)] px-[var(--space-3)] text-[length:var(--text-sm)]">
            <Icon name="x" size="md" /> ثبت رد
          </button>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => void decide("approve")} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] px-[var(--space-3)] text-[length:var(--text-sm)]">
              <Icon name="check" size="md" /> تأیید هزینه
            </button>
            <button type="button" disabled={busy} onClick={() => setRejecting(true)} className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
              <Icon name="x" size="md" /> رد هزینه
            </button>
          </>
        )}
      </div>
    </section>
  );
}
