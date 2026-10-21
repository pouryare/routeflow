"use client";

import { useMemo } from "react";
import TapFlow from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { useToast } from "@/components/ToastProvider";
import { QUEUED_MESSAGE, queueIfOffline } from "@/lib/offline/queueIfOffline";
import { complaintChips, complaintFlow, complaintPayload } from "@/lib/flows/complaint";

export interface ComplaintCustomer {
  id: number;
  business_name: string;
}
export interface ComplaintProduct {
  id: number;
  name: string;
}

const FAILURE = "شکایت ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";

/** A quality complaint, as a tap flow (docs/tap-flow-principles.md §7).
 *
 *  From the complaints page it starts by asking who; from an order it already knows the
 *  customer and the order and asks only which of the order's products, what is wrong and how
 *  serious. `orderId` is sent along so the server can trace the batch.
 *
 *  Mount it with a fresh `key` each time it opens: that is what re-seeds the flow. */
export default function ComplaintFlow({
  open,
  customers,
  products,
  customerId,
  orderId,
  onRecorded,
  onClose,
  onReopen,
}: {
  open: boolean;
  customers: ComplaintCustomer[];
  products: ComplaintProduct[];
  customerId?: number;
  orderId?: number;
  onRecorded: () => void;
  onClose: () => void;
  onReopen?: () => void;
}) {
  const ctx = useMemo<FlowContext>(() => {
    const known = customerId !== undefined ? customers.find((c) => c.id === customerId) : undefined;
    return {
      ...EMPTY_CONTEXT,
      entry: "complaint",
      recentCustomers: customers.map((c) => ({ id: c.id, name: c.business_name })),
      products: products.map((p) => ({ id: p.id, name: p.name, price_toman: null })),
      vars: {
        ...(known ? { customer_id: String(known.id), customer: known.business_name } : {}),
        ...(orderId !== undefined ? { order_id: String(orderId) } : {}),
      },
    };
  }, [customers, products, customerId, orderId]);

  const toast = useToast();
  const { state, setState, onSaved } = useFlowHost(complaintFlow, ctx, {
    send: async (st) => {
      const body = complaintPayload(ctx, st);
      if (await queueIfOffline("/api/sales/complaints", body as Record<string, unknown>)) {
        toast(QUEUED_MESSAGE, "info");
        return { ok: true };
      }
      const res = await fetch("/api/sales/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true };
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error };
    },
    summary: (st) => `شکایت ثبت شد · ${complaintChips(ctx, st).join(" · ")}`,
    failure: FAILURE,
    onFinished: onRecorded,
    onReopen,
  });

  return (
    <TapFlow
      open={open}
      title="ثبت شکایت کیفی"
      subtitle={ctx.vars.customer}
      config={complaintFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onClose}
      done={<FlowDone key={state.answers.length} chips={complaintChips(ctx, state)} onReturn={onClose} />}
    />
  );
}
