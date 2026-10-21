"use client";

import { useMemo } from "react";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import DateStep from "@/components/tapflow/DateStep";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { REMINDER_PRESETS } from "@/lib/flows/dates";
import { reminderChips, reminderFlow, reminderRequest } from "@/lib/flows/reminder";
import { tehranTodayIso } from "@/lib/jalali";

/** A reminder or a note for yourself, as a tap flow. `entity` ties it to a customer or district
 *  (the customer panel, the district editor); the Pocket passes none.
 *
 *  Mount it with a fresh `key` each time it opens: that is what re-seeds the flow. */
export default function ReminderFlow({
  open,
  kind,
  entity,
  onAdded,
  onClose,
  onReopen,
}: {
  open: boolean;
  kind: "reminder" | "note";
  entity?: { type: "customer" | "district"; id: number; label?: string };
  onAdded: () => void;
  onClose: () => void;
  onReopen?: () => void;
}) {
  const today = useMemo(() => tehranTodayIso(), []);
  const ctx = useMemo<FlowContext>(
    () => ({
      ...EMPTY_CONTEXT,
      entry: "outcome",
      vars: {
        kind,
        today,
        ...(entity ? { entity_type: entity.type, entity_id: String(entity.id), ...(entity.label ? { entity: entity.label } : {}) } : {}),
      },
    }),
    [kind, entity, today],
  );

  const noun = kind === "note" ? "یادداشت" : "یادآوری";
  const { state, setState, onSaved } = useFlowHost(reminderFlow, ctx, {
    send: async (st) => {
      const req = reminderRequest(ctx, st);
      const res = await fetch(req.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      if (res.ok) return { ok: true };
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error };
    },
    summary: (st) => `${noun} ثبت شد · ${reminderChips(ctx, st).slice(1).join(" · ")}`,
    failure: `${noun} ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.`,
    onFinished: onAdded,
    onReopen,
  });

  const renderCustom = (api: CustomStepApi) =>
    api.step.kind === "date" ? (
      <DateStep
        optionId={api.step.options[0].id}
        optionLabel={api.step.options[0].label}
        from={today}
        presets={REMINDER_PRESETS}
        ariaLabel="تاریخ یادآوری"
        submit={api.submit}
      />
    ) : null;

  return (
    <TapFlow
      open={open}
      title={kind === "note" ? "ثبت یادداشت" : "ثبت یادآوری"}
      subtitle={entity?.label}
      config={reminderFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onClose}
      renderCustom={renderCustom}
      done={<FlowDone key={state.answers.length} chips={reminderChips(ctx, state)} onReturn={onClose} />}
    />
  );
}
