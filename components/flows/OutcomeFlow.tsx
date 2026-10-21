"use client";

import { useMemo } from "react";
import TapFlow from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { outcomeChips, outcomeCode, outcomeFlow } from "@/lib/flows/outcome";

const FAILURE = "نتیجه ثبت نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";

/** «نتیجهٔ این کار چه بود؟» as a bottom sheet: four big answers instead of four small pills.
 *  What happens to the answer is the caller's business (`decide`) -- a task row marks the task
 *  done, the board moves the card -- so this component owns only the question, the 5 s undo and
 *  the done screen.
 *
 *  Mount it with a fresh `key` each time it opens: that is what re-seeds the flow. */
export default function OutcomeFlow({
  open,
  taskLabel,
  allowNone = false,
  decide,
  onClose,
  onReopen,
}: {
  open: boolean;
  taskLabel: string;
  /** Offer «بدون نتیجه» (the board can close a card with nothing said). */
  allowNone?: boolean;
  /** Writes the answer. `code` is null for «بدون نتیجه». Runs after the undo window. */
  decide: (code: string | null) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onReopen?: () => void;
}) {
  const ctx = useMemo<FlowContext>(
    () => ({ ...EMPTY_CONTEXT, entry: "outcome", vars: { task: taskLabel, ...(allowNone ? { allow_none: "1" } : {}) } }),
    [taskLabel, allowNone],
  );

  const { state, setState, onSaved } = useFlowHost(outcomeFlow, ctx, {
    send: (st) => decide(outcomeCode(st)),
    summary: (st) => `نتیجه ثبت شد · ${outcomeChips(st).join(" · ")}`,
    failure: FAILURE,
    onReopen,
  });

  return (
    <TapFlow
      open={open}
      title="ثبت نتیجه"
      subtitle={taskLabel}
      config={outcomeFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onClose}
      done={<FlowDone key={state.answers.length} chips={outcomeChips(state)} onReturn={onClose} />}
    />
  );
}
