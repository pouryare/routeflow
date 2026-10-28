"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useToast } from "@/components/ToastProvider";
import { useMyPosition } from "@/components/MyPositionProvider";
import { useHeldSave } from "./useHeldSave";
import PinStep from "./PinStep";
import LinkStep from "./LinkStep";
import BasicsStep from "./BasicsStep";
import HoursPicker from "./HoursPicker";
import type { FlowHostProps } from "./flowHost";
import { addLeadFlow, basicsOf, hasPhone, hoursOf, pinOf } from "@/lib/crm/flows/addLead";
import { backStep, interpolate, startFlow } from "@/lib/crm/flows/machine";
import type { FlowContext, FlowState } from "@/lib/crm/flows/types";
import { labelDue, resolveDue } from "@/lib/crm/due";
import { formatHours, nextOpenAt } from "@/lib/crm/hours";
import { normPhone } from "@/lib/crm/phone";
import { BUSINESS_TYPE_LABEL, LEAD_SOURCE_LABEL, PRICE_TIER_LABEL, VERIFICATION_LABEL } from "@/lib/crm/vocab";

function nextLabelFor(ctx: FlowContext, st: FlowState): string | null {
  const acc = st.acc;
  if (!acc.due || acc.due.kind === "none") return null;
  const now = new Date().toISOString();
  const raw = resolveDue(acc.due, now);
  return raw ? `${interpolate(acc.next_title ?? "پیگیری", ctx, acc)} · ${labelDue(nextOpenAt(hoursOf(st.values), raw), now)}` : null;
}

export default function AddLeadFlow({
  open, onHide, onReopen, onFinished, prefillPhone, onOpenExisting, onCallNow, onOpenBusiness, onTalkedNow,
}: FlowHostProps & {
  prefillPhone?: string | null;
  onOpenExisting: (id: number) => void;
  onCallNow: (id: number, phoneNorm: string) => void;
  onOpenBusiness: (id: number) => void;
  onTalkedNow: (id: number) => void;
}) {
  const toast = useToast();
  const { position } = useMyPosition();
  const { hold, cancel, flush } = useHeldSave();
  const [ctx, setCtx] = useState<FlowContext | null>(null);
  const [state, setState] = useState<FlowState | null>(null);
  const created = useRef<number | null>(null);
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; });

  useEffect(() => {
    let alive = true;
    fetch("/api/crm/add-lead/context")
      .then((r) => r.json())
      .then((j: { ok: boolean; ctx?: FlowContext }) => {
        if (alive && j.ok && j.ctx) { setCtx(j.ctx); setState(startFlow(addLeadFlow, j.ctx)); }
      })
      .catch(() => { if (alive) toastRef.current("اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.", "error"); });
    return () => { alive = false; };
  }, []);

  const post = useCallback(async (st: FlowState, clientUuid: string): Promise<number | null> => {
    const res = await fetch("/api/crm/businesses", {
      method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: st.answers, client_uuid: clientUuid }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: number; error?: string };
    if (!res.ok || !j.ok || !j.id) { toast(friendlyError(j.error, "سرنخ ذخیره نشد؛ دوباره تلاش کنید"), "error"); return null; }
    created.current = j.id;
    return j.id;
  }, [toast]);

  const onSaved = useCallback((st: FlowState) => {
    if (!ctx) return;
    const uuid = crypto.randomUUID();
    // "I already talked to them": the after-call flow needs the id now, so no hold, no undo.
    if (st.acc.handoff === "talked_now") {
      void post(st, uuid).then((id) => { if (id) { onFinished(id); onTalkedNow(id); } });
      return;
    }
    hold(async () => { const id = await post(st, uuid); if (id) onFinished(id); });
    toast(`سرنخ «${basicsOf(st.values)?.name ?? ""}» ثبت شد`, "success", {
      label: "بازگردانی ثبت",
      onClick: () => { if (cancel()) { setState(backStep(addLeadFlow, ctx, st)); onReopen(); } },
    });
  }, [ctx, post, hold, cancel, toast, onFinished, onTalkedNow, onReopen]);

  if (!ctx || !state) return null;
  const v = state.values;
  const acc = state.acc;
  const pin = pinOf(v);
  const phone = normPhone(basicsOf(v)?.phone);
  const chips = [
    basicsOf(v)?.name,
    acc.business_type ? BUSINESS_TYPE_LABEL[acc.business_type] : null,
    acc.source ? `منبع: ${LEAD_SOURCE_LABEL[acc.source]}` : null,
    acc.price_tier && acc.price_tier !== "unknown" ? `قیمت: ${PRICE_TIER_LABEL[acc.price_tier]}` : null,
    hoursOf(v).length ? formatHours(hoursOf(v)) : null,
    VERIFICATION_LABEL[acc.verification ?? "unverified"],
    pin?.precision === "approx" ? "مکان تقریبی" : null,
    hasPhone(v) ? null : "بدون تلفن",
  ].filter((x): x is string => !!x);
  const after = async (then: (id: number) => void) => { await flush(); if (created.current) then(created.current); };
  const actions = (
    <>
      {phone ? <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={() => void after((id) => onCallNow(id, phone))}>
      <Icon name="phone" size="md" />
      تماس همین حالا</button> : null}
      <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => void after(onOpenBusiness)}>
      <Icon name="external-link" size="md" />
      باز کردن پرونده</button>
    </>
  );
  const here = position ? { lat: position.lat, lng: position.lng } : null;

  const renderCustom = (api: CustomStepApi) => {
    switch (api.step.kind) {
      case "link": return <LinkStep api={api} />;
      case "basics": return <BasicsStep api={api} prefillPhone={prefillPhone} onOpenExisting={(id) => { onHide(); onOpenExisting(id); }} onRequested={onHide} />;
      case "hours": return <HoursPicker api={api} />;
      case "pin": return <PinStep api={api} allowApprox={api.step.id === "pin"} initial={pinOf(api.state.values) ?? (api.step.id === "here" || api.state.acc.pin_mode === "gps" ? here : null)} />;
      default: return null;
    }
  };

  return (
    <TapFlow
      open={open}
      title="سرنخ تازه"
      subtitle={basicsOf(v)?.name}
      config={addLeadFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onHide}
      hours={hoursOf(v)}
      renderCustom={renderCustom}
      done={<FlowDone key={state.answers.length} chips={chips} next={nextLabelFor(ctx, state)} actions={actions} onReturn={onHide} />}
    />
  );
}
