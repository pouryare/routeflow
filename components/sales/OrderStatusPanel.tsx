"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import { ACTION_LABEL, needsReason } from "@/lib/flows/orderAction";
import { useUndoableAction } from "@/components/tapflow/useUndoableAction";
import OrderActionFlow from "@/components/flows/OrderActionFlow";
import {
  legalOrderActions,
  ORDER_STATUS_LABEL,
  type OrderStatus,
  type OrderAction,
  type OrderRole,
} from "@/lib/orderStateMachine";

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
  /* An action that ends something asks why first, in a sheet that remounts per opening (the
     key) and stays mounted after it closes so the undo can reopen it. Every other action is one
     tap with the 5 s undo and no "are you sure?". */
  const { run: runUndoable, pending } = useUndoableAction();
  const [ask, setAsk] = useState<{ key: number; open: boolean; action: OrderAction } | null>(null);

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

  function run(action: OrderAction) {
    if (needsReason(action)) {
      setAsk((a) => ({ key: (a?.key ?? 0) + 1, open: true, action }));
      return;
    }
    runUndoable({
      message: `${ACTION_LABEL[action]} ثبت شد`,
      failure: "وضعیت سفارش تغییر نکرد. اینترنت را بررسی کنید و دوباره تلاش کنید.",
      send: async () => {
        const res = await fetch(`/api/sales/orders/${orderId}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (res.ok) return { ok: true };
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: j.error };
      },
      onDone: () => router.refresh(),
    });
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
            disabled={pending}
            onClick={() => run(a)}
            className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50"
          >
            <Icon name="package" size="sm" />
            {ACTION_LABEL[a]}
          </button>
        ))}
      </div>
      {ask && (
        <OrderActionFlow
          key={ask.key}
          open={ask.open}
          orderId={orderId}
          action={ask.action}
          onDone={() => router.refresh()}
          onClose={() => setAsk((a) => (a ? { ...a, open: false } : a))}
          onReopen={() => setAsk((a) => (a ? { ...a, open: true } : a))}
        />
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
