"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

export default function LocateControl({
  onPosition,
}: {
  onPosition?: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const buttonRef = useRef<HTMLAnchorElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback(
    (button: HTMLAnchorElement) => {
      if (!navigator.geolocation) {
        setError("مرورگر شما از موقعیت‌یابی پشتیبانی نمی‌کند");
        return;
      }
      button.classList.add("locate-control--active");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setError(null);
          const { latitude, longitude } = pos.coords;
          map.flyTo([latitude, longitude], 16, { duration: 1 });
          if (markerRef.current) {
            markerRef.current.setLatLng([latitude, longitude]);
          } else {
            markerRef.current = L.marker([latitude, longitude], {
              icon: L.divIcon({
                className: "",
                html: `<div class="me-marker"><span class="me-marker__ping" aria-hidden="true"></span><span class="me-marker__dot"></span></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8],
              }),
              zIndexOffset: 1000,
              interactive: false,
              keyboard: false,
            }).addTo(map);
          }
          onPosition?.(latitude, longitude);
        },
        (err) => {
          button.classList.remove("locate-control--active");
          setError(
            err.code === err.PERMISSION_DENIED
              ? "اجازه دسترسی به موقعیت داده نشد"
              : "خطا در دریافت موقعیت فعلی"
          );
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    },
    [map, onPosition]
  );

  useEffect(() => {
    const LocateButton = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control locate-control");
        const button = L.DomUtil.create("a", "", container) as HTMLAnchorElement;
        button.href = "#";
        button.title = "موقعیت من";
        button.innerHTML = "◎";
        button.setAttribute("role", "button");
        button.setAttribute("aria-label", "نمایش موقعیت من روی نقشه");
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(button, "click", (e) => {
          L.DomEvent.preventDefault(e);
          locate(button);
        });
        buttonRef.current = button;
        return container;
      },
      onRemove() {
        buttonRef.current = null;
      },
    });
    const control = new LocateButton({ position: "topleft" });
    control.addTo(map);
    return () => {
      control.remove();
      markerRef.current?.remove();
      markerRef.current = null;
    };
  }, [map, locate]);

  if (!error) return null;
  return (
    <div
      dir="rtl"
      className="absolute bottom-4 left-4 z-[1001] flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface-raised px-3 py-2 text-[length:var(--text-sm)] text-crit elevate-crit"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-crit" />
      {error}
      <button onClick={() => setError(null)} aria-label="بستن" className="mr-1 text-text-muted hover:text-text">
        ✕
      </button>
    </div>
  );
}
