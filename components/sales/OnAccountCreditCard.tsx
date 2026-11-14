"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GoButton } from "@/components/tapflow/Answer";
import { faToman } from "@/lib/format";
import { friendlyError } from "@/lib/userMessage";

/** F63 on an unpaid delivered order: the customer already paid ahead, so one tap puts that credit on this order. */
export default function OnAccountCreditCard({ orderId, credit, owes }: { orderId: number; credit: number; owes: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usable = Math.min(credit, owes);
  async function apply() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/payments/apply-credit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: orderId }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) router.refresh();
    else setError(friendlyError(j?.error, "انجام نشد؛ دوباره تلاش کنید"));
  }
  return (
    <section className="card flex flex-col gap-[var(--space-2)] p-[var(--space-4)]" dir="rtl" data-tour="on-account-credit" aria-label="اعتبار روی حساب">
      <p className="m-0 text-[length:var(--text-sm)]">
        این مشتری {faToman(credit)} پیش‌پرداخت روی حساب دارد. با یک لمس {faToman(usable)} از آن را روی این سفارش بگذارید.
      </p>
      {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
      <GoButton icon="check" isDisabled={busy} onPress={() => void apply()}>گذاشتن روی این سفارش</GoButton>
    </section>
  );
}
