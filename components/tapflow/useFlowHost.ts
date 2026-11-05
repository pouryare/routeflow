"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { useToast } from "@/components/ToastProvider";
import { useHeldSave } from "@/components/crm/useHeldSave";
import { backStep, replayAnswers, startFlow } from "@/lib/crm/flows/machine";
import type { FlowAnswer, FlowConfig, FlowContext, FlowState } from "@/lib/crm/flows/types";

export interface FlowHostOptions {
  /** Performs the write. Runs after the 5 s undo window, or at once if the page is left. */
  send: (s: FlowState) => Promise<{ ok: boolean; error?: string }>;
  /** The toast line: what was saved, in the person's words. */
  summary: (s: FlowState) => string;
  /** Shown when the write fails: what failed and what to do next (never a developer message). */
  failure: string;
  onFinished?: () => void;
  /** Called when undo reopens the sheet, so the host can show it again. */
  onReopen?: () => void;
  /** Answers already given when the flow opens (a repeated entry starts part-way through). */
  start?: FlowAnswer[];
}

/** Everything a non-CRM flow host repeats: seed the state once per mount (never `stack: []` --
 *  see the `unknown step undefined` note in LeadRunPlannerTabFlow), hold the save for the 5 s
 *  undo window, and toast with «بازگردانی ثبت». The host supplies only `send`, `summary` and
 *  the failure sentence. Hosts remount per open (a `key` on the host) to start a fresh flow. */
export function useFlowHost(cfg: FlowConfig, ctx: FlowContext, opts: FlowHostOptions) {
  const toast = useToast();
  const { hold, cancel, flush } = useHeldSave();
  const [state, setState] = useState<FlowState>(() => (opts.start?.length ? replayAnswers(cfg, ctx, opts.start) : startFlow(cfg, ctx)));

  // Latest options without re-creating onSaved on every render of the host.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const onSaved = useCallback(
    (st: FlowState) => {
      hold(async () => {
        const o = optsRef.current;
        const r = await o.send(st).catch((): { ok: boolean; error?: string } => ({ ok: false }));
        if (!r.ok) toast(friendlyError(r.error, o.failure), "error");
        else o.onFinished?.();
      });
      toast(optsRef.current.summary(st), "success", {
        label: "بازگردانی ثبت",
        icon: "undo",
        onClick: () => {
          if (cancel()) {
            setState(backStep(cfg, ctx, st));
            optsRef.current.onReopen?.();
          }
        },
      });
    },
    [cfg, ctx, hold, cancel, toast],
  );

  /** «ثبت بعدی» (Z18): a fresh flow in the same sheet. The held save is not lost: the next save
   *  sends it at once, and leaving the page sends it too. */
  const restart = useCallback(() => setState(startFlow(cfg, ctx)), [cfg, ctx]);

  return { state, setState, onSaved, flush, restart };
}
