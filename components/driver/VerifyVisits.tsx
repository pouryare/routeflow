"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import TapFlow from "@/components/tapflow/TapFlow";
import FlowDone from "@/components/tapflow/FlowDone";
import { useToast } from "@/components/ToastProvider";
import { useMyPosition } from "@/components/MyPositionProvider";
import { useNavApp } from "@/components/NavAppSetting";
import { useHeldSave } from "@/components/crm/useHeldSave";
import { navigateUrl } from "@/lib/navApps";
import { driverVisitFlow } from "@/lib/crm/flows/driverVisit";
import { backStep, startFlow } from "@/lib/crm/flows/machine";
import { EMPTY_CONTEXT, type FlowContext, type FlowState } from "@/lib/crm/flows/types";
import { labelDue } from "@/lib/crm/due";
import type { DriverVisit } from "@/lib/repo/crm/driverVisits";

/** Phone-less leads the sales team wants checked, on this driver's round. */
export default function VerifyVisits() {
  const toast = useToast();
  const { position } = useMyPosition();
  const [navApp] = useNavApp();
  const { hold, cancel } = useHeldSave();
  const [visits, setVisits] = useState<DriverVisit[]>([]);
  const [flow, setFlow] = useState<{ visit: DriverVisit; ctx: FlowContext; state: FlowState; open: boolean } | null>(null);

  const load = useCallback(async () => {
    const j = (await fetch("/api/crm/driver-visits").then((r) => r.json()).catch(() => null)) as { ok?: boolean; visits?: DriverVisit[] } | null;
    if (j?.ok) setVisits(j.visits ?? []);
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  const start = (visit: DriverVisit) => {
    const ctx: FlowContext = { ...EMPTY_CONTEXT, entry: "driver_visit", vars: { name: visit.business_name, address: visit.address ?? visit.area_label ?? "" } };
    setFlow({ visit, ctx, state: startFlow(driverVisitFlow, ctx), open: true });
  };

  const onSaved = (st: FlowState) => {
    if (!flow) return;
    const { visit, ctx } = flow;
    const pos = position ? { lat: position.lat, lng: position.lng, accuracy: position.accuracy } : null;
    const uuid = crypto.randomUUID();
    hold(async () => {
      const res = await fetch(`/api/crm/driver-visits/${visit.task_id}`, {
        method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: st.answers, pos, client_uuid: uuid }),
      });
      if (!res.ok) { toast(`بازدید از «${visit.business_name}» ثبت نشد؛ دوباره تلاش کنید`, "error"); return; }
      setFlow(null);
      void load();
    });
    toast(`بازدید از «${visit.business_name}» ثبت شد`, "success", {
      label: "بازگردانی ثبت",
      onClick: () => { if (cancel()) setFlow((f) => (f ? { ...f, state: backStep(driverVisitFlow, ctx, st), open: true } : f)); },
    });
  };

  if (visits.length === 0 && !flow) return null;
  const now = new Date().toISOString();

  return (
    <section style={{ display: "grid", gap: 10, padding: "0 16px 16px" }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>بازدیدهای تأیید</h2>
      <p className="tf-sub" style={{ margin: 0 }}>سرنخ‌هایی که تلفن ندارند. سر راه سر بزنید و چند سؤال را جواب دهید.</p>
      <div className="crm-list">
        {visits.map((v) => (
          <article key={v.task_id} className="crm-card">
            <div className="due">{v.due_at ? labelDue(v.due_at, now) : ""}{v.hours ? ` · باز: ${v.hours}` : ""}</div>
            <p className="title">{v.business_name}</p>
            <div className="meta"><span>{v.address ?? v.area_label ?? ""}</span></div>
            <div className="acts">
              <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={() => start(v)}>
              <Icon name="check" size="md" />
              ثبت بازدید</button>
              <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" disabled={v.lat === null || v.lng === null}
                onClick={() => v.lat !== null && v.lng !== null && window.open(navigateUrl(navApp, { lat: v.lat, lng: v.lng }, v.business_name), "_blank", "noopener")}>
                <Icon name="route" size="md" />
                مسیریابی
              </button>
            </div>
          </article>
        ))}
      </div>
      {flow ? (
        <TapFlow
          open={flow.open}
          title={flow.visit.business_name}
          subtitle={flow.visit.address ?? undefined}
          config={driverVisitFlow}
          ctx={flow.ctx}
          state={flow.state}
          onState={(state) => setFlow((f) => (f ? { ...f, state } : f))}
          onSaved={onSaved}
          onClose={() => setFlow((f) => (f ? { ...f, open: false } : f))}
          done={<FlowDone chips={["مکان شما به‌عنوان مکان دقیق ثبت می‌شود"]} onReturn={() => setFlow((f) => (f ? { ...f, open: false } : f))} />}
        />
      ) : null}
    </section>
  );
}
