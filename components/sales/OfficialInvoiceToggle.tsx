"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import { friendlyError } from "@/lib/userMessage";

/** D7 on a draft order: «فاکتور رسمی» on or off. The number is given when the order is confirmed. */
export default function OfficialInvoiceToggle({ orderId, on }: { orderId: number; on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/sales/orders/${orderId}/official`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: !on }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) router.refresh();
    else setError(friendlyError(j?.error, "تغییر نکرد؛ دوباره تلاش کنید"));
  }

  return (
    <span className="inline-flex flex-col gap-[var(--space-1)]">
      <button type="button" disabled={busy} aria-pressed={on} onClick={() => void flip()} className="btn ghost touch" data-tour="order-official">
        <Icon name="receipt" size="md" />
        {on ? "فاکتور رسمی: روشن" : "فاکتور رسمی"}
      </button>
      {error ? <span className="text-[length:var(--text-xs)]" style={{ color: "var(--danger)" }}>{error}</span> : null}
    </span>
  );
}
