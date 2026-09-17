"use client";

import LocationEditor from "./crm/LocationEditor";

/** Compatibility adapter: lead flow and CRM use the same draft editor. */
export default function LocationPinPicker({ initial, onConfirm, onCancel }: {
  initial?: { lat: number; lng: number } | null;
  onConfirm: (lat: number, lng: number) => void;
  onCancel: () => void;
}) {
  return <LocationEditor initial={initial ?? null} onConfirm={onConfirm} onCancel={onCancel} />;
}
