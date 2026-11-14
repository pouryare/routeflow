"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import { idemKeeper } from "@/lib/idemKey";
import { friendlyError } from "@/lib/userMessage";

/** D17: «پیش‌نویس سفارش خرید» for one supplier's group on the buy list. Nothing is sent to the supplier: it makes a
 *  draft on «سفارش‌های خرید» that the owner sends, changes or cancels there. */
export default function BuyDraftButton({ supplierId, expectedDate, lines }: { supplierId: number; expectedDate: string | null; lines: { product_id: number; base_qty: number; unit_cost_toman: number }[] }) {
  const router = useRouter();
  const [idem] = useState(idemKeeper);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make() {
    setBusy(true); setError(null);
    const res = await fetch("/api/sales/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json", ...idem.headers() }, body: JSON.stringify({ supplier_id: supplierId, expected_date: expectedDate, lines }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) { idem.renew(); router.push("/sales/stock/orders?all=1"); }
    else setError(friendlyError(j?.error, "ساخته نشد؛ دوباره تلاش کنید"));
  }

  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <button type="button" disabled={busy} onClick={() => void make()} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--accent)] px-[var(--space-3)] text-[length:var(--text-sm)]">
        <Icon name="plus" size="md" /> پیش‌نویس سفارش خرید
      </button>
      {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }} role="status">{error}</p> : null}
    </div>
  );
}
