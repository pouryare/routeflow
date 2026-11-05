"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import TapFlow, { CustomStepApi } from "@/components/tapflow/TapFlow";
import { leadVisitFlow } from "@/lib/crm/flows/leadVisit";
import { startFlow } from "@/lib/crm/flows/machine";
import type { FlowContext, FlowState } from "@/lib/crm/flows/types";
import { useToast } from "@/components/ToastProvider";
import StarRating from "@/components/StarRating";
import { navigateUrl } from "@/lib/navApps";
import type { NavAppId } from "@/lib/navApps";
import { uuidv7 } from "@/lib/offline/uuidv7";

export interface LocationTapFlowProps {
  open: boolean;
  locationId: number;
  locationName: string;
  locationLat: number | null;
  locationLng: number | null;
  navAppId: NavAppId;
  onNavigate?: (url: string) => void;
  onClose: () => void;
}

export default function LocationTapFlow({ open, locationId, locationName, locationLat, locationLng, navAppId, onNavigate, onClose }: LocationTapFlowProps) {
  const toast = useToast();
  const [ctx, setCtx] = useState<FlowContext | null>(null);
  const [state, setState] = useState<FlowState>({ stack: [], answers: [], acc: {}, values: {}, saved: false });

  // The parent passes a fresh onClose each render; read it through a ref so the fetch runs once per opening.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  // A closed sheet forgets the last visit's context (adjusted during render, so no frame shows stale answers).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setCtx(null);
  }
  /* Each time the sheet opens, read the flow's context from the server: it replays the same answers when the
     visit is saved, so both sides must start from the same context . */
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch(`/api/leads/locations/${locationId}/visit`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ctx?: FlowContext } | null) => {
        if (!live) return;
        if (!j?.ctx) {
          toast("این مکان باز نشد؛ دوباره تلاش کنید", "error");
          closeRef.current();
          return;
        }
        setCtx(j.ctx);
        setState(startFlow(leadVisitFlow, j.ctx));
      })
      .catch(() => {
        if (!live) return;
        toast("اینترنت وصل نیست؛ بازدید را بعداً ثبت کنید", "error");
        closeRef.current();
      });
    return () => {
      live = false;
    };
  }, [open, locationId, toast]);

  const handleStateChange = useCallback((next: FlowState) => {
    setState(next);
  }, []);

  /* The last answer saves: send the answers, the server replays them and writes the visit, its stars and any
     reminder. */
  const handleSaved = useCallback(async (saved: FlowState) => {
    setState(saved);
    const res = await fetch(`/api/leads/locations/${locationId}/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: saved.answers, client_uuid: uuidv7() }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { error?: string } | null;
    if (res?.ok) toast("ذخیره شد", "success");
    else toast(j?.error ?? "ذخیره نشد؛ دوباره تلاش کنید", "error");
  }, [locationId, toast]);

  // Custom renderer for the stars step — shows 3 separate star ratings
  const renderStars = useCallback((api: CustomStepApi) => {
    const { state: st, submit } = api;
    const stars = st.acc.stars ?? { potential: null, volume: null, ease: null };

    const handleStarChange = (criterion: "potential" | "volume" | "ease", value: number | null) => {
      const updated = { ...stars, [criterion]: value };
      const allFilled = updated.potential !== null && updated.volume !== null && updated.ease !== null;
      if (allFilled) {
        submit("stars", `${updated.potential},${updated.volume},${updated.ease}`);
      }
    };

    return (
      <div className="tf-grid one">
        <div>
          <p className="text-[length:var(--text-xs)] text-text-faint mb-1">پتانسیل فروش</p>
          <StarRating value={stars.potential ?? null} onChange={(v: number | null) => handleStarChange("potential", v)} label="پتانسیل فروش" />
        </div>
        <div>
          <p className="text-[length:var(--text-xs)] text-text-faint mb-1">حجم سفارش</p>
          <StarRating value={stars.volume ?? null} onChange={(v: number | null) => handleStarChange("volume", v)} label="حجم سفارش" />
        </div>
        <div>
          <p className="text-[length:var(--text-xs)] text-text-faint mb-1">سهولت همکاری</p>
          <StarRating value={stars.ease ?? null} onChange={(v: number | null) => handleStarChange("ease", v)} label="سهولت همکاری" />
        </div>
      </div>
    );
  }, []);

  const renderCustom = useCallback((api: CustomStepApi) => {
    if (api.step.kind === "stars") return renderStars(api);
    return null;
  }, [renderStars]);

  const done = useMemo(() => {
    return (
      <div className="tf-done">
        <p className="text-text font-medium">بازدید ثبت شد</p>
        <p className="text-[length:var(--text-xs)] text-text-faint">{locationName}</p>
      </div>
    );
  }, [locationName]);

  const navUrl = (locationLat != null && locationLng != null)
      ? navigateUrl(navAppId, { lat: locationLat, lng: locationLng }, locationName)
      : null;

  if (!open || !ctx) return null;

  return (
    <TapFlow
      open={open}
      title={locationName}
      subtitle="lead_visit"
      config={leadVisitFlow}
      ctx={ctx}
      state={state}
      onState={handleStateChange}
      onSaved={handleSaved}
      onClose={onClose}
      renderCustom={renderCustom}
      done={done}
      onNavigate={onNavigate}
      navigateUrl={navUrl ?? undefined}
    />
  );
}
