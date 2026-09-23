"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import { distanceKm } from "@/lib/geo";
import { useMyPosition } from "@/components/MyPositionProvider";
import { faFixed, faNum } from "@/lib/format";
import { useMemo, useState } from "react";

const heatColors = ["#2DE0E6", "#2DE0E6", "#7dd3fc", "#facc15", "#f87171"];

export default function LeadGeographicDensity({ locations }: { locations: any[] }) {
  const { position } = useMyPosition();
  const [heatLevel, setHeatLevel] = useState(0);

  const routable = useMemo(
    () => locations.filter((l) => l.lat !== null && l.lng !== null),
    [locations]
  );

  const userDistances = useMemo(() => {
    if (!position) return [];
    return routable.map((l) => ({
      ...l,
      dist: distanceKm(position, { lat: l.lat, lng: l.lng }),
    })).sort((a, b) => a.dist - b.dist);
  }, [routable, position]);

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <h2 className="sechead__title mb-3">تراکم جغرافیایی</h2>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[length:var(--text-xs)] text-text-faint">{routable.length} مکان با مختصات</span>
      </div>
      <div className="h-64 rounded-[var(--radius-md)] border border-border overflow-hidden">
        {routable.length > 0 ? (
          <MapContainer
            center={[routable.reduce((s, l) => s + l.lat, 0) / routable.length, routable.reduce((s, l) => s + l.lng, 0) / routable.length]}
            zoom={12}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom={false}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {routable.map((l) => {
              const dist = position ? distanceKm(position, { lat: l.lat, lng: l.lng }) : null;
              const color = heatColors[Math.min(Math.floor((dist ?? 5) / 2), heatColors.length - 1)];
              return (
                <Marker
                  key={l.id}
                  position={[l.lat, l.lng]}
                  icon={divIcon({ className: "", html: `<div style="background:${color};width:10px;height:10px;border-radius:50%;border:2px solid rgba(255,255,255,0.5)"></div>`, iconSize: [10, 10], iconAnchor: [5, 5] })}
                >
                  <Popup>
                    <div dir="rtl" className="text-[length:var(--text-sm)]">
                      <p className="font-medium">{l.name}</p>
                      {dist !== null && <p>{faFixed(dist, 2)} km</p>}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-text-faint text-[length:var(--text-sm)]">
            هیچ مکانی با مختصات وجود ندارد
          </div>
        )}
      </div>
    </div>
  );
}
