"use client";

import { useMemo, useRef, useState } from "react";
import TapFlow from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import type { FlowItem } from "@/lib/flows/item";
import { doorChips, doorRequest, doorSaleFlow } from "@/lib/flows/doorSale";
import { useToast } from "@/components/ToastProvider";

export interface DoorCustomer {
  id: number;
  customer_code: string;
  business_name: string;
  debt: number;
  credit_limit_toman: number | null;
}

const FAILURE = "ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید. کالا هنوز روی ماشین حساب می‌شود.";

/** The sale or sample at the door (VC4, F52) as a tap flow. Mount with a fresh `key` each time it opens.
 *  It needs a connection: the van's stock and the order number are checked on the server, so with no signal
 *  it says so instead of queueing a sale that could be refused hours later. */
export default function DoorSaleFlow({ open, customers, items, customerId, onClose, onReopen, onRecorded, onAnother }: {
  open: boolean;
  customers: DoorCustomer[];
  items: FlowItem[];
  /** Fixed by the screen (a link names the shop); otherwise the first question asks. */
  customerId?: number | null;
  onClose: () => void;
  onReopen?: () => void;
  /** Called after the server accepted the save, so the screen can re-read what is left on the van. */
  onRecorded: () => void;
  /** «ثبت بعدی»: the screen mounts a fresh flow (new customer question, new request id). */
  onAnother: () => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<number | null>(null);
  const who = customerId ?? picked;
  const uuid = useRef<string>(crypto.randomUUID());

  const ctx = useMemo<FlowContext>(() => {
    const c = customers.find((x) => x.id === who);
    return {
      ...EMPTY_CONTEXT,
      entry: "order_quick",
      recentCustomers: customers.map((x) => ({ id: x.id, name: `${x.business_name} (${x.customer_code})` })),
      items,
      vars: {
        ...(c ? { customer_id: String(c.id), customer: c.business_name, debt: String(c.debt) } : {}),
        ...(c?.credit_limit_toman != null ? { credit_limit: String(c.credit_limit_toman) } : {}),
      },
    };
  }, [customers, items, who]);

  const { state, setState, onSaved } = useFlowHost(doorSaleFlow, ctx, {
    send: async (st) => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, error: "اینترنت قطع است" };
      const req = doorRequest(ctx, st, uuid.current);
      const res = await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
      const json = (await res.json().catch(() => ({}))) as { error?: string; held?: string | null };
      if (!res.ok) return { ok: false, error: json.error };
      // The sale is recorded but waiting for a manager: the goods must NOT be handed over. Say so loudly.
      if (json.held) toast(json.held, "error");
      return { ok: true };
    },
    summary: (st) => `${st.values.kind === "sample" ? "نمونه" : "فروش"} ثبت شد · ${doorChips(ctx, st).join(" · ")}`,
    failure: FAILURE,
    onFinished: onRecorded,
    onReopen,
  });

  /* A picked customer feeds the context above; the flow's own answer is the source of truth. */
  const whoFromFlow = state.values.who ? Number(state.values.who) : null;
  if (customerId == null && whoFromFlow !== picked) setPicked(whoFromFlow); // adjusted during render, not in an effect

  const cash = state.saved && state.values.kind !== "sample" && Number(state.values.collected ?? 0) > 0;
  const customer = ctx.vars.customer ?? customers.find((c) => c.id === whoFromFlow)?.business_name;

  return (
    <TapFlow
      open={open}
      title="فروش در محل"
      subtitle={customer}
      config={doorSaleFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onClose}
      done={<FlowDone key={state.answers.length} chips={doorChips(ctx, state)} coin={cash} onReturn={onClose} onAnother={onAnother} />}
    />
  );
}

