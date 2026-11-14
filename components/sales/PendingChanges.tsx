"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SectionHead from "@/components/meridian/SectionHead";
import { GoButton } from "@/components/tapflow/Answer";
import { friendlyError } from "@/lib/userMessage";
import { faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { PendingChange } from "@/lib/repo/changeRequests";

const show = (v: number | null) => (v === null ? "بدون سقف" : faToman(v));

/** F48: changes a manager asked for (a credit-limit raise, an edit of a confirmed order), waiting for the owner. */
export default function PendingChanges({ items }: { items: PendingChange[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  async function decide(id: number, verdict: "approved" | "rejected") {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/change-requests/${id}/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verdict }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(null);
    if (res?.ok) router.refresh();
    else setError(friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید"));
  }

  return (
    <section className="card mb-[var(--space-4)] p-[var(--space-4)]" dir="rtl" data-tour="pending-changes">
      <SectionHead title="درخواست‌های منتظر تأیید" as="h3" className="mb-[var(--space-3)]" />
      <ul className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0 text-[length:var(--text-sm)]">
        {items.map((c) => (
          <li key={c.id} className="flex flex-col gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-3)]">
            <Link href={`/crm/${c.customer_id}`} className="inline-flex min-h-11 items-center font-medium text-[var(--foreground)]">{c.customer_name}</Link>
            {c.kind === "order_edit" ? (
              <>
                <Link href={`/sales/orders/${c.order_id}`} className="inline-flex min-h-11 items-center text-[var(--foreground)]">{c.field_label} سفارش {c.order_no}</Link>
                <span>{c.old_text} ← {c.new_text}</span>
              </>
            ) : (
              <span>سقف اعتبار: {show(c.old_value)} ← {show(c.new_value)}</span>
            )}
            <span className="text-[var(--muted)]">{c.requested_by_name} · {faJalaliDate(c.requested_at)} · {c.reason}</span>
            <div className="flex gap-[var(--space-2)]">
              <GoButton icon="check" isDisabled={busy === c.id} onPress={() => void decide(c.id, "approved")}>تأیید</GoButton>
              <GoButton icon="x" isDisabled={busy === c.id} onPress={() => void decide(c.id, "rejected")}>ردّ درخواست</GoButton>
            </div>
          </li>
        ))}
      </ul>
      {error ? <p className="m-0 mt-[var(--space-2)] text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
    </section>
  );
}
