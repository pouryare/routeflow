"use client";

import { useState } from "react";
import { Marker, Popup } from "@vis.gl/react-maplibre";
import { coordText } from "@/lib/clipboard";
import CopyButton from "@/components/CopyButton";
import { Icon } from "@/components/meridian/Icon";
import { MAP_PIN_SVG } from "@/components/meridian/icon-map";

/** The marker dropped by a search result, with its popup open from the start. */
export default function FoundLocationMarker({ foundLocation, onClear }: {
  foundLocation: { lat: number; lng: number; label: string };
  onClear: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Marker longitude={foundLocation.lng} latitude={foundLocation.lat} anchor="bottom" style={{ zIndex: 2 }}
        onClick={(e) => { e.originalEvent.stopPropagation(); setOpen(true); }}>
        <div className="found-location-marker" role="button" aria-label={foundLocation.label} title={foundLocation.label}
          dangerouslySetInnerHTML={{ __html: MAP_PIN_SVG }} />
      </Marker>
      {open && (
        <Popup longitude={foundLocation.lng} latitude={foundLocation.lat} offset={28} closeOnClick={false} onClose={() => setOpen(false)}>
          <div dir="rtl" className="text-[length:var(--text-sm)]">
            <p className="mb-1 font-medium text-text">{foundLocation.label}</p>
            <p className="flex items-center gap-2 font-mono text-[length:var(--text-xs)] text-text-muted">
              <span dir="ltr">{coordText(foundLocation.lat, foundLocation.lng)}</span>
              <CopyButton value={coordText(foundLocation.lat, foundLocation.lng)} what="کپی مختصات" />
            </p>
            <button
              onClick={() => onClear()}
              className="mt-2 text-[length:var(--text-xs)] text-accent hover:underline"
            >
              <Icon name="trash" size="sm" />
              حذف نشانگر
            </button>
          </div>
        </Popup>
      )}
    </>
  );
}
