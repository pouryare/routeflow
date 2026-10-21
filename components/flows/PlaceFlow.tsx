"use client";

import { useMemo } from "react";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import PinStep from "@/components/crm/PinStep";
import { useFlowHost } from "@/components/tapflow/useFlowHost";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { placeChips, placeFlow, placeRequest } from "@/lib/flows/place";

const FAILURE = "مکان اضافه نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";

/** «افزودن مکان» as a tap flow: kind, name, position. Mount it with a fresh `key` each time it
 *  opens. */
export default function PlaceFlow({
  open,
  onAdded,
  onClose,
  onReopen,
}: {
  open: boolean;
  onAdded: () => void;
  onClose: () => void;
  onReopen?: () => void;
}) {
  const ctx = useMemo<FlowContext>(() => ({ ...EMPTY_CONTEXT, entry: "place" }), []);

  const { state, setState, onSaved } = useFlowHost(placeFlow, ctx, {
    send: async (st) => {
      const res = await fetch("/api/facilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(placeRequest(st)),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      return res.ok && json.ok !== false ? { ok: true } : { ok: false, error: json.error };
    },
    summary: (st) => `مکان اضافه شد · ${placeChips(st).join(" · ")}`,
    failure: FAILURE,
    onFinished: onAdded,
    onReopen,
  });

  return (
    <TapFlow
      open={open}
      title="افزودن مکان"
      config={placeFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onClose}
      renderCustom={(api: CustomStepApi) =>
        api.step.kind === "pin" ? <PinStep api={api} initial={null} allowApprox={false} /> : null
      }
      done={state.saved ? <FlowDone key={state.answers.length} chips={placeChips(state)} onReturn={onClose} /> : null}
    />
  );
}
