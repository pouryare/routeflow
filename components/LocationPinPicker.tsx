"use client";

import { useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const TEHRAN_CENTER: [number, number] = [35.7, 51.4];

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--accent);border:2px solid #04191c;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

function ClickCatcher({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function LocationPinPicker({
  initial,
  onConfirm,
  onCancel,
}: {
  initial?: { lat: number; lng: number } | null;
  onConfirm: (lat: number, lng: number) => void;
  onCancel: () => void;
}) {
  const [pos, setPos] = useState<[number, number] | null>(initial ? [initial.lat, initial.lng] : null);

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="h-56 w-full">
        <MapContainer
          center={pos ?? TEHRAN_CENTER}
          zoom={pos ? 16 : 11}
          className="h-full w-full"
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20}
          />
          <ClickCatcher onPick={(lat, lng) => setPos([lat, lng])} />
          {pos && <Marker position={pos} icon={pinIcon} />}
        </MapContainer>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border bg-surface px-3 py-2">
        <span className="text-[length:var(--text-xs)] text-text-faint">
          {pos ? `${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}` : "روی نقشه بزنید تا موقعیت تعیین شود"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-crit hover:text-crit"
          >
            انصراف
          </button>
          <button
            onClick={() => pos && onConfirm(pos[0], pos[1])}
            disabled={!pos}
            className="rounded-[var(--radius-sm)] border border-accent bg-accent px-2 py-1 text-[length:var(--text-xs)] font-medium text-[#04191c] disabled:opacity-50"
          >
            ثبت موقعیت
          </button>
        </div>
      </div>
    </div>
  );
}
