"use client";

import { useEffect, useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import {
  legalOrderActions,
  ORDER_STATUS_LABEL,
  type OrderStatus,
  type OrderAction,
  type OrderRole,
} from "@/lib/orderStateMachine";

const ACTION_LABEL: Record<OrderAction, string> = {
  submit: "ارسال برای بررسی",
  passReview: "تأیید سفارش",
  flagCredit: "—",
  approveCredit: "تأیید اعتبار",
  rejectCredit: "رد اعتبار",
  releaseHold: "رفع توقف سفارش",
  plan: "برنامه‌ریزی",
  unplan: "بازگشت به تأییدشده",
  freeze: "قطعی‌کردن مسیر",
  startRoute: "شروع مسیر",
  deliver: "ثبت تحویل کامل",
  deliverPartial: "ثبت تحویل ناقص",
  failDelivery: "ثبت تحویل ناموفق",
  retryDelivery: "برنامه‌ریزی مجدد",
  settle: "بستن سفارش",
  cancel: "لغو سفارش",
  returnOrder: "ثبت مرجوعی",
};

interface OrderEvent {
  id: number;
  from_status: string | null;
  to_status: string;
  action: string;
  actor_name: string | null;
  reason_label: string | null;
  note: string | null;
  created_at: string;
}

export default function OrderStatusPanel({
  orderId,
  status,
  role,
}: {
  orderId: number;
  status: string;
  role: OrderRole;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/sales/orders/${orderId}/events`)
      .then((r) => r.json())
      .then((j) => {
        if (live && j.ok) setEvents(j.events);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [orderId, status]);

  const actions = legalOrderActions(status as OrderStatus, role).filter((a) => a !== "flagCredit");

  async function run(action: OrderAction) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/orders/${orderId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(friendlyError(j.error, "وضعیت سفارش تغییر نکرد؛ دوباره تلاش کنید"));
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-[var(--space-3)]">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <span className="text-[length:var(--text-sm)] font-medium text-[var(--text)]">
          وضعیت: {ORDER_STATUS_LABEL[status as OrderStatus] ?? status}
        </span>
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            disabled={busy}
            onClick={() => void run(a)}
            className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50"
          >
            <Icon name="package" size="sm" />
            {ACTION_LABEL[a]}
          </button>
        ))}
      </div>
      {error && (
        <p className="m-0 text-[length:var(--text-xs)] text-[var(--crit)]">{error}</p>
      )}
      {events.length > 0 && (
        <ol className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">
          {events.map((e) => (
            <li key={e.id}>
              <span className="tabular-nums">{new Date(e.created_at).toLocaleString("fa-IR")}</span>
              {" — "}
              {e.action === "create"
                ? "ثبت سفارش"
                : `${ORDER_STATUS_LABEL[(e.from_status ?? "") as OrderStatus] ?? e.from_status} ← ${
                    ORDER_STATUS_LABEL[e.to_status as OrderStatus] ?? e.to_status
                  }`}
              {e.actor_name ? ` · ${e.actor_name}` : ""}
              {e.reason_label ? ` · ${e.reason_label}` : ""}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
