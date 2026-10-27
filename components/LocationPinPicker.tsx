"use client";

import LocationEditor from "./crm/LocationEditor";
import WidgetBoundary from "@/components/WidgetBoundary";

/** Compatibility adapter: lead flow and CRM use the same draft editor. */
export default function LocationPinPicker({ initial, onConfirm, onCancel }: {
  initial?: { lat: number; lng: number } | null;
  onConfirm: (lat: number, lng: number) => void;
  onCancel: () => void;
}) {
  return (
    <WidgetBoundary label="انتخاب موقعیت روی نقشه">
      <LocationEditor initial={initial ?? null} onConfirm={onConfirm} onCancel={onCancel} />
    </WidgetBoundary>
  );
}
