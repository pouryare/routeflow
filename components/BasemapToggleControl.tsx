"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

export type Basemap = "dark" | "satellite";

export default function BasemapToggleControl({
  mode,
  onToggle,
}: {
  mode: Basemap;
  onToggle: () => void;
}) {
  const map = useMap();
  const buttonRef = useRef<HTMLAnchorElement | null>(null);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  useEffect(() => {
    const BasemapButton = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control basemap-toggle-control");
        const button = L.DomUtil.create("a", "", container) as HTMLAnchorElement;
        button.href = "#";
        button.setAttribute("role", "button");
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(button, "click", (e) => {
          L.DomEvent.preventDefault(e);
          onToggleRef.current();
        });
        buttonRef.current = button;
        return container;
      },
      onRemove() {
        buttonRef.current = null;
      },
    });
    const control = new BasemapButton({ position: "topleft" });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    if (mode === "dark") {
      button.innerHTML = "🛰";
      button.title = "نمایش تصویر ماهواره‌ای";
      button.setAttribute("aria-label", "نمایش تصویر ماهواره‌ای");
    } else {
      button.innerHTML = "🗺";
      button.title = "نمایش نقشه استاندارد";
      button.setAttribute("aria-label", "نمایش نقشه استاندارد");
    }
  }, [mode]);

  return null;
}
