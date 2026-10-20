"use client";

import { useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";

/** Confirming is a separate, deliberate click rather than part of saving.
 *
 *  It is the point after which the numbers stop being editable, so it asks first. The
 *  cost of a mis-click is a reversal line on a financial record; the cost of a
 *  confirmation dialog is one tap.
 */
export default function ConfirmOrderButton({ orderId }: { orderId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "confirmed" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(friendlyError(json.error, "سفارش تأیید نشد؛ دوباره تلاش کنید"));
        return;
      }
      setAsking(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return <span className="text-[length:var(--text-sm)] text-[var(--crit)]">{error}</span>;
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-5)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter] duration-[var(--dur-base)] hover:brightness-110"
      >
        <Icon name="check" size="sm" />
        تأیید سفارش
      </button>
    );
  }

  return (
    <div className="flex items-center gap-[var(--space-2)]">
      <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
        بعد از تأیید قابل ویرایش نیست.
      </span>
      <button
        type="button"
        onClick={confirm}
        disabled={busy}
        className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-accent-ink disabled:opacity-50"
      >
        <Icon name="check" size="sm" />
        {busy ? "در حال تأیید سفارش…" : "تأیید سفارش"}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
      >
        <Icon name="x" size="sm" />
        انصراف از تأیید سفارش
      </button>
    </div>
  );
}
