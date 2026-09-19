"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import TapFlow, { CustomStepApi } from "@/components/tapflow/TapFlow";
import { leadVisitFlow } from "@/lib/crm/flows/leadVisit";
import { answerStep, backStep, startFlow, viewStep } from "@/lib/crm/flows/machine";
import type { FlowContext, FlowState } from "@/lib/crm/flows/types";
import { useToast } from "@/components/ToastProvider";
import StarRating from "@/components/StarRating";
import { MAX_STARS } from "@/lib/leadScore";
import { navigateUrl } from "@/lib/navApps";
import type { NavAppId } from "@/lib/navApps";

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

  // Initialize flow when opened
  useEffect(() => {
    if (!open) return;
    const initialCtx: FlowContext = {
      entry: "driver_visit",
      firstContact: true,
      attemptNo: 1,
      maxMisses: 5,
      isManager: false,
      vars: {},
      knownContacts: [],
      products: [],
      reps: [],
      recentCustomers: [],
    };
    setCtx(initialCtx);
    setState(startFlow(leadVisitFlow, initialCtx));
  }, [open]);

  const handleStateChange = useCallback((next: FlowState) => {
    setState(next);
  }, []);

  const handleSaved = useCallback((saved: FlowState) => {
    setState(saved);
    toast("ذخیره شد", "success");
  }, [toast]);

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
      <div className="tap-grid one">
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
      <div className="tap-done">
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
