"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/meridian/Icon";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useMyPosition } from "./MyPositionProvider";

/** The ◎ button: recentre on me.
 *
 *  It used to *be* the location feature -- one getCurrentPosition, one marker dropped
 *  where you happened to be standing when you pressed it, frozen there for the rest of
 *  the session. The marker now comes from MyLocationMarker and tracks continuously, so
 *  all this button has left to do is move the viewport, which is the only thing it was
 *  ever really for.
 *
 *  It reports state through its own appearance: dim while there is no fix, lit once
 *  there is one. A button that looks identical whether or not the app knows where you
 *  are is a button you press hopefully.
 */
export default function LocateControl() {
  const map = useMap();
  const { position, status, retry } = useMyPosition();
  const buttonRef = useRef<HTMLAnchorElement | null>(null);
  const [iconHost] = useState(() => document.createElement("span"));

  // The Leaflet control is created once and its click handler captured then, so it needs
  // a stable way to see the current fix. Written in an effect rather than during render:
  // a ref assigned while rendering is a side effect in the render pass.
  const latestRef = useRef({ position, retry });
  useEffect(() => {
    latestRef.current = { position, retry };
  }, [position, retry]);

  const recentre = useCallback(() => {
    const { position: pos, retry: askAgain } = latestRef.current;
    if (!pos) {
      // Nothing to centre on. Asking again is the only useful thing a press can mean.
      askAgain();
      return;
    }
    map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 16), { duration: 1 });
  }, [map]);

  useEffect(() => {
    const handleClick = (e: Event) => {
      L.DomEvent.preventDefault(e);
      recentre();
    };
    const LocateButton = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control locate-control");
        const button = L.DomUtil.create("a", "", container) as HTMLAnchorElement;
        button.href = "#";
        button.title = "رفتن به موقعیت من";
        button.appendChild(iconHost);
        button.setAttribute("role", "button");
        button.setAttribute("aria-label", "رفتن به موقعیت من");
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(button, "click", handleClick);
        buttonRef.current = button;
        return container;
      },
      onRemove() {
        if (buttonRef.current) L.DomEvent.off(buttonRef.current, "click", handleClick);
        buttonRef.current = null;
      },
    });
    const control = new LocateButton({ position: "topleft" });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, recentre, iconHost]);

  // Reflects whether there is anything to recentre *on*, rather than whether a request
  // is in flight -- which is what the user actually needs to know before pressing it.
  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    button.classList.toggle("locate-control--active", status === "active");
    button.classList.toggle("locate-control--denied", status === "denied");
    button.title =
      status === "denied"
        ? "دسترسی به موقعیت داده نشده — برای تلاش دوباره بزنید"
        : status === "active"
          ? "رفتن به موقعیت من"
          : "در حال یافتن موقعیت…";
  }, [status]);

  return createPortal(<Icon name="locate" size="md" />, iconHost);
}
