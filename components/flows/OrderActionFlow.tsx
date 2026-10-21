"use client";

import { useEffect, useMemo, useState } from "react";
import TapFlow from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import type { OrderAction } from "@/lib/orderStateMachine";
import { ACTION_LABEL, REASON_DOMAIN, actionBody, actionSummary, orderActionFlow } from "@/lib/flows/orderAction";

const FAILURE = "وضعیت سفارش تغییر نکرد. اینترنت را بررسی کنید و دوباره تلاش کنید.";

/** «چرا؟» for the order actions that end something (cancel, return, failed delivery), as a
 *  bottom sheet of the organisation's own reasons. The chosen reason travels with the
 *  transition. Mount it with a fresh `key` each time it opens. */
export default function OrderActionFlow({
  open,
  orderId,
  action,
  onDone,
  onClose,
  onReopen,
}: {
  open: boolean;
  orderId: number;
  action: OrderAction;
  onDone: () => void;
  onClose: () => void;
  onReopen?: () => void;
}) {
  const domain = REASON_DOMAIN[action];
  const [reasons, setReasons] = useState<{ id: number; label: string }[] | null>(null);

  useEffect(() => {
    if (!domain) return;
    let alive = true;
    fetch(`/api/sales/reason-codes?domain=${domain}`)
      .then((r) => r.json())
      .then((j: { ok?: boolean; reason_codes?: { id: number; label_fa: string }[] }) => {
        if (alive) setReasons(j.ok ? (j.reason_codes ?? []).map((c) => ({ id: c.id, label: c.label_fa })) : []);
      })
      .catch(() => {
        if (alive) setReasons([]);
      });
    return () => {
      alive = false;
    };
  }, [domain]);

  const ctx = useMemo<FlowContext>(
    () => ({
      ...EMPTY_CONTEXT,
      entry: "order_action",
      items: reasons ?? [],
      vars: { action, action_label: ACTION_LABEL[action], reasons: reasons === null ? "loading" : "ready" },
    }),
    [action, reasons],
  );

  const { state, setState, onSaved } = useFlowHost(orderActionFlow, ctx, {
    send: async (st) => {
      const res = await fetch(`/api/sales/orders/${orderId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(actionBody(action, st)),
      });
      if (res.ok) return { ok: true };
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error };
    },
    summary: (st) => actionSummary(action, st),
    failure: FAILURE,
    onFinished: onDone,
    onReopen,
  });

  return (
    <TapFlow
      open={open}
      title={ACTION_LABEL[action]}
      config={orderActionFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onClose}
      done={<FlowDone key={state.answers.length} chips={[actionSummary(action, state)]} onReturn={onClose} />}
    />
  );
}
