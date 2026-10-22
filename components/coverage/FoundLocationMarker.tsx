"use client";

import { Marker, Popup } from "react-leaflet";
import { coordText } from "@/lib/clipboard";
import CopyButton from "@/components/CopyButton";
import { Icon } from "@/components/meridian/Icon";
import { foundLocationIcon } from "@/components/coverage/mapParts";


/** The marker dropped by a search result, with its popup. */
export default function FoundLocationMarker({ foundLocation, onClear }: {
  foundLocation: { lat: number; lng: number; label: string };
  onClear: () => void;
}) {
  return (
            <Marker
              position={[foundLocation.lat, foundLocation.lng]}
              title={foundLocation.label}
              icon={foundLocationIcon()}
              eventHandlers={{ add: (e) => e.target.openPopup() }}
            >
              <Popup>
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
            </Marker>
  );
}
