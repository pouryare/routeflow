"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/meridian/Icon";
import { useMap } from "react-leaflet";
import { FullScreen } from "leaflet.fullscreen";
import "leaflet.fullscreen/dist/Control.FullScreen.css";

export default function FullscreenControl() {
  const map = useMap();
  const [iconHost] = useState(() => document.createElement("span"));

  useEffect(() => {
    const control = new FullScreen({
      position: "topleft",
      title: "تمام صفحه",
      titleCancel: "خروج از تمام صفحه",
      /* The plugin reuses the zoom container without removing its old link.
         Give it an owned container so Strict Mode cleanup removes the whole bar
         without detaching zoom or retaining a duplicate fullscreen button. */
      forceSeparateButton: true,
      content: " ", // Suppress the plugin's fixed-color background image.
    });
    control.addTo(map);
    control.getContainer()?.querySelector("a")?.replaceChildren(iconHost);
    return () => {
      // leaflet.fullscreen 5.3.3 leaves its map listener registered on removal.
      // Its private callback is absent from the published TypeScript declaration.
      const listener = (control as FullScreen & { _toggleState: () => void })._toggleState;
      map.off("enterFullscreen exitFullscreen", listener, control);
      control.remove();
      if (map.fullscreenControl === control) delete map.fullscreenControl;
    };
  }, [map, iconHost]);

  return createPortal(<>
    <Icon name="maximize" size="md" className="fullscreen-enter" />
    <Icon name="minimize" size="md" className="fullscreen-exit" />
  </>, iconHost);
}
