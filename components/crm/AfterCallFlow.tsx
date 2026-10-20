"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useRouter } from "next/navigation";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useToast } from "@/components/ToastProvider";
import { useHeldSave } from "./useHeldSave";
import PinStep from "./PinStep";
import type { FlowHostProps } from "./flowHost";
import { afterCallFlow } from "@/lib/crm/flows/afterCall";
import { backStep, interpolate, startFlow } from "@/lib/crm/flows/machine";
import type { FlowContext, FlowState } from "@/lib/crm/flows/types";
import type { BusinessRow } from "@/lib/repo/crm/businesses";
import { labelDue, resolveDue } from "@/lib/crm/due";
import { nextOpenAt, parseHours } from "@/lib/crm/hours";
import { OUTCOMES } from "@/lib/crm/outcomes";
import { normPhone } from "@/lib/crm/phone";
import { priceListText, shareUrl } from "@/lib/crm/share";
import { CONTACT_ROLE_LABEL, TEMPERATURE_LABEL, VERIFICATION_LABEL } from "@/lib/crm/vocab";
import { outcomeLabel } from "@/lib/tasks/labels";

/** "تماس دوباره · فردا ۱۲:۰۰" -- the next action as the server will save it. */
function nextLabelFor(data: { business: BusinessRow; ctx: FlowContext }, st: FlowState): string | null {
  const acc = st.acc;
  if (acc.invalid) return "از همهٔ فهرست‌ها بیرون رفت";
  if (!acc.due || acc.due.kind === "none") return "بدون کار بعدی";
  const now = new Date().toISOString();
  const picked = [...st.answers].reverse().find((a) => a.value && /^\d{4}-\d{2}-\d{2}$/.test(a.value))?.value ?? null;
  const raw = resolveDue(acc.due, now, picked);
  if (!raw) return null;
  return `${interpolate(acc.next_title ?? "پیگیری", data.ctx, acc)} · ${labelDue(nextOpenAt(parseHours(data.business.working_hours_json), raw), now)}`;
}

export default function AfterCallFlow({
  customerId, taskId = null, entry = "call", open, onHide, onReopen, onFinished, onRedial, onSpawnLead,
}: FlowHostProps & {
  customerId: number;
  taskId?: number | null;
  entry?: "call" | "talked_now";
  onRedial?: (customerId: number, phoneNorm: string) => void;
  onSpawnLead?: (phoneNorm: string | null) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const { hold, cancel, flush } = useHeldSave();
  const [data, setData] = useState<{ business: BusinessRow; ctx: FlowContext } | null>(null);
  const [state, setState] = useState<FlowState | null>(null);

  // The latest toast/onHide, without re-running the load whenever a parent re-renders.
  const toastRef = useRef(toast);
  const hideRef = useRef(onHide);
  useEffect(() => { toastRef.current = toast; hideRef.current = onHide; });

  useEffect(() => {
    let alive = true;
    fetch(`/api/crm/businesses/${customerId}/context?entry=${entry}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; business?: BusinessRow; ctx?: FlowContext; error?: string }) => {
        if (!alive) return;
        if (j.ok && j.business && j.ctx) {
          setData({ business: j.business, ctx: j.ctx });
          setState(startFlow(afterCallFlow, j.ctx));
        } else {
          toastRef.current(j.error ?? "این کسب‌وکار خوانده نشد", "error");
          hideRef.current();
        }
      })
      .catch(() => { if (alive) toastRef.current("اتصال برقرار نشد", "error"); });
    return () => { alive = false; };
  }, [customerId, entry]);

  const onSaved = useCallback((st: FlowState) => {
    if (!data) return;
    const acc = st.acc;
    // Opened inside the tap, so the browser treats it as the user's own navigation.
    if (acc.share) {
      const ids = (st.values.prods ?? "").split(",").filter(Boolean);
      window.open(shareUrl(acc.share, data.business.phone_norm, priceListText(data.ctx.products, ids)), "_blank", "noopener");
    }
    const clientUuid = crypto.randomUUID();
    hold(async () => {
      const res = await fetch(`/api/crm/businesses/${customerId}/flow`, {
        method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: st.answers, entry, task_id: taskId, client_uuid: clientUuid }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) { toast(j.error ?? `نتیجهٔ تماس با «${data.business.business_name}» ثبت نشد؛ دوباره تلاش کنید`, "error"); return; }
      onFinished(customerId);
    });
    toast(`نتیجهٔ تماس با «${data.business.business_name}» ثبت شد · ${nextLabelFor(data, st) ?? ""}`, "success", {
      label: "بازگردانی ثبت",
      onClick: () => {
        if (cancel()) { setState(backStep(afterCallFlow, data.ctx, st)); onReopen(); }
      },
    });
    const newPhone = normPhone(st.values.new_phone);
    if (acc.redial && newPhone) onRedial?.(customerId, newPhone);
  }, [data, customerId, entry, taskId, hold, cancel, toast, onFinished, onReopen, onRedial]);

  if (!data || !state) return null;
  const acc = state.acc;
  const o = acc.outcome ? OUTCOMES[acc.outcome] : null;
  const chips = [
    acc.outcome ? outcomeLabel(acc.outcome) : null,
    acc.verification ? VERIFICATION_LABEL[acc.verification] : null,
    acc.contact_role ? CONTACT_ROLE_LABEL[acc.contact_role] : null,
    o?.signal ? `دما: ${TEMPERATURE_LABEL[o.signal]}` : null,
  ].filter((x): x is string => !!x);
  const actions = acc.open_order ? (
    <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={async () => { await flush(); router.push(`/sales/orders?customer=${customerId}`); }}>
    <Icon name="check" size="md" />
    ثبت سفارش</button>
  ) : acc.spawn_lead ? (
    <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={async () => { await flush(); onSpawnLead?.(data.business.phone_norm); }}>
    <Icon name="plus" size="md" />
    افزودن سرنخ با این شماره</button>
  ) : undefined;

  return (
    <TapFlow
      open={open}
      title={data.business.business_name}
      subtitle={[data.business.area_label, data.ctx.vars.contact].filter(Boolean).join(" · ")}
      config={afterCallFlow}
      ctx={data.ctx}
      state={state}
      onState={setState}
      onSaved={onSaved}
      onClose={onHide}
      hours={parseHours(data.business.working_hours_json)}
      renderCustom={(api: CustomStepApi) =>
        api.step.kind === "pin" ? (
          <PinStep api={api} allowApprox={false}
            initial={data.business.lat !== null && data.business.lng !== null ? { lat: data.business.lat, lng: data.business.lng } : null} />
        ) : null}
      done={<FlowDone key={state.answers.length} chips={chips} next={nextLabelFor(data, state)} actions={actions} onReturn={onHide} />}
    />
  );
}
