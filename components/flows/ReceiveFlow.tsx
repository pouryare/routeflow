"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import DateStep from "@/components/tapflow/DateStep";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { SHELF_PRESETS } from "@/lib/flows/dates";
import { receiveChips, receiveFlow, receiveRequest } from "@/lib/flows/receive";
import { faToman } from "@/lib/format";
import { tehranTodayIso } from "@/lib/jalali";

export interface ReceiveProduct {
  id: number;
  name: string;
  base_unit: string;
  /** The current average cost, to prefill the price. 0 when there is none yet. */
  avg_cost_toman: number;
}

const FAILURE = "دریافت ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";

/** Goods arriving, as a tap flow (owner only: it records a purchase). Mount it with a fresh
 *  `key` each time it opens. */
export default function ReceiveFlow({
  open,
  products,
  suppliers,
  onClose,
  onReopen,
}: {
  open: boolean;
  products: ReceiveProduct[];
  /** Recent supplier names, offered as answers. */
  suppliers: string[];
  onClose: () => void;
  onReopen?: () => void;
}) {
  const router = useRouter();
  const today = useMemo(() => tehranTodayIso(), []);
  const ctx = useMemo<FlowContext>(
    () => ({
      ...EMPTY_CONTEXT,
      entry: "receive",
      products: products.map((p) => ({ id: p.id, name: p.name, price_toman: p.avg_cost_toman })),
      items: suppliers.map((s, i) => ({ id: i + 1, label: s })),
      vars: { today },
    }),
    [products, suppliers, today],
  );

  const { state, setState, onSaved } = useFlowHost(receiveFlow, ctx, {
    send: async (st) => {
      const res = await fetch("/api/sales/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(receiveRequest(viewCtx, st)),
      });
      if (res.ok) return { ok: true };
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error };
    },
    summary: (st) => `دریافت ثبت شد · ${receiveChips(viewCtx, st).join(" · ")}`,
    failure: FAILURE,
    onFinished: () => router.refresh(),
    onReopen,
  });

  /* What depends on WHICH product was picked: its unit, and its average cost as the price
     prefill. The flow's own state is the source of truth; this ctx is for rendering only. */
  const picked = products.find((x) => String(x.id) === state.values.product);
  const viewCtx: FlowContext = picked
    ? {
        ...ctx,
        vars: {
          ...ctx.vars,
          product: picked.name,
          unit: picked.base_unit,
          qty_unit: picked.base_unit,
          cost: picked.avg_cost_toman > 0 ? String(Math.round(picked.avg_cost_toman)) : "",
          cost_unit: "تومان",
          cost_line: picked.avg_cost_toman > 0 ? `میانگین فعلی: ${faToman(picked.avg_cost_toman)}` : "قیمتی ثبت نشده است",
        },
      }
    : ctx;

  const renderCustom = (api: CustomStepApi) =>
    api.step.kind === "date" ? (
      <DateStep
        optionId={api.step.options[0].id}
        optionLabel={api.step.options[0].label}
        skip={api.step.options[1]}
        from={today}
        presets={SHELF_PRESETS}
        ariaLabel="تاریخ انقضا"
        submit={api.submit}
      />
    ) : null;

  return (
    <TapFlow
      open={open}
      title="دریافت کالا"
      subtitle={viewCtx.vars.product}
      config={receiveFlow}
      ctx={viewCtx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onClose}
      renderCustom={renderCustom}
      done={<FlowDone key={state.answers.length} chips={receiveChips(viewCtx, state)} onReturn={onClose} />}
    />
  );
}
