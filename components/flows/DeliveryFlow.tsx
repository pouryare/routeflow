"use client";

import { useMemo } from "react";
import { Icon } from "@/components/meridian/Icon";
import TapFlow from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { dequeue, enqueue, sendDelivery } from "@/lib/deliveryQueue";
import type { RunStop } from "@/lib/delivery";
import { buildReceipt } from "@/lib/deliveryReceipt";
import { EMPTY_CONTEXT, type FlowContext, type FlowState } from "@/lib/crm/flows/types";
import {
  deliveredCounts,
  deliveredTotal,
  deliveryChips,
  deliveryFlow,
  deliveryPayload,
  withTotals,
} from "@/lib/flows/delivery";
import { faToman } from "@/lib/format";
import type { ReceiptData } from "@/lib/receiptLayout";

/** Shown when the request could not be confirmed. The delivery itself is safe: it is in the
 *  device queue and DriverRun re-sends it the moment there is signal. */
const QUEUED =
  "تحویل هنوز ارسال نشد، اما روی گوشی ذخیره است و با وصل شدن اینترنت خودکار ارسال می‌شود.";
const REFUSED = "تحویل ثبت نشد. اطلاعات را بررسی کنید و دوباره تلاش کنید.";

function contextFor(stop: RunStop): FlowContext {
  return {
    ...EMPTY_CONTEXT,
    entry: "delivery",
    vars: { customer: stop.customer_name },
    items: stop.lines.map((l) => ({
      id: l.id,
      label: `${l.product_name} · ${l.packaging_name}`,
      qty: l.packs_ordered,
      unit: "بسته",
      price: l.unit_price_toman,
    })),
  };
}

/** Delivery at the door, as a tap flow (docs/tap-flow-principles.md §7).
 *
 *  Replaces the per-line quantity inputs and the collected-amount input. Everything handed
 *  over and the full amount collected is two taps; a shortfall asks only about the lines that
 *  were short. The write goes through the same queue and endpoint as before: it is put in the
 *  device queue the moment the last answer is tapped (so closing the app inside the 5 s undo
 *  window cannot lose it), sent when the window ends, and taken back out if the driver undoes.
 *
 *  Mount it with a fresh `key` each time it opens: that is what re-seeds the flow. */
export default function DeliveryFlow({
  open,
  stop,
  runDate,
  driverName,
  businessName,
  onRecorded,
  onPrint,
  onClose,
  onReopen,
  lastStop,
}: {
  open: boolean;
  stop: RunStop;
  runDate: string;
  driverName: string;
  businessName: string;
  onRecorded: () => void;
  onPrint: (data: ReceiptData) => void;
  onClose: () => void;
  onReopen?: () => void;
  /** Every other stop of the run is already done, so finishing this one finishes the run. */
  lastStop?: boolean;
}) {
  const ctx = useMemo(() => contextFor(stop), [stop]);

  const { state, setState, onSaved, flush } = useFlowHost(deliveryFlow, ctx, {
    send: async (st) => {
      const body = deliveryPayload(ctx, st);
      let res: Response;
      try {
        res = await sendDelivery(stop.id, body);
      } catch {
        return { ok: false, error: QUEUED }; // no signal: stays queued, retried on reconnect
      }
      if (res.ok) {
        dequeue(stop.id);
        return { ok: true };
      }
      if (res.status >= 400 && res.status < 500) {
        dequeue(stop.id); // the server refused the content; replaying it forever would help nobody
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: json.error ?? REFUSED };
      }
      return { ok: false, error: QUEUED };
    },
    summary: (st) => `تحویل «${stop.customer_name}» ثبت شد · ${deliveryChips(ctx, st).join(" · ")}`,
    failure: REFUSED,
    onFinished: onRecorded,
    onReopen: () => {
      dequeue(stop.id);
      onReopen?.();
    },
  });

  const save = (st: FlowState) => {
    enqueue({ stopId: stop.id, body: deliveryPayload(ctx, st), recordedAt: new Date().toISOString() });
    onSaved(st);
  };

  const print = async (st: FlowState) => {
    await flush(); // the receipt should not outrun the record
    onPrint(
      buildReceipt({
        stop,
        packs: deliveredCounts(ctx, st),
        collectedToman: deliveryPayload(ctx, st).collected_toman,
        runDate,
        driverName,
        businessName,
      }),
    );
    onClose();
  };

  const total = deliveredTotal(ctx, state);

  return (
    <TapFlow
      open={open}
      title={stop.customer_name}
      subtitle={`${stop.order_no} · جمع ${faToman(total)}`}
      config={deliveryFlow}
      ctx={withTotals(ctx, state)}
      state={state}
      onState={setState}
      onSaved={save}
      onClose={onClose}
      done={
        <FlowDone
          key={state.answers.length}
          milestone={lastStop}
          chips={deliveryChips(ctx, state)}
          actions={
            <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={() => void print(state)}>
              <Icon name="print" size="md" />
              چاپ رسید
            </button>
          }
          onReturn={onClose}
        />
      }
    />
  );
}
