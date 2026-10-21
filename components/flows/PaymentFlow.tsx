"use client";

import { useEffect, useMemo, useState } from "react";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import DateStep from "@/components/tapflow/DateStep";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { DUE_PRESETS } from "@/lib/flows/dates";
import { customerIdOf, paymentChips, paymentFlow, paymentRequest } from "@/lib/flows/payment";
import { faToman } from "@/lib/format";
import { tehranTodayIso } from "@/lib/jalali";

export interface PaymentCustomer {
  id: number;
  business_name: string;
  customer_code: string;
}

const FAILURE = "دریافت ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";

/** Money received, as a tap flow (docs/tap-flow-principles.md §7).
 *
 *  Opened from the payments page, the cheques page and a customer's own panel. A screen that
 *  already knows the customer passes `customerId`; one that only deals with cheques passes
 *  `method="CHEQUE"`, and the flow skips the questions those facts answer.
 *
 *  The amount arrives prefilled with what the customer owes (read from the statement once the
 *  customer is known) and is confirmed with one tap, never applied silently.
 *
 *  Mount it with a fresh `key` each time it opens: that is what re-seeds the flow. */
export default function PaymentFlow({
  open,
  customers,
  customerId,
  method,
  onRecorded,
  onClose,
  onReopen,
}: {
  open: boolean;
  customers: PaymentCustomer[];
  customerId?: number;
  method?: "CHEQUE";
  onRecorded: () => void;
  onClose: () => void;
  onReopen?: () => void;
}) {
  const today = useMemo(() => tehranTodayIso(), []);
  const ctx = useMemo<FlowContext>(() => {
    const known = customerId !== undefined ? customers.find((c) => c.id === customerId) : undefined;
    return {
      ...EMPTY_CONTEXT,
      entry: "payment",
      recentCustomers: customers.map((c) => ({ id: c.id, name: `${c.business_name} (${c.customer_code})` })),
      vars: {
        received_at: today,
        ...(known ? { customer_id: String(known.id), customer: known.business_name } : {}),
        ...(method ? { method } : {}),
      },
    };
  }, [customers, customerId, method, today]);

  const { state, setState, onSaved } = useFlowHost(paymentFlow, ctx, {
    send: async (st) => {
      const req = paymentRequest(ctx, st);
      const res = await fetch(req.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      if (res.ok) return { ok: true };
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error };
    },
    summary: (st) => `دریافت ثبت شد · ${paymentChips(ctx, st).join(" · ")}`,
    failure: FAILURE,
    onFinished: onRecorded,
    onReopen,
  });

  /* What the customer owes, once we know who. It only prefills the amount; if the read fails
     the person types the amount, which is what they did before. */
  const who = Number.isFinite(customerIdOf(ctx, state)) ? customerIdOf(ctx, state) : null;
  const [debt, setDebt] = useState<{ id: number; total: number } | null>(null);
  useEffect(() => {
    if (who === null) return;
    let alive = true;
    fetch(`/api/customers/${who}/statement`)
      .then((r) => r.json())
      .then((j: { ok?: boolean; debt?: { total?: number } }) => {
        if (alive && j.ok) setDebt({ id: who, total: Math.max(0, Math.round(j.debt?.total ?? 0)) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [who]);
  const owed = debt && debt.id === who ? debt.total : null;

  const viewCtx = useMemo<FlowContext>(() => {
    const name = ctx.vars.customer ?? ctx.recentCustomers.find((c) => c.id === who)?.name;
    return {
      ...ctx,
      vars: {
        ...ctx.vars,
        ...(name ? { customer: name } : {}),
        ...(owed && owed > 0 ? { amount: String(owed), owed_line: `بدهی فعلی: ${faToman(owed)}` } : {}),
      },
    };
  }, [ctx, who, owed]);

  const renderCustom = (api: CustomStepApi) =>
    api.step.kind === "date" ? (
      <DateStep
        optionId={api.step.options[0].id}
        optionLabel={api.step.options[0].label}
        from={today}
        presets={DUE_PRESETS}
        ariaLabel="سررسید چک"
        submit={api.submit}
      />
    ) : null;

  return (
    <TapFlow
      open={open}
      title={method === "CHEQUE" ? "ثبت چک" : "ثبت دریافت"}
      subtitle={viewCtx.vars.customer}
      config={paymentFlow}
      ctx={viewCtx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onClose}
      renderCustom={renderCustom}
      done={<FlowDone key={state.answers.length} chips={paymentChips(viewCtx, state)} onReturn={onClose} />}
    />
  );
}
