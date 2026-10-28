"use client";

import { AnswerButton, SkipButton } from "@/components/tapflow/Answer";
import dynamic from "next/dynamic";
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
        <AnswerButton icon="map-pin" selected={approx} onPress={() => setApprox((a) => !a)}>
آدرس تقریبی است
          <small>مثلاً از روی منوی اسنپ‌فود — راننده دقیقش می‌کند</small>
</AnswerButton>
      ) : null}
      {others.map((o) => (
        <SkipButton key={o.id} icon="map-pin" onPress={() => api.submit(o.id)}>{o.label}</SkipButton>
      ))}
    </div>
  );
}
