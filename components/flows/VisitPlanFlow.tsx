"use client";

import { useMemo } from "react";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import DateStep from "@/components/tapflow/DateStep";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { visitPlanChips, visitPlanFlow, visitPlanRequest } from "@/lib/flows/visitPlan";
import { tehranTodayIso } from "@/lib/jalali";

export interface PlanCustomer {
  id: number;
  business_name: string;
  customer_code: string;
}
export interface PlanLead {
  id: number;
  name: string;
}

const FAILURE = "به برنامه اضافه نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";

/** «افزودن به برنامه» as a tap flow: who, then which day (the day on screen is the suggestion).
 *  Mount it with a fresh `key` each time it opens. */
export default function VisitPlanFlow({
  open,
  customers,
  leads,
  selectedDate,
  onAdded,
  onClose,
  onReopen,
}: {
  open: boolean;
  customers: PlanCustomer[];
  leads: PlanLead[];
  /** The day the planner is showing. */
  selectedDate: string;
  onAdded: () => void;
  onClose: () => void;
  onReopen?: () => void;
}) {
  const today = useMemo(() => tehranTodayIso(), []);
  const ctx = useMemo<FlowContext>(
    () => ({
      ...EMPTY_CONTEXT,
      entry: "visit_plan",
      items: [
        ...customers.map((c) => ({ id: c.id, label: `${c.business_name} (${c.customer_code})` })),
        ...leads.map((l) => ({ id: -l.id, label: `${l.name} · سرنخ` })),
      ],
      vars: { today, selected: selectedDate },
    }),
    [customers, leads, today, selectedDate],
  );

  const { state, setState, onSaved } = useFlowHost(visitPlanFlow, ctx, {
    send: async (st) => {
      const res = await fetch("/api/visit-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(visitPlanRequest(ctx, st)),
      });
      if (res.ok) return { ok: true };
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error };
    },
    summary: (st) => `به برنامه اضافه شد · ${visitPlanChips(ctx, st).join(" · ")}`,
    failure: FAILURE,
    onFinished: onAdded,
    onReopen,
  });

  const renderCustom = (api: CustomStepApi) =>
    api.step.kind === "date" ? (
      <DateStep
        optionId={api.step.options[0].id}
        optionLabel={api.step.options[0].label}
        from={today}
        presets={[]}
        ariaLabel="روز بازدید"
        submit={api.submit}
      />
    ) : null;

  return (
    <TapFlow
      open={open}
      title="افزودن به برنامه"
      config={visitPlanFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onClose}
      renderCustom={renderCustom}
      done={<FlowDone key={state.answers.length} chips={visitPlanChips(ctx, state)} onReturn={onClose} />}
    />
  );
}
