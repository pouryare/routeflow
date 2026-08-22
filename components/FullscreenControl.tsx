"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { FullScreen } from "leaflet.fullscreen";
import "leaflet.fullscreen/dist/Control.FullScreen.css";

export default function FullscreenControl() {
  const map = useMap();

  useEffect(() => {
    const control = new FullScreen({
      position: "topleft",
      title: "تمام صفحه",
      titleCancel: "خروج از تمام صفحه",
    });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);

  return null;
}
