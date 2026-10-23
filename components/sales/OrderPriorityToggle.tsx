"use client";

import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import { useUndoableAction } from "@/components/tapflow/useUndoableAction";
import { priorityLabel } from "@/lib/orderPriority";

/** One tap to mark an order urgent, or back to normal (F132), with the usual 5 s undo. */
export default function OrderPriorityToggle({ orderId, priority }: { orderId: number; priority: string }) {
  const router = useRouter();
  const { run, pending } = useUndoableAction();
  const urgent = priority === "URGENT";
  const next = urgent ? "NORMAL" : "URGENT";

  function flip() {
    run({
      message: urgent ? "سفارش دیگر فوری نیست." : "سفارش فوری شد و در برنامه‌ریزی جلوتر می‌آید.",
      failure: "اولویت ذخیره نشد. دوباره تلاش کنید.",
      send: async () => {
        const res = await fetch(`/api/sales/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: next }),
        });
        if (res.ok) return { ok: true };
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: json.error };
      },
      onDone: () => router.refresh(),
    });
  }

  return (
    <button
      type="button"
      onClick={flip}
      disabled={pending}
      aria-pressed={urgent}
      className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border px-[var(--space-4)] text-[length:var(--text-sm)] disabled:opacity-50"
      style={{ borderColor: urgent ? "var(--crit)" : "var(--border)", color: urgent ? "var(--crit)" : "var(--text-muted)" }}
    >
      <Icon name="flag" size="sm" />
      {urgent ? `${priorityLabel("URGENT")} · برگرداندن به عادی` : "فوری کن"}
    </button>
  );
}
