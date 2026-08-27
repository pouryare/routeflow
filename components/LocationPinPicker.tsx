"use client";

import { useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import MyLocationMarker from "./MyLocationMarker";
import { useMyPosition } from "./MyPositionProvider";
import { faNum } from "@/lib/format";

const TEHRAN_CENTER: [number, number] = [35.7, 51.4];

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--accent);border:2px solid var(--accent-ink);box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
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
  const { position } = useMyPosition();

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
          {/* Pinning a venue almost always happens while standing outside it, so the
              map that asks "where is this?" should show where you are. Only flies to
              the first fix when there is no pin yet -- an existing pin is the thing
              being corrected, and the view must stay on it. */}
          <MyLocationMarker followFirstFix={!initial} />
        </MapContainer>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border bg-surface px-3 py-2">
        <span className="text-[length:var(--text-xs)] text-text-faint">
          {pos ? `${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}` : "روی نقشه بزنید تا موقعیت تعیین شود"}
        </span>
        <div className="flex items-center gap-2">
          {position && (
            /* One tap beats aiming at a 22px pin on a phone-sized map, and it is
               accurate to the metre rather than to wherever a thumb landed. */
            <button
              onClick={() => setPos([position.lat, position.lng])}
              className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-accent hover:border-accent"
            >
              اینجا هستم (±{faNum(Math.round(position.accuracy))}م)
            </button>
          )}
          <button
            onClick={onCancel}
            className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-crit hover:text-crit"
          >
            انصراف
          </button>
          <button
            onClick={() => pos && onConfirm(pos[0], pos[1])}
            disabled={!pos}
            className="rounded-[var(--radius-sm)] border border-accent bg-accent px-2 py-1 text-[length:var(--text-xs)] font-medium text-accent-ink disabled:opacity-50"
          >
            ثبت موقعیت
          </button>
        </div>
      </div>
    </div>
  );
}
