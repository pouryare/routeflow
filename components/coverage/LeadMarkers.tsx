"use client";

import { useState } from "react";
import { Marker, Popup } from "@vis.gl/react-maplibre";
import { useNavApp } from "@/components/NavAppSetting";
import { navigateUrl } from "@/lib/navApps";
import { Icon } from "@/components/meridian/Icon";

/** Prospect locations on the map. */
export default function LeadMarkers({ initialLeads, navAppId }: {
  initialLeads: { id: number; name: string; lat: number; lng: number }[];
  navAppId: ReturnType<typeof useNavApp>[0];
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const open = initialLeads.find((l) => l.id === openId);
  return (
    <>
      {initialLeads.map((l) => (
        <Marker key={l.id} longitude={l.lng} latitude={l.lat} style={{ zIndex: 1 }}
          onClick={(e) => { e.originalEvent.stopPropagation(); setOpenId(l.id); }}>
          <div className="prospect-marker" role="button" aria-label={l.name} title={l.name} />
        </Marker>
      ))}
      {open && (
        <Popup longitude={open.lng} latitude={open.lat} offset={10} closeOnClick={false} onClose={() => setOpenId(null)}>
          <div dir="rtl" className="text-[length:var(--text-sm)]">
            <p className="font-medium text-text">{open.name}</p>
            <p className="mt-1 text-[length:var(--text-xs)] text-text-muted">مکان پیشنهادی</p>
            <a
              href={navigateUrl(navAppId, { lat: open.lat, lng: open.lng }, open.name)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[length:var(--text-xs)] text-accent hover:underline"
            >
              مسیریابی <Icon name="external-link" size="sm" />
            </a>
          </div>
        </Popup>
      )}
    </>
  );
}
