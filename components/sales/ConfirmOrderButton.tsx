"use client";

import BusyIcon from "@/components/meridian/BusyIcon";
import { useRouter } from "next/navigation";
import { useDoneFlash } from "@/lib/useDoneFlash";
import { useUndoableAction } from "@/components/tapflow/useUndoableAction";

/** Confirming is the point after which the numbers stop being editable, and that is exactly
 *  what the 5 s undo is for: one tap, a toast saying so, and «بازگردانی ثبت» for five seconds
 *  before anything is written. It replaces the old "are you sure?" second tap -- the cost of a
 *  slip was a reversal line on a financial record, and the undo costs nothing when the tap was
 *  right.
 */
export default function ConfirmOrderButton({ orderId }: { orderId: number }) {
  const router = useRouter();
  const { run, pending } = useUndoableAction();
  const [done, flash] = useDoneFlash();

  function confirmNow() {
    run({
      message: "سفارش تأیید شد؛ بعد از تأیید قابل ویرایش نیست.",
      failure: "سفارش تأیید نشد. دوباره تلاش کنید.",
      send: async () => {
        const res = await fetch(`/api/sales/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "confirmed" }),
        });
        if (res.ok) return { ok: true };
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: json.error };
      },
      onDone: () => { flash(); router.refresh(); },
    });
  }

  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <button
        type="button"
        onClick={confirmNow}
        disabled={pending}
        className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-5)] text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter] duration-[var(--dur-base)] hover:brightness-110 disabled:opacity-50"
      >
        <BusyIcon busy={pending} done={done} name="check" size="sm" />
        {pending ? "در حال تأیید سفارش…" : done ? "تأیید شد" : "تأیید سفارش"}
      </button>
      <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
        بعد از تأیید قابل ویرایش نیست؛ تا ۵ ثانیه می‌توانید پشیمان شوید.
      </span>
    </div>
  );
}
