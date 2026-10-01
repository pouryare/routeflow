"use client";

import dynamic from "next/dynamic";
import { Icon } from "@/components/meridian/Icon";
import { useState } from "react";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";

const LocationPinPicker = dynamic(() => import("@/components/LocationPinPicker"), { ssr: false });

/** A pin step: the picker's own «اینجا هستم» / «ثبت موقعیت» do the work. The first option
 *  confirms with the pin; any other option (e.g. «نه، بعداً روی نقشه») submits without one. */
export default function PinStep({ api, initial, allowApprox }: {
  api: CustomStepApi; initial: { lat: number; lng: number } | null; allowApprox: boolean;
}) {
  const [approx, setApprox] = useState(false);
  const [confirm, ...others] = api.step.options;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <LocationPinPicker
        initial={initial}
        onConfirm={(lat, lng) => api.submit(confirm.id, JSON.stringify({ lat, lng, precision: approx ? "approx" : "exact" }))}
        onCancel={() => (others[0] ? api.submit(others[0].id) : undefined)}
      />
      {allowApprox ? (
        <button type="button" aria-pressed={approx} className={`tf-opt${approx ? " on" : ""}`} onClick={() => setApprox((a) => !a)}>
          <Icon name="map-pin" size="md" />
          آدرس تقریبی است
          <small>مثلاً از روی منوی اسنپ‌فود — راننده دقیقش می‌کند</small>
        </button>
      ) : null}
      {others.map((o) => (
        <button key={o.id} type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-skip" onClick={() => api.submit(o.id)}>
        <Icon name="map-pin" size="md" />
        {o.label}</button>
      ))}
    </div>
  );
}
