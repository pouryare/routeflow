"use client";

import { useMemo } from "react";
import TapFlow from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext, type FlowState } from "@/lib/crm/flows/types";
import { lifecycleChips, lifecycleFlow, lifecycleTarget } from "@/lib/flows/lifecycle";
import { LIFECYCLE_LABEL, type CustomerLifecycle } from "@/lib/types";

const FAILURE = "وضعیت مشتری تغییر نکرد. اینترنت را بررسی کنید و دوباره تلاش کنید.";

/** «تغییر وضعیت» for a customer, as a bottom sheet whose answers are the moves the lifecycle
 *  table allows. `onPending` lets the caller show the new state at once (the pill) and take it
 *  back if the move is undone or refused. Mount it with a fresh `key` each time it opens. */
export default function LifecycleFlow({
  open,
  customer,
  onPending,
  onUpdated,
  onClose,
  onReopen,
}: {
  open: boolean;
  customer: { id: number; name: string; lifecycle: CustomerLifecycle };
  onPending?: (to: CustomerLifecycle | null) => void;
  onUpdated?: () => void;
  onClose: () => void;
  onReopen?: () => void;
}) {
  const ctx = useMemo<FlowContext>(
    () => ({
      ...EMPTY_CONTEXT,
      entry: "lifecycle",
      vars: { from: customer.lifecycle, from_label: LIFECYCLE_LABEL[customer.lifecycle], customer: customer.name },
    }),
    [customer.lifecycle, customer.name],
  );

  const { state, setState, onSaved } = useFlowHost(lifecycleFlow, ctx, {
    send: async (st) => {
      const res = await fetch(`/api/customers/${customer.id}/lifecycle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle: lifecycleTarget(st) }),
      });
      if (res.ok) return { ok: true };
      onPending?.(null); // refused: the pill goes back to what is true
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error };
    },
    summary: (st) => `وضعیت تغییر کرد · ${lifecycleChips(ctx, st).join(" · ")}`,
    failure: FAILURE,
    onFinished: onUpdated,
    onReopen: () => {
      onPending?.(null);
      onReopen?.();
    },
  });

  const save = (st: FlowState) => {
    onPending?.(lifecycleTarget(st));
    onSaved(st);
  };

  return (
    <TapFlow
      open={open}
      title="تغییر وضعیت مشتری"
      subtitle={customer.name}
      config={lifecycleFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={save}
      onClose={onClose}
      done={<FlowDone key={state.answers.length} chips={lifecycleChips(ctx, state)} onReturn={onClose} />}
    />
  );
}
