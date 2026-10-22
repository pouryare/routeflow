"use client";

import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { useNavApp } from "@/components/NavAppSetting";
import { navigateUrl } from "@/lib/navApps";
import { Icon } from "@/components/meridian/Icon";


/** Prospect locations on the map. */
export default function LeadMarkers({ initialLeads, navAppId }: {
  initialLeads: { id: number; name: string; lat: number; lng: number }[];
  navAppId: ReturnType<typeof useNavApp>[0];
}) {
  return (
    <>
          {initialLeads.map((l) => (
            <Marker
              key={l.id}
              position={[l.lat, l.lng]}
              title={l.name}
              icon={L.divIcon({
                className: "",
                html: `<div style="background:#2DE0E6;width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,0.6);box-shadow:0 0 6px rgba(45,224,230,0.5)"></div>`,
                iconSize: [12, 12],
                iconAnchor: [6, 6],
              })}
              zIndexOffset={900}
            >
              <Popup>
                <div dir="rtl" className="text-[length:var(--text-sm)]">
                  <p className="font-medium text-text">{l.name}</p>
                  <p className="mt-1 text-[length:var(--text-xs)] text-text-muted">مکان پیشنهادی</p>
                  <a
                    href={navigateUrl(navAppId, { lat: l.lat, lng: l.lng }, l.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[length:var(--text-xs)] text-accent hover:underline"
                  >
                    مسیریابی <Icon name="external-link" size="sm" />
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
    </>
  );
}
